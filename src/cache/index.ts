/**
 * Key/value cache adapters.
 *
 * Node-only, and deliberately not re-exported from the package index — the
 * same arrangement as `syhemo`. Reaching them means naming the subpath:
 *
 * ```ts
 * import { DiskCache, RedisCache } from "@ecosy/core/cache";
 * ```
 *
 * That is what keeps `node:fs` out of the browser bundle and out of anyone
 * importing `@ecosy/core` for utilities.
 */

export * from "./types";
export * from "./disk";
export * from "./memory";
export * from "./redis";
