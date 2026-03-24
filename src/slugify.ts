/** Options for {@link slugify}. */
export interface SlugifyOptions {
  /** Word separator character. Defaults to `"-"`. */
  separator?: string;
  /** Custom character-to-replacement map (merged with {@link DEFAULT_TRANSFORMER}). */
  transformer?: Record<string, string>;
  /** When `true`, silently removes characters whose replacement is longer than 1 char. */
  silent?: boolean;
}

/**
 * Default character transformer map for common non-ASCII characters.
 * Can be extended or overridden via {@link SlugifyOptions.transformer}.
 */
export const DEFAULT_TRANSFORMER: Record<string, string> = {
  "đ": "d",
  "æ": "ae",
  "ø": "o",
  "å": "a",
  "œ": "oe",
  "ß": "ss",
  "þ": "th",
  "ð": "d",
};

/**
 * Converts a string into a URL-friendly slug.
 * Handles Unicode normalization, custom character transformations,
 * and separator deduplication.
 *
 * @param str - The input string to slugify.
 * @param options - Configuration options.
 * @returns A lowercase, URL-safe slug string.
 *
 * @example
 * ```ts
 * slugify("Hello World");                    // "hello-world"
 * slugify("Xin Chào Đất Nước");             // "xin-chao-dat-nuoc"   (Vietnamese)
 * slugify("Straße nach München");            // "strasse-nach-munchen" (German)
 * slugify("Ærlig talt, det er sjovt");       // "aerlig-talt-det-er-sjovt" (Danish)
 * slugify("C'est la crème brûlée");          // "cest-la-creme-brulee" (French)
 * slugify("Foo  Bar", { separator: "_" });   // "foo_bar"
 * ```
 */
export function slugify(str: string, options: SlugifyOptions = {}): string {
  const { separator = "-", silent = false } = options;

  if (!str) {
    return "";
  }

  str = str.toLowerCase();

  // 1. Merge default transformer with user overrides (user takes precedence)
  const transformer = { ...DEFAULT_TRANSFORMER, ...options.transformer };
  const keys = Object.keys(transformer);

  if (keys.length > 0) {
    // Sort keys by length (descending) so longer matches take priority
    keys.sort((a, b) => b.length - a.length);

    const escapedKeys = keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const regex = new RegExp(escapedKeys.join("|"), "g");

    str = str.replace(regex, (match) => {
      const replaceValue = transformer[match];

      // Silent mode: discard replacements longer than 1 character
      if (silent && replaceValue.length > 1) {
        return "";
      }

      return replaceValue;
    });
  }

  // 2. Decompose Unicode (NFD) and strip diacritics + special characters
  str = str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w]|_|-/g, separator);

  // 3. Clean up separator duplicates and trim edges
  if (!separator) {
    return str.trim();
  }

  const escapedSeparator = separator.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  return str
    .replace(new RegExp(`${escapedSeparator}+`, "g"), separator)
    .replace(new RegExp(`^${escapedSeparator}|${escapedSeparator}$`, "g"), "")
    .trim();
}