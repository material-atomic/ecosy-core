import type { Freezable, LiteralObject } from "../types/built-in";

/** Anything JSON can hold as a leaf, plus the JS primitives that need special care. */
export type PrimitiveValue = string | number | boolean | null | undefined | symbol | bigint;

/** Options for {@link queryString.stringify}. */
export interface SerializeQueryOptions {
  /** Array serialization format. Defaults to `"none"`. */
  arrayFormat?: "bracket" | "index" | "comma" | "separator" | "none";
  /** Separator character when `arrayFormat` is `"separator"`. Defaults to `","`. */
  arrayFormatSeparator?: string;
  /** Skip keys whose value is `null` or `undefined`. */
  skipNull?: boolean;
  /** Skip keys whose value is an empty string. */
  skipEmptyString?: boolean;
  /** Whether to URL-encode keys and values, or a custom encoder function. Defaults to `true`. */
  encode?: boolean | ((value: string) => string);
  /** Reject keys with non-standard characters when `true`. Defaults to `true`. */
  strict?: boolean;
  /** Sort keys alphabetically, or provide a custom comparator. */
  sort?: boolean | ((a: string, b: string) => number);
}

export type SerializePrimitive = Freezable<{
  isString(value: unknown): value is string;
  isNumber(value: unknown): value is number;
  isBoolean(value: unknown): value is boolean;
  isPrimitive(value: unknown): value is PrimitiveValue;
  isDate(value: unknown): value is Date;
  isPlainObject(value: unknown): value is LiteralObject;
  normalize<T, R = unknown>(data: T): R;
}>;

export type SerializeJSON = Freezable<{
  stringify: (value: unknown, space?: number) => string;
  parse: <T = unknown>(
    text: string,
    reviver?: ((this: any, key: string, value: any) => any) | undefined,
  ) => T | null;
}>;

export type SerializeURL = Freezable<{
  encode(value: string, component?: boolean | ((value: string) => string)): string;
  decode(value: string, component?: boolean | ((value: string) => string)): string;
  build(uri: string, params?: Record<string, PrimitiveValue> | null): string;
}>;

export type SerializeQueryString = Freezable<{
  parse(query: string): Record<string, string>;
  stringify(params: Record<string, unknown>, options?: SerializeQueryOptions): string;
}>;
