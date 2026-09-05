import { interpolate } from "./interpolate";
import { Json } from "./json";
import { Primitive } from "./primitive";
import { queryString } from "./query-string";
import { Url } from "./url";

export * from "./types";
export { interpolate } from "./interpolate";
export { Json } from "./json";
export { Primitive } from "./primitive";
export { queryString } from "./query-string";
export { Url } from "./url";

/**
 * Centralized serialization engine and type-guard toolkit.
 * Addresses common pitfalls of `JSON.stringify`/`JSON.parse` — BigInt safety,
 * Date preservation, undefined stripping, and safe URL encoding/decoding.
 *
 * This is the convenience surface: it gathers every part under one name.
 * Referencing it keeps all of them, because a class is a single binding and a
 * bundler cannot drop half of one. Code that cares about what it ships should
 * import the part it uses instead — each lives in its own module, so nothing
 * else comes with it:
 *
 * ```ts
 * import { Primitive } from "@ecosy/core/serialize/primitive";
 * import { queryString } from "@ecosy/core/serialize/query-string";
 * ```
 *
 * The two are the same objects, so mixing them is free.
 *
 * @example
 * ```ts
 * Serialize.JSON.stringify({ date: new Date(), big: 123n });
 * Serialize.JSON.parse<User>(jsonText);
 * Serialize.URL.encode("hello world");
 * Serialize.queryString.stringify({ page: 1, tags: ["a", "b"] });
 * ```
 */
export class Serialize {
  static readonly interpolate = interpolate;

  /** Type guards and deep normalization utilities. */
  static readonly Primitive = Primitive;

  /** Safe JSON stringify/parse that never throws. */
  static readonly JSON = Json;

  /** URL encoding/decoding with malformed-character recovery. */
  static readonly URL = Url;

  /** Query string parse/stringify with configurable array formats. */
  static readonly queryString = queryString;
}
