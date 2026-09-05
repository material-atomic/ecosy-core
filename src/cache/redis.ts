import { defaultOnError, type CacheErrorHandler, type Cacher, type CacherClass } from "./types";

/**
 * The three commands `RedisCache` issues.
 *
 * A port, not an import: this package has no dependencies and is not about to
 * gain a Redis client. `ioredis` and `node-redis` both already match `get`,
 * `set(key, value)` and `del`, so either can be handed over directly when no
 * TTL is involved.
 *
 * TTL is where the two clients diverge — `ioredis.setex(key, seconds, value)`
 * against `node-redis.setEx(key, seconds, value)` — so that difference is
 * resolved at the composition root rather than guessed at here:
 *
 * ```ts
 * new RedisCache({
 *   get: (k) => redis.get(k),
 *   set: (k, v, ttl) => (ttl ? redis.setex(k, ttl, v) : redis.set(k, v)),
 *   del: (k) => redis.del(k),
 * });
 * ```
 */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

export interface RedisCacheInit {
  /**
   * Prefix put in front of every key, so one Redis instance can hold more than
   * this cache. Include the separator you want, e.g. `"vendor:"`.
   */
  prefix?: string;
  /**
   * Seconds until a written key expires. Omit for no expiry — reasonable for
   * content addressed by an immutable key, a mistake for anything else, since
   * a shared Redis has no other bound on growth.
   */
  ttlSeconds?: number;
  /** Where a failed write goes. Defaults to `console.warn`. */
  onError?: CacheErrorHandler;
}

/**
 * Builds a cache class backed by Redis.
 *
 * A factory for the same reason `DiskCache` is one: the client is
 * configuration, and an injector must be able to construct the result with no
 * arguments.
 *
 * ```ts
 * Pack(EsmAdapter).cache(RedisCache(client, { prefix: "vendor:" }))
 * ```
 *
 * The one implementation here that survives an instance being replaced and is
 * shared between instances — which is the whole reason to reach for it over
 * `DiskCache`.
 *
 * Values go through `JSON.stringify`, the same as `DiskCache`, so a key
 * written by one is readable by the other. Reads are forgiving in both
 * directions: a value that is missing, or present but not valid JSON, comes
 * back as `null` rather than throwing, because a cache holding something
 * unreadable and a cache holding nothing are the same thing to the caller.
 */
export function RedisCache(client: RedisLike, init: RedisCacheInit = {}): CacherClass {
  const prefix = init.prefix ?? "";
  const ttlSeconds = init.ttlSeconds;
  const onError = init.onError ?? defaultOnError;

  const keyFor = (key: string) => `${prefix}${key}`;

  return class implements Cacher {
    async get<Value>(key: string): Promise<Value | null> {
      try {
        const raw = await client.get(keyFor(key));
        return raw === null ? null : (JSON.parse(raw) as Value);
      } catch {
        // A dropped connection or an unparseable value both mean the same
        // thing to the caller: produce it again.
        return null;
      }
    }

    async set<Value>(key: string, value: Value): Promise<void> {
      try {
        await client.set(keyFor(key), JSON.stringify(value), ttlSeconds);
      } catch (error) {
        onError(error, key);
      }
    }

    async delete(key: string): Promise<void> {
      try {
        await client.del(keyFor(key));
      } catch {
        // Already gone, or unreachable — either way there is nothing useful to
        // do, and delete is not allowed to fail a request.
      }
    }
  };
}
