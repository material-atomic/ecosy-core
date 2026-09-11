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

/** A class constructible with no arguments — what an injection map holds. */
export type InjectClass<Instance = unknown> = new () => Instance;

/** Name to class. Each is constructed once per cache instance. */
export type CacheInjects = Record<string, InjectClass>;

/** An injection map, constructed: the same names, holding instances. */
export type CacheContext<Injects extends CacheInjects> = {
  [K in keyof Injects]: Injects[K] extends InjectClass<infer Instance> ? Instance : never;
};

/**
 * Called when a write fails. Receives the cause, the key it was for, and the
 * context built from the factory's `inject` map — the way to reach an app
 * logger, since the handler is a plain function fixed at the composition root
 * and cannot inject for itself. A handler written for `(error, key)` still fits.
 */
export type CacheErrorHandler<Context = unknown> = (error: unknown, key: string, context: Context) => void;

/** Builds the context once for a cache instance. */
export function buildCacheContext<Injects extends CacheInjects>(inject: Injects | undefined): CacheContext<Injects> {
  const context = {} as Record<string, unknown>;
  for (const [name, Token] of Object.entries(inject ?? {})) context[name] = new Token();
  return context as CacheContext<Injects>;
}

/**
 * Where a failed write goes by default.
 *
 * Until 0.6.0 the build dropped every console call, this one included, so a
 * failed write was silent in the published package. It now keeps `warn` and
 * `error`. An app with a logger should still pass its own handler — with
 * `inject`, it can reach that logger.
 */
export const defaultOnError: CacheErrorHandler<unknown> = (error, key) => {
  console.warn("[ecosy/cache] write failed:", key, error);
};
