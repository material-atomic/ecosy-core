/**
 * Returns the internal `[[Class]]` tag of a value using `Object.prototype.toString`.
 *
 * @param value - The value to get the string tag for.
 * @returns A string like `"[object Type]"`.
 *
 * @example
 * ```ts
 * toString([]); // "[object Array]"
 * toString(null); // "[object Null]"
 * ```
 */
export function toString(value: unknown): string {
  return Object.prototype.toString.call(value);
}
