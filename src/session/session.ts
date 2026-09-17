import type { BatchToken } from "../batch";
import { AesGcm } from "../crypt/aes";
import { ensureCrypt } from "../crypt/assert";
import { randomBytes, toBase64Url } from "../crypt/encoding";
import type { CryptToken } from "../crypt/types";
import type { QueueToken } from "../queue";
import { clone } from "../utilities/clone";
import { get } from "../utilities/get";
import { merge } from "../utilities/merge";
import { isLiteralObject } from "../utilities/object";
import { globalState } from "../utilities/global-state";
import { toPath } from "../utilities/path";
import { set as setPath } from "../utilities/set";
import { unset as unsetPath } from "../utilities/unset";
import { diffPaths, leafPaths, WriteOrder } from "./diff";
import { MemoryStore } from "./memory-store";
import type {
  CookieJar,
  CookieOptions,
  SessionClass,
  SessionData,
  SessionHandle,
  SessionOptions,
  SessionRecord,
  SessionStore,
  SessionToken,
} from "./types";

const PURPOSE = {
  cookie: "@ecosy/session:cookie",
  store: "@ecosy/session:store",
  data: "@ecosy/session:data",
  user: "@ecosy/session:user",
} as const;

const DEFAULT_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_GRACE = 30_000;
/** A live state untouched this long, with nothing pending, is read from the store again on the next load. */
const LIVE_IDLE_MS = 60_000;

/**
 * What a session holds is what survives the store: a JSON round trip, taken at
 * the moment of writing. A `Date` is its ISO string straight away, not only
 * after the next load — the state never looks different in memory than it does
 * once read back.
 */
function asStored<Value>(value: Value): Value {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as Value);
}

/** A `set` or `setQueue` waiting to be applied. */
interface PendingWrite {
  seq: number;
  partial: SessionData;
  /** The state when the write was called: what "changed since" is measured against. */
  before: SessionData;
  jar: CookieJar;
}

/** One session id's state, shared by every request that loads it in this process. */
interface Live {
  id: string;
  state: SessionData;
  createdAt: number;
  user?: string;
  /** Saved at least once. */
  exists: boolean;
  /** The store key it was loaded or last saved under — a rotation may move it. */
  storeKey?: string;
  /** Expiry override for an id kept alive by `regenerate`'s grace period. */
  graceUntil?: number;
  destroyed: boolean;
  order: WriteOrder;
  pendingWrites: number;
  saving: Promise<void> | null;
  trailing: Promise<void> | null;
  lastJar?: CookieJar;
  touchedAt: number;
}

/**
 * Builds a session token class.
 *
 * Framework-free: a session reads and writes its cookie through a
 * {@link CookieJar}, which an adapter builds from whatever the framework has.
 *
 * ```ts
 * export const AppSession = Session({ encrypt: AppCrypt, store: AppStore, queue: AppQueue, batch: AppBatch });
 *
 * const session = await new AppSession().load(jar);
 * await session.set({ theme: "dark" });
 * ```
 *
 * Every request loading the same id in this process shares one live state:
 * a write from one is seen by the others at once, and the later write wins.
 * Where a module is evaluated more than once, anchor the class with
 * `@ecosy/anchor` to share it across them.
 */
