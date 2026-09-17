/**
 * Sessions: an id in a signed cookie, the data encrypted in a store.
 *
 * Framework-free — the cookie goes through a `CookieJar` an adapter builds.
 * Not re-exported from the package index — reach it by subpath:
 *
 * ```ts
 * import { Session, MemoryStore } from "@ecosy/core/session";
 * ```
 */

export { Session } from "./session";
export { MemoryStore, type MemoryStoreOptions, type MemoryStoreMaxInfo, type MemoryStorePersist } from "./memory-store";
export type {
  CookieJar,
  CookieOptions,
  SessionClass,
  SessionData,
  SessionHandle,
  SessionLogger,
  SessionMeta,
  SessionOptions,
  SessionRecord,
  SessionStore,
  SessionStoreClass,
  SessionToken,
} from "./types";
