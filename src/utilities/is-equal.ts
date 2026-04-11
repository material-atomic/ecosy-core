/* eslint-disable @typescript-eslint/no-explicit-any */
import { hasOwnProperty, isLiteralObject, isObject } from "./object";

function isEqualArrayBuffer(
  value1: ArrayBuffer | ArrayBufferView,
  value2: ArrayBuffer | ArrayBufferView,
) {
  if (value1.byteLength !== value2.byteLength) {
    return false;
  }

  const buffer1 = ArrayBuffer.isView(value1) ? value1.buffer : value1;
  const offset1 = ArrayBuffer.isView(value1) ? value1.byteOffset : 0;

  const buffer2 = ArrayBuffer.isView(value2) ? value2.buffer : value2;
  const offset2 = ArrayBuffer.isView(value2) ? value2.byteOffset : 0;

  const view1 = new Uint8Array(buffer1, offset1, value1.byteLength);
  const view2 = new Uint8Array(buffer2, offset2, value2.byteLength);

  for (let i = 0; i < view1.length; i++) {
    if (view1[i] !== view2[i]) {
      return false;
    }
  }

  return true;
}

const isEqualStrategies = new Map<unknown, (value1: any, value2: any) => boolean>([
  [Date, (value1: Date, value2: Date) => Object.is(value1.getTime(), value2.getTime())],
  [
    RegExp,
    (value1: RegExp, value2: RegExp) =>
      Object.is(value1.source, value2.source) && Object.is(value1.flags, value2.flags),
  ],
  [ArrayBuffer, isEqualArrayBuffer],
  [
    Map,
    (value1: Map<unknown, unknown>, value2: Map<unknown, unknown>) => {
      if (value1.size !== value2.size) {
        return false;
      }

      for (const [key, val] of value1) {
        if (!value2.has(key) || !isEqual(val, value2.get(key))) {
          return false;
        }
      }

      return true;
    },
  ],
  [
    Set,
    (value1: Set<unknown>, value2: Set<unknown>) => {
      if (value1.size !== value2.size) {
        return false;
      }

      for (const item1 of value1) {
        let hasMatch = false;

        for (const item2 of value2) {
          if (isEqual(item1, item2)) {
            hasMatch = true;
            break;
          }
        }

        if (!hasMatch) {
          return false;
        }
      }

      return true;
    },
  ],
]);

/**
 * Performs a deep structural equality check between two values.
 * Supports primitives, arrays, plain objects, Date, RegExp, Map, Set,
 * ArrayBuffer, and TypedArrays.
 *
 * @param value1 - The first value to compare.
 * @param value2 - The second value to compare.
 * @returns `true` if both values are deeply equal.
 *
 * @example
 * ```ts
 * isEqual({ a: 1 }, { a: 1 }); // true
 * isEqual([1, 2], [1, 3]); // false
 * isEqual(new Date(0), new Date(0)); // true
 * ```
 */
export function isEqual(value1: unknown, value2: unknown): boolean {
  // primitive, null, function, avoid NaN === NaN is false
  if (!isObject(value1) || !isObject(value2)) {
    return Object.is(value1, value2);
  }

  // If complex object, check constructor
  if (value1.constructor !== value2.constructor) {
    return false;
  }

  if (Array.isArray(value1)) {
    if (!Array.isArray(value2) || value1.length !== value2.length) {
      return false;
    }

    for (let i = 0; i < value1.length; i++) {
      if (!isEqual(value1[i], value2[i])) {
        return false;
      }
    }
    return true;
  }

  // TypedArray, same logic array because constructor match above
  if (ArrayBuffer.isView(value1) && ArrayBuffer.isView(value2)) {
    return isEqualArrayBuffer(value1 as unknown as ArrayBuffer, value2 as unknown as ArrayBuffer);
  }

  if (value1.constructor && isEqualStrategies.has(value1.constructor)) {
    return isEqualStrategies.get(value1.constructor)!(value1, value2);
  }

  if (!isLiteralObject(value1) || !isLiteralObject(value2)) {
    return value1 === value2;
  }

  const keys1 = Object.keys(value1 as Record<string, unknown>);
  const keys2 = Object.keys(value2 as Record<string, unknown>);

  if (keys1.length !== keys2.length) {
    return false;
  }

  for (const key of keys1) {
    if (
      !hasOwnProperty(value2, key) ||
      !isEqual((value1 as Record<string, unknown>)[key], (value2 as Record<string, unknown>)[key])
    ) {
      return false;
    }
  }

  return true;
}
