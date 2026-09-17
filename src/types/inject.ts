/**
 * An injection token: a class constructible with **no arguments**.
 *
 * The single currency every Ecosy package injects with. Anything needing
 * configuration is produced by a factory that captures it and returns such a
 * class — `RedisCache(client)`, `Schedule({ … })`, `Jwt({ secret })`.
 *
 * A token keeps no per-request or per-call state on itself: depending on the
 * host it may be constructed once and shared, or constructed per use.
 */
export type ClassType<Instance = unknown> = new () => Instance;

/** Property name to class token. */
export type InjectMap = {
  [k: string]: ClassType;
};

/** Drops index signatures from `T`, keeping only its declared keys. */
export type RemoveIndexSignature<T> = {
  [K in keyof T as {} extends Record<K, unknown> ? never : K]: T[K];
};

/**
 * A context plus its injected members. Each key is typed as the instance its
 * token constructs; keys that were not injected are not on the type.
 */
export type Injected<Context, Injects extends InjectMap> = Context &
  RemoveIndexSignature<{
    [K in keyof Injects]: Injects[K] extends ClassType<infer Instance> ? Instance : never;
  }>;
