/**
 * Capitalizes the first character of a string.
 *
 * @param str - The string to capitalize.
 * @returns The string with its first character in uppercase.
 *
 * @example
 * ```ts
 * ucfirst("hello"); // "Hello"
 * ```
 */
export function ucfirst<T extends string>(str: T): Capitalize<T> {
  return (str.charAt(0).toUpperCase() + str.slice(1)) as Capitalize<T>;
}
