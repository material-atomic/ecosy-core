import type { Promisable } from "../types";
import type { SessionLogger, SessionMeta, SessionRecord, SessionStore, SessionStoreClass } from "./types";

export interface MemoryStoreMaxInfo {
  /** Every record held, without its data. */
  entries: readonly SessionMeta[];
  /** The record waiting to be stored. */
  incoming: SessionMeta;
  max: number;
}

export interface MemoryStorePersist {
  /** Called once, before the store is first used. Expired entries in it are dropped. */
  load(): Promisable<Iterable<readonly [string, SessionRecord]> | null | undefined>;
  /** Handed every record held — the full snapshot, never a delta — after changes settle. */
  save(entries: Array<[string, SessionRecord]>): Promisable<void>;
  /** Milliseconds changes settle before `save`. Default 1000. */
  delay?: number;
}

export interface MemoryStoreOptions {
  /** Records held at most. `0` — the default — for no limit. */
  max?: number;
  /**
   * With the store full, records expiring within this many milliseconds are
   * dropped to make room. `0` — the default — turns this off.
   */
  distance?: number;
  /**
   * With the store still full, decides what goes: return the keys to remove,
   * or `false` to not store the incoming record. Keys that are not held are
   * ignored. Anything else is a TypeError in development and a warning — then
   * treated as `false` — in production.
   */
  onMax?: (info: MemoryStoreMaxInfo) => Promisable<false | readonly string[]>;
  /** Keep records across restarts. Records are already encrypted and keyed by signature. */
  persist?: MemoryStorePersist;
  /** Milliseconds between sweeps of expired records. `0` — the default — sweeps only while reading and writing. */
  sweepInterval?: number;
  logger?: SessionLogger;
}

const isProduction = () => typeof process !== "undefined" && process.env?.NODE_ENV === "production";

const metaOf = (key: string, record: SessionRecord): SessionMeta =>
  Object.freeze({ key, createdAt: record.createdAt, expiresAt: record.expiresAt, user: record.user });

/** Expired records checked on each write, so the store never holds on to many without a timer. */
const SWEEP_ON_WRITE = 8;

/**
 * Builds an in-process session store.
 *
 * The records live with the class this returns: every `new Store()` sees the
 * same ones, and two calls to `MemoryStore()` are two stores. It dies with the
 * process unless `persist` is given, and it is never shared between instances.
 *
 * Expired records are removed as they are read, a few at a time as others are
 * written, on `prune()`, and on a timer when `sweepInterval` is set.
 */
export function MemoryStore(options: MemoryStoreOptions = {}): SessionStoreClass {
  const max = options.max ?? 0;
  const distance = options.distance ?? 0;
  const logger = options.logger ?? console;

  if (!(max >= 0)) throw new TypeError("[ecosy/session] MemoryStore max must be 0 or more");
  if (!(distance >= 0)) throw new TypeError("[ecosy/session] MemoryStore distance must be 0 or more");

  /* Insertion order is write order: a record is re-inserted on every write, so
     the oldest writes — the likeliest to have expired — come first. */
  const records = new Map<string, SessionRecord>();

  let loaded: Promise<void> | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let sweepTimer: ReturnType<typeof setInterval> | null = null;
  /** Makes room one write at a time, so two writes never both decide on the same full store. */
  let roomChain: Promise<unknown> = Promise.resolve();

  const expired = (record: SessionRecord, now = Date.now()) => record.expiresAt <= now;

  const scheduleSave = () => {
    const persist = options.persist;
    if (!persist) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      pruneNow();
      Promise.resolve(persist.save([...records.entries()])).catch((error) =>
        logger.warn("[ecosy/session] MemoryStore persist.save failed:", error),
      );
    }, persist.delay ?? 1000);
    (saveTimer as { unref?: () => void }).unref?.();
  };

  const pruneNow = () => {
    const now = Date.now();
    let removed = false;
    for (const [key, record] of records) {
      if (expired(record, now)) {
        records.delete(key);
        removed = true;
      }
    }
    return removed;
  };

  const ready = () => {
    if (!loaded) {
      loaded = (async () => {
        const initial = options.persist ? await options.persist.load() : null;
        const now = Date.now();
        for (const [key, record] of initial ?? []) {
          if (!expired(record, now) && (max === 0 || records.size < max)) records.set(key, record);
        }
      })();

      if (options.sweepInterval && !sweepTimer) {
        sweepTimer = setInterval(() => {
          if (pruneNow()) scheduleSave();
        }, options.sweepInterval);
        (sweepTimer as { unref?: () => void }).unref?.();
      }
    }
    return loaded;
  };

  const sweepSome = () => {
    const now = Date.now();
    let checked = 0;
    for (const [key, record] of records) {
      if (checked++ >= SWEEP_ON_WRITE) break;
      if (expired(record, now)) records.delete(key);
    }
  };

  const decide = async (key: string, record: SessionRecord): Promise<boolean> => {
    if (max === 0 || records.size < max) return true;

    pruneNow();
    if (records.size < max) return true;

    if (distance > 0) {
      const limit = Date.now() + distance;
      for (const [heldKey, held] of records) {
        if (held.expiresAt <= limit) records.delete(heldKey);
      }
      if (records.size < max) return true;
    }

    if (!options.onMax) {
      logger.warn(`[ecosy/session] MemoryStore is full (${max}); a new session was not stored. Set onMax to decide what goes.`);
      return false;
    }

    const answer = await options.onMax({
      entries: Object.freeze([...records].map(([heldKey, held]) => metaOf(heldKey, held))),
      incoming: metaOf(key, record),
      max,
    });

    if (answer === false) return false;

    if (!Array.isArray(answer) || answer.some((item) => typeof item !== "string")) {
      const message = `[ecosy/session] onMax must return false or string[], received ${
        Array.isArray(answer) ? "an array with non-string items" : typeof answer
      }`;
      if (!isProduction()) throw new TypeError(message);
      logger.warn(`${message} — treated as false`);
      return false;
    }

    for (const heldKey of answer) records.delete(heldKey);

    if (records.size < max) return true;

    logger.warn(`[ecosy/session] MemoryStore is still full (${max}) after onMax; a new session was not stored.`);
    return false;
  };

  return class MemoryStoreImpl implements SessionStore {
    async get(key: string): Promise<SessionRecord | null> {
      await ready();
      const record = records.get(key);
      if (!record) return null;
      if (expired(record)) {
        records.delete(key);
        scheduleSave();
        return null;
      }
      return record;
    }

    async set(key: string, record: SessionRecord): Promise<void> {
      await ready();

      if (records.has(key)) {
        records.delete(key);
        records.set(key, record);
        scheduleSave();
        return;
      }

      sweepSome();

      const admitted = roomChain.then(() => decide(key, record));
      roomChain = admitted.catch(() => undefined);

      if (await admitted) {
        records.set(key, record);
        scheduleSave();
      }
    }

    async delete(key: string): Promise<void> {
      await ready();
      if (records.delete(key)) scheduleSave();
    }

    async listByUser(user: string): Promise<SessionMeta[]> {
      await ready();
      const now = Date.now();
      return [...records]
        .filter(([, record]) => record.user === user && !expired(record, now))
        .map(([key, record]) => metaOf(key, record));
    }

    async deleteByUser(user: string): Promise<void> {
      await ready();
      let removed = false;
      for (const [key, record] of records) {
        if (record.user === user) {
          records.delete(key);
          removed = true;
        }
      }
      if (removed) scheduleSave();
    }

    async prune(): Promise<void> {
      await ready();
      if (pruneNow()) scheduleSave();
    }
  };
}
