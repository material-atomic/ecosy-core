import type { BatchClass } from "../batch";
import type { CryptTokenClass } from "../crypt/types";
import type { QueueClass } from "../queue";
import type { ClassType, Promisable } from "../types";

/** Console-shaped; only `warn` is used. */
export interface SessionLogger {
  warn(...args: unknown[]): void;
}

/** Attributes for the session cookie. `maxAge` is in seconds, as `Set-Cookie` has it. */
export interface CookieOptions {
  maxAge?: number;
  path?: string;
  domain?: string;
  sameSite?: "lax" | "strict" | "none";
  secure?: boolean;
  httpOnly?: boolean;
}

/**
 * How a session reads and writes its cookie — the one thing it needs from the
 * framework. A Next route, a Hono context and an Express `req`/`res` pair each
 * fit in a few lines, which is what keeps the session itself framework-free.
 */
export interface CookieJar {
  get(name: string): string | null | undefined;
  set(name: string, value: string, options: CookieOptions): Promisable<void>;
  delete(name: string, options: CookieOptions): Promisable<void>;
}

/**
 * One session as a store holds it. Nothing in it is readable without the
 * crypt token: `data` is encrypted, `user` is a signature of the user id, and
 * the key it is stored under is a signature of the session id.
 */
export interface SessionRecord {
  data: string;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds. A store may drop the record once this has passed; the session ignores it either way. */
  expiresAt: number;
  user?: string;
}

/** A record without its data — what a store may hand out for listing. */
export type SessionMeta = Omit<SessionRecord, "data"> & { key: string };

/**
 * Where sessions are kept. Three methods are required; the rest unlock
 * features and are used when present.
 *
 * A miss is `null`, never a throw. A write that fails should throw: a session
 * that silently did not save logs people out.
 */
export interface SessionStore {
  get(key: string): Promise<SessionRecord | null>;
  set(key: string, record: SessionRecord): Promise<void>;
  delete(key: string): Promise<void>;
  /** Every session of a user, by the `user` signature. Enables listing devices. */
  listByUser?(user: string): Promise<SessionMeta[]>;
  /** Removes every session of a user, by the `user` signature. Enables `revokeUser`. */
  deleteByUser?(user: string): Promise<void>;
  /** Removes expired records. */
  prune?(): Promise<void>;
}

export type SessionStoreClass = ClassType<SessionStore>;

export interface SessionOptions {
  /** Crypt token. Defaults to `AesGcm()` — a generated key, with its warning. */
  encrypt?: CryptTokenClass;
  /** Defaults to `MemoryStore()`. */
  store?: SessionStoreClass;
  /** Orders `set` and `setQueue` per session. Without one they apply as soon as they are reached. */
  queue?: QueueClass;
  /** Gathers `set` calls per session. Without one each `set` goes on alone. */
  batch?: BatchClass;
  cookie?: CookieOptions & { name?: string };
  /** Milliseconds a session lives after its last save. Default 7 days. */
  maxAge?: number;
  /**
   * Keeps the live states on `globalThis` under this name, and — when no
   * `store` is given — the default MemoryStore's records under it too. Every
   * copy of the module then shares one session state: needed on Next, where
   * the proxy and the route handlers are separate module graphs. Anchoring the
   * class with `@ecosy/anchor` does the same.
   */
  storageKey?: string;
  regenerate?: {
    /** Milliseconds the old id still works after `regenerate`. Default 30 000. */
    grace?: number;
  };
  logger?: SessionLogger;
}

export type SessionData = Record<string, unknown>;

/** One request's view of a session. */
export interface SessionHandle {
  /** The session id. A new session has one before it is ever saved. */
  readonly id: string;
  /** True until the session has been saved once. */
  readonly isNew: boolean;

  /** A copy of the state as it is now, or of the value at `path`. */
  get<Value = SessionData>(): Value;
  get<Value = unknown>(path: string | readonly string[], defaultValue?: Value): Value;

  /** Like `get`, after the `set`/`setQueue` work pending at the time of the call — and the save it ends in — has finished. */
  getAsync<Value = SessionData>(): Promise<Value>;
  getAsync<Value = unknown>(path: string | readonly string[], defaultValue?: Value): Promise<Value>;

  /** Merges `partial` into the state through the batch, then the queue, then saves. */
  set(partial: SessionData): Promise<void>;
  /** Merges `partial` into the state through the queue only, then saves. */
  setQueue(partial: SessionData): Promise<void>;
  /** Writes `value` at `path` in the state right away, then saves. */
  setIn(path: string | readonly string[], value: unknown): Promise<void>;
  /** Removes `path` from the state right away, then saves. */
  unset(path: string | readonly string[]): Promise<void>;
  /** Saves the state as it is now. */
  persist(): Promise<void>;
  /**
   * Saves the session even while it is empty, so it — and its cookie — exist
   * from now on. For an anonymous session something else is bound to before
   * sign-in: a CSRF cookie, say.
   */
  start(): Promise<void>;

  /** Ties the session to a user, so `revokeUser` can end it. `null` unties it. */
  setUser(userId: string | null): Promise<void>;
  /** Moves the state to a new id and cookie. The old id keeps working for the grace period. */
  regenerate(): Promise<void>;
  /** Deletes the session and its cookie. The handle continues with a new, empty session. */
  destroy(): Promise<void>;
}

export interface SessionToken {
  /** The session the cookie in `jar` names, or a new one. */
  load(jar: CookieJar): Promise<SessionHandle>;
  /** Ends every session tied to `userId`. Requires a store with `deleteByUser`. */
  revokeUser(userId: string): Promise<void>;
}

export type SessionClass = ClassType<SessionToken>;