export function Session(options: SessionOptions = {}): SessionClass {
  const logger = options.logger ?? console;
  const maxAge = options.maxAge ?? DEFAULT_MAX_AGE;
  const grace = options.regenerate?.grace ?? DEFAULT_GRACE;
  const { name: cookieName = "sid", ...cookieAttributes } = options.cookie ?? {};

  if (!(maxAge > 0)) throw new TypeError("[ecosy/session] maxAge must be positive");
  if (!(grace >= 0)) throw new TypeError("[ecosy/session] regenerate.grace must be 0 or more");

  const CryptClass = options.encrypt ?? AesGcm({ logger });
  const StoreClass = options.store ?? MemoryStore({ logger, storageKey: options.storageKey });

  let parts: { crypt: CryptToken; store: SessionStore; queue?: QueueToken; batch?: BatchToken } | null = null;
  let cryptReady: Promise<void> | null = null;

  const deps = () => {
    if (!parts) {
      parts = {
        crypt: new CryptClass(),
        store: new StoreClass(),
        queue: options.queue && new options.queue(),
        batch: options.batch && new options.batch(),
      };
    }
    return parts;
  };

  const ready = async () => {
    const { crypt } = deps();
    cryptReady ??= ensureCrypt(crypt, logger);
    await cryptReady;
    return deps();
  };

  const lives = globalState("session:lives", options.storageKey, () => new Map<string, Live>());

  const cookieOptions = (): CookieOptions => ({
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    ...cookieAttributes,
    maxAge: Math.floor(maxAge / 1000),
  });

  const newLive = (): Live => ({
    id: toBase64Url(randomBytes(32)),
    state: {},
    createdAt: Date.now(),
    exists: false,
    destroyed: false,
    order: new WriteOrder(),
    pendingWrites: 0,
    saving: null,
    trailing: null,
    touchedAt: Date.now(),
  });

  const register = (live: Live) => {
    lives.set(live.id, live);
    return live;
  };

  const forgetIdle = () => {
    const now = Date.now();
    for (const [id, live] of lives) {
      if (live.pendingWrites === 0 && !live.saving && now - live.touchedAt > LIVE_IDLE_MS) {
        lives.delete(id);
      }
    }
  };

  const idFromCookie = async (value: string | null | undefined): Promise<string | null> => {
    if (typeof value !== "string") return null;
    const dot = value.indexOf(".");
    if (dot <= 0) return null;
    const id = value.slice(0, dot);
    const { crypt } = await ready();
    return (await crypt.verify(id, value.slice(dot + 1), { purpose: PURPOSE.cookie })) ? id : null;
  };

  const storeKeys = async (id: string) => {
    const { crypt } = await ready();
    return crypt.signAll ? crypt.signAll(id, { purpose: PURPOSE.store }) : [await crypt.sign(id, { purpose: PURPOSE.store })];
  };

  const loadLive = async (id: string): Promise<Live | null> => {
    const { crypt, store } = await ready();

    for (const key of await storeKeys(id)) {
      const record = await store.get(key);
      if (!record) continue;
      if (record.expiresAt <= Date.now()) return null;

      const text = await crypt.decrypt(record.data, { purpose: PURPOSE.data, aad: id });
      if (text === null) return null;

      let state: unknown;
      try {
        state = JSON.parse(text);
      } catch {
        return null;
      }
      if (!isLiteralObject(state)) return null;

      return {
        ...newLive(),
        id,
        state: state as SessionData,
        createdAt: record.createdAt,
        user: record.user,
        exists: true,
        storeKey: key,
      };
    }

    return null;
  };

  /* ------------------------------------------------------------ saving */

  const write = async (live: Live) => {
    if (live.destroyed) return;
    // Nothing worth a cookie yet: an untouched session is never stored.
    if (!live.exists && Object.keys(live.state).length === 0 && live.user === undefined) return;

    const { crypt, store } = await ready();
    const now = Date.now();
    const [key] = await storeKeys(live.id);

    const record: SessionRecord = {
      data: await crypt.encrypt(JSON.stringify(live.state), { purpose: PURPOSE.data, aad: live.id }),
      createdAt: live.createdAt,
      expiresAt: live.graceUntil ?? now + maxAge,
      user: live.user,
    };

    await store.set(key, record);

    if (live.storeKey && live.storeKey !== key) {
      await store.delete(live.storeKey);
    }
    live.storeKey = key;

    // An id in its grace period only lives out the grace; its cookie has moved on.
    if (live.graceUntil === undefined && live.lastJar) {
      const signature = await crypt.sign(live.id, { purpose: PURPOSE.cookie });
      await live.lastJar.set(cookieName, `${live.id}.${signature}`, cookieOptions());
    }

    live.exists = true;
  };

  /* One save at a time per session; a save asked for while one runs becomes a
     single trailing save that reads the state when it starts, so the store
     always ends on the latest state. */
  const persist = (live: Live, jar?: CookieJar): Promise<void> => {
    if (jar) live.lastJar = jar;
    live.touchedAt = Date.now();
    // Held by a request past the idle window: take its place again rather than save beside a copy.
    if (!live.destroyed && live.graceUntil === undefined && !lives.has(live.id)) lives.set(live.id, live);

    if (live.saving) {
      live.trailing ??= live.saving
        .catch(() => undefined)
        .then(() => {
          live.trailing = null;
          return persist(live);
        });
      return live.trailing;
    }

    const saving = write(live).finally(() => {
      if (live.saving === saving) live.saving = null;
    });
    live.saving = saving;
    return saving;
  };

  /* ---------------------------------------------------------- applying */

  const apply = (live: Live, pending: PendingWrite) => {
    // What changed on the state since this write was called, and was written after it.
    const newer = diffPaths(pending.before, live.state).filter((change) => live.order.latest(change.path) > pending.seq);

    const next = merge<SessionData>(live.state, pending.partial);

    for (const change of newer) {
      if (change.path.length === 0) continue;
      if (change.removed) unsetPath(next, change.path);
      else setPath(next, change.path, clone(change.value));
    }

    live.state = next;

    for (const path of leafPaths(pending.partial)) {
      live.order.record(path, pending.seq);
    }
  };

  const applyAll = async (live: Live, writes: PendingWrite[]) => {
    try {
      for (const pending of [...writes].sort((a, b) => a.seq - b.seq)) {
        apply(live, pending);
      }
    } finally {
      live.pendingWrites -= writes.length;
      if (live.pendingWrites === 0) live.order.clear();
    }
    await persist(live, writes[writes.length - 1]?.jar);
  };

  const viaQueue = (live: Live, writes: PendingWrite[]) => {
    const { queue } = deps();
    return queue ? queue.run(live.id, () => applyAll(live, writes)) : applyAll(live, writes);
  };

  const enqueue = (live: Live, partial: SessionData, jar: CookieJar, useBatch: boolean): Promise<void> => {
    if (!isLiteralObject(partial)) {
      return Promise.reject(new TypeError("[ecosy/session] set takes a plain object; use setIn for a path"));
    }

    const pending: PendingWrite = {
      seq: live.order.next(),
      partial: asStored(partial),
      before: clone(live.state),
      jar,
    };

    live.pendingWrites++;
    live.touchedAt = Date.now();

    const { batch } = deps();

    if (useBatch && batch) {
      return batch
        .add<PendingWrite>(live.id, pending, { flush: (writes) => viaQueue(live, writes) })
        .then(() => undefined);
    }

    return viaQueue(live, [pending]);
  };

  /* ------------------------------------------------------------ handles */

  const handleFor = (initial: Live, jar: CookieJar): SessionHandle => {
    let live = initial;

    const direct = async (change: () => void) => {
      if (live.pendingWrites === 0) live.order.clear();
      const seq = live.order.next();
      change();
      return seq;
    };

    const readAt = <Value>(path?: string | readonly string[], defaultValue?: Value): Value =>
      path === undefined ? (clone(live.state) as Value) : clone(get<Value>(live.state, path as string | string[], defaultValue));

    return {
      get id() {
        return live.id;
      },
      get isNew() {
        return !live.exists;
      },

      get: readAt as SessionHandle["get"],

      getAsync: (async (path?: string | readonly string[], defaultValue?: unknown) => {
        const { queue, batch } = deps();
        // In order: a batch flush hands its writes to the queue, and the queue's work ends in a save.
        await batch?.pending(live.id);
        await queue?.pending(live.id);
        await (live.trailing ?? live.saving)?.catch(() => undefined);
        return readAt(path, defaultValue);
      }) as SessionHandle["getAsync"],

      set: (partial) => enqueue(live, partial, jar, true),
      setQueue: (partial) => enqueue(live, partial, jar, false),

      async setIn(path, value) {
        const keys = toPath(path as string | string[]);
        const stored = asStored(value);
        // `undefined` does not survive the store; writing it is removing the path.
        const seq = await direct(() =>
          stored === undefined ? unsetPath(live.state, keys) : setPath(live.state, keys, stored),
        );
        live.order.record(keys, seq);
        return persist(live, jar);
      },

      async unset(path) {
        const keys = toPath(path as string | string[]);
        const seq = await direct(() => unsetPath(live.state, keys));
        live.order.record(keys, seq);
        return persist(live, jar);
      },

      persist: () => persist(live, jar),

      async setUser(userId) {
        const { crypt } = await ready();
        live.user = userId === null ? undefined : await crypt.sign(String(userId), { purpose: PURPOSE.user });
        return persist(live, jar);
      },

      async regenerate() {
        const { crypt, store, queue, batch } = await ready();
        const previous = live;

        // Writes already on their way belong to the old id's state; let them land first.
        await batch?.pending(previous.id);
        await queue?.pending(previous.id);
        await (previous.trailing ?? previous.saving)?.catch(() => undefined);

        const next = register({
          ...newLive(),
          state: clone(previous.state),
          createdAt: previous.createdAt,
          user: previous.user,
        });

        // The old id lives out the grace period, for requests already on their way with it.
        if (previous.exists && previous.storeKey) {
          previous.graceUntil = Date.now() + grace;
          const record = await store.get(previous.storeKey);
          if (record) {
            await store.set(previous.storeKey, {
              ...record,
              data: await crypt.encrypt(JSON.stringify(previous.state), { purpose: PURPOSE.data, aad: previous.id }),
              expiresAt: previous.graceUntil,
            });
          }
        }

        live = next;
        await persist(next, jar);
        if (!next.exists) {
          // Nothing to save yet: still hand the browser the new id's cookie.
          const signature = await crypt.sign(next.id, { purpose: PURPOSE.cookie });
          await jar.set(cookieName, `${next.id}.${signature}`, cookieOptions());
        }
      },

      async destroy() {
        const { store } = await ready();
        const ended = live;
        ended.destroyed = true;
        lives.delete(ended.id);
        if (ended.storeKey) await store.delete(ended.storeKey);
        await jar.delete(cookieName, { ...cookieOptions(), maxAge: 0 });
        live = register(newLive());
      },
    };
  };

  return class SessionImpl implements SessionToken {
    async load(jar: CookieJar): Promise<SessionHandle> {
      await ready();
      forgetIdle();

      const id = await idFromCookie(jar.get(cookieName));

      if (id) {
        const cached = lives.get(id);
        if (cached?.graceUntil !== undefined && cached.graceUntil <= Date.now()) {
          lives.delete(id);
        } else if (cached && !cached.destroyed) {
          cached.touchedAt = Date.now();
          return handleFor(cached, jar);
        }

        const loaded = await loadLive(id);
        if (loaded) {
          // Another request may have loaded it meanwhile; keep the first.
          const live = lives.get(id) ?? register(loaded);
          return handleFor(live, jar);
        }
      }

      // No cookie, a forged one, or a session that is gone: a new id, never the one sent.
      return handleFor(register(newLive()), jar);
    }

    async revokeUser(userId: string): Promise<void> {
      const { crypt, store } = await ready();
      if (!store.deleteByUser) {
        throw new TypeError("[ecosy/session] revokeUser needs a store with deleteByUser");
      }
      const user = await crypt.sign(String(userId), { purpose: PURPOSE.user });
      await store.deleteByUser(user);
      for (const [id, live] of lives) {
        if (live.user === user) {
          live.destroyed = true;
          lives.delete(id);
        }
      }
    }
  };
}
