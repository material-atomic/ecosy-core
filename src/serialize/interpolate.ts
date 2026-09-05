import { get } from "../utilities/get";

/**
 * Interpolates `{key}` placeholders in a string using deep path resolution via {@link get}.
 * Objects are silently replaced with empty strings to avoid `[object Object]`.
 *
 * @param pattern - Template string with `{key}` or `{path.to.key}` placeholders.
 * @param params - Data object or array to resolve values from.
 * @returns The interpolated string.
 */
export function interpolate(
  pattern: string,
  params: Record<string, unknown> | Array<unknown> = {},
): string {
  // Fast-path: skip processing if no placeholders
  if (
    !pattern ||
    typeof pattern !== "string" ||
    !pattern.trim().length ||
    !pattern.includes("{") ||
    !pattern.includes("}")
  ) {
    return pattern;
  }

  // Scan for placeholders and resolve lazily via `get`
  return pattern.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (match, variable) => {
    const value = get(params, variable);

    // Unresolved placeholders become empty strings
    if (value === null || value === undefined) {
      return "";
    }

    // Prevent "[object Object]" — only render primitives
    if (typeof value === "object") {
      return "";
    }

    return String(value);
  });
}

/** Type guards and deep normalization utilities. */
