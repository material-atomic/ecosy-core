import { clone } from "./clone";
import { isLiteralObject } from "./object";

function isValidKey(key: string): boolean {
  return key !== "__proto__" && key !== "constructor" && key !== "prototype";
}

/**
 * Deep merges `target` into `source`. If both are plain objects, properties are merged
 * recursively. Otherwise, `target` replaces `source`. Prototype-polluting keys
 * (`__proto__`, `constructor`, `prototype`) are rejected.
 *
 * @param source - The base object.
 * @param target - The object whose values are merged into `source`.
 * @param cloneDeep - Custom deep clone function (defaults to `clone`).
 * @returns The merged result.
 *
 * @example
 * ```ts
 * merge({ a: 1, b: { c: 2 } }, { b: { d: 3 } });
 * // { a: 1, b: { c: 2, d: 3 } }
 * ```
 */
export function merge<AsType>(source: unknown, target: unknown, cloneDeep = clone): AsType {
  if (target === undefined) {
    return cloneDeep(source) as AsType;
  }

  if (isLiteralObject(source) && isLiteralObject(target)) {
    const result: Record<string, unknown> = { ...source };

    Object.keys(target).forEach((key) => {
      if (!isValidKey(key)) {
        return;
      }

      const sourceValue = result[key];
      const targetValue = (target as Record<string, unknown>)[key];

      if (isLiteralObject(sourceValue) && isLiteralObject(targetValue)) {
        result[key] = merge(sourceValue, targetValue, cloneDeep);
      } else {
        result[key] = cloneDeep(targetValue);
      }
    });

    return result as AsType;
  }

  return cloneDeep(target) as AsType;
}
