import { freeze } from "../utilities/freeze";
import { hasOwnProperty, isLiteralObject, isObjectable } from "../utilities/object";
import { isFunction } from "../utilities/is-function";
import type { PrimitiveValue, SerializePrimitive } from "./types";

/** Type guards and deep normalization utilities. */
export const Primitive: SerializePrimitive = freeze({
  isString: (value: unknown): value is string => {
    return typeof value === "string";
  },
  isNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
  },
  isBoolean(value: unknown): value is boolean {
    return typeof value === "boolean";
  },
  isPrimitive(value: unknown): value is PrimitiveValue {
    return !isObjectable(value);
  },
  isDate(value: unknown): value is Date {
    return value instanceof Date && !Number.isNaN(value.getTime());
  },
  isPlainObject: isLiteralObject,
  normalize<T, R = unknown>(data: T): R {
    const prim = Primitive;

    if (prim.isPrimitive(data)) {
      if (typeof data === "bigint") return data.toString() as R;
      return data as R;
    }

    if (prim.isDate(data)) {
      return data.toISOString() as R;
    }

    if (Array.isArray(data)) {
      return data.map((item) => prim.normalize(item)) as R;
    }

    // Use isLiteralObject for consistent plain-object detection
    if (isLiteralObject(data)) {
      const result: Record<string, unknown> = {};
      for (const key in data) {
        if (hasOwnProperty(data, key)) {
          const val = data[key];
          if (val !== undefined) {
            result[key] = prim.normalize(val);
          }
        }
      }
      return result as R;
    }

    if (data && hasOwnProperty(data, "toJSON") && isFunction(data.toJSON)) {
      return data.toJSON() as R;
    }

    return {} as R;
  },
});
