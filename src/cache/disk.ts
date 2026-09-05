import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defaultOnError, type CacheErrorHandler, type Cacher, type CacherClass } from "./types";

export interface DiskCacheInit {
  /** Where a failed write goes. Defaults to `console.warn`. */
  onError?: CacheErrorHandler;
}

/**
 * Builds a cache class backed by the local filesystem, one JSON file per key.
 *
 * A factory rather than a class you construct yourself, because the point of a
 * token is that whoever injects it does not need to know what its constructor
 * wants. The directory is captured here and the result takes no arguments, so
 * it drops straight into an injector.
 *
 * ```ts
 * Pack(EsmAdapter).cache(DiskCache(configs.env.cache.dir))
 * ```
 *
 * The cache survives a restart, which is what separates it from
 * `MemoryCache`. It does NOT survive the instance being replaced, and two
 * instances do not share it — that is the line where `RedisCache` takes over.
 *
 * Values go through `JSON.stringify`, so they have to survive a round trip:
 * plain objects, arrays, strings, numbers. No `Date`, `Map`, or class
 * instances.
 *
 * Keys are percent-encoded into filenames, so any string is accepted, but the
 * result still has to be a legal filename — keep keys under ~200 characters,
 * and hash anything derived from arbitrary input.
 *
 * @param dir Directory to hold the files. Defaults to `<cwd>/.cache`.
 */
export function DiskCache(dir?: string, init: DiskCacheInit = {}): CacherClass {
  const root = dir ?? join(process.cwd(), ".cache");
  const onError = init.onError ?? defaultOnError;

  return class implements Cacher {
    readonly dir = root;

    private fileFor(key: string): string {
      return join(root, `${encodeURIComponent(key)}.json`);
    }

    async get<Value>(key: string): Promise<Value | null> {
      try {
        return JSON.parse(await readFile(this.fileFor(key), "utf-8")) as Value;
      } catch {
        // Missing file, unreadable file, or one left half-written by a crash.
        // All three mean the same thing to the caller: produce it again.
        return null;
      }
    }

    async set<Value>(key: string, value: Value): Promise<void> {
      try {
        await mkdir(root, { recursive: true });
        await writeFile(this.fileFor(key), JSON.stringify(value), "utf-8");
      } catch (error) {
        onError(error, key);
      }
    }

    async delete(key: string): Promise<void> {
      try {
        await unlink(this.fileFor(key));
      } catch {
        // Already gone is the desired end state.
      }
    }
  };
}
