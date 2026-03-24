/**
 * Converts a PascalCase or camelCase string to kebab-case.
 * Handles consecutive uppercase characters (e.g. acronyms) gracefully.
 *
 * @param str - The string to convert.
 * @returns The kebab-case version of the string.
 *
 * @example
 * ```ts
 * pascalToKebab("MyComponent");  // "my-component"
 * pascalToKebab("HTMLParser");   // "html-parser"
 * pascalToKebab("camelCase");    // "camel-case"
 * ```
 */
export function pascalToKebab(str: string): string {
  if (!str) {
    return str;
  }

  return str
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}
