import type { Cacher } from "./types";

/**
 * Cache held in process memory.
 *
 * A class rather than a factory, unlike `DiskCache` and `RedisCache`: there is
 * nothing to configure, so it is already constructible with no arguments and
 * can be injected as it is.
 *
 * Dies with the process and is not shared, so it is for tests and short-lived
 * work rather than a stand-in for `DiskCache` in a server that restarts. It
 * stores references without a JSON round trip, which also makes it the honest
 * check that a consumer is not leaning on serialisation side effects.
 */
export class MemoryCache implements Cacher {
  private readonly store = new Map<string, unknown>();

  async get<Value>(key: string): Promise<Value | null> {
    return this.store.has(key) ? (this.store.get(key) as Value) : null;
  }

  async set<Value>(key: string, value: Value): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}
