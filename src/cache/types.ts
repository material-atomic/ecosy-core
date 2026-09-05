/**
 * What a cache must do, and nothing more.
 *
 * Two conventions hold for every implementation here, and any replacement
 * should keep them:
 *
 *  - **A miss is `null`, never a throw.** Callers branch on a value.
 *  - **Writes are best-effort.** A cache that cannot be written should slow a
 *    request down, not fail it.
 *
 * Together they mean no caller ever wraps cache access in try/catch. Three
 * methods and structural typing also mean a consumer can declare this shape
 * itself and stay free of any dependency on this package.
 */
export interface Cacher {
  get<Value>(key: string): Promise<Value | null>;
  set<Value>(key: string, value: Value): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * A cache constructible with no arguments — what an injector needs from a
 * token. Implementations that require configuration are built by a factory
 * that captures it and hands one of these back.
 */
export type CacherClass = new () => Cacher;

/** Called when a write fails. Receives the cause and the key it was for. */
export type CacheErrorHandler = (error: unknown, key: string) => void;

/**
 * Where a failed write goes by default.
 *
 * Note this package is built with terser's `drop_console`, so in the built
 * output this is stripped and a failed write becomes silent. Anything
 * consuming the build and wanting visibility should pass its own handler.
 */
export const defaultOnError: CacheErrorHandler = (error, key) => {
  console.warn("[ecosy/cache] write failed:", key, error);
};
