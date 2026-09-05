import { DEFAULT_TRANSFORMER, slugify, type SlugifyOptions } from "./slugify";

/** Position of a match within the original string. */
export interface SearchPosition {
  /** Start index in the original string. */
  start: number;
  /** Length of the matched substring. */
  length: number;
}

/** Result of a {@link searchify} call. */
export interface SearchResult {
  /** Array of matched substrings from the original string. */
  matches: string[];
  /** Corresponding positions for each match. */
  positions: SearchPosition[];
}

/** Slugify options tuned for search: no separator, silent multi-char replacements. */
const HIGHLIGHT_SEARCH_OPTIONS: SlugifyOptions = {
  separator: "",
  silent: true,
  transformer: { ...DEFAULT_TRANSFORMER },
};

/**
 * Performs a diacritic-insensitive fuzzy search by comparing slugified characters.
 * Returns all matching substrings and their positions in the original string.
 *
 * Uses a **sliding window** algorithm with per-character slugification cache
 * for optimal performance on repeated characters.
 *
 * @param original - The original string to search within.
 * @param searchStr - The search term (will be slugified for comparison).
 * @returns A {@link SearchResult} with matched substrings and their positions.
 *
 * @example
 * ```ts
 * searchify("Xin Chào Việt Nam", "viet");
 * // { matches: ["Việt"], positions: [{ start: 9, length: 4 }] }
 *
 * searchify("Crème Brûlée", "brulee");
 * // { matches: ["Brûlée"], positions: [{ start: 6, length: 6 }] }
 * ```
 */
export function searchify(original: string, searchStr: string): SearchResult {
  const slugified = slugify(searchStr, HIGHLIGHT_SEARCH_OPTIONS);
  const searchLength = slugified.length;
  const result: SearchResult = { matches: [], positions: [] };

  if (!searchLength) {
    return result;
  }

  const charCache = new Map<string, string>();

  // Pre-process: map each original character to its slugified form (cached)
  const originalChars = [...original.split("")].map((char, index) => {
    let slug = charCache.get(char);

    if (slug === undefined) {
      slug = slugify(char, HIGHLIGHT_SEARCH_OPTIONS);
      charCache.set(char, slug);
    }

    return {
      originIndex: index,
      slugified: slug,
      char,
    };
  });

  // Filter consecutive whitespace for performance
  const originalFiltered = originalChars.filter((obj, index, chars) => {
    if (index === 0) return true;
    if (obj.char === " " && chars[index - 1].char === " ") return false;
    return true;
  });

  if (originalFiltered.length < searchLength) {
    return result;
  }

  // Core algorithm: sliding window match
  for (let i = 0; i < originalFiltered.length; ) {
    const firstChar = originalFiltered[i];

    if (firstChar.slugified === "") {
      i++;
      continue;
    }

    let currentSlugified = "";
    let endPosition = i;
    let isMatch = true;

    while (currentSlugified.length < searchLength && endPosition < originalFiltered.length) {
      const currentChar = originalFiltered[endPosition];

      if (currentChar.slugified !== "") {
        currentSlugified += currentChar.slugified;

        if (!slugified.startsWith(currentSlugified)) {
          isMatch = false;
          break;
        }
      }
      endPosition++;
    }

    if (isMatch && currentSlugified === slugified) {
      const lastChar = originalFiltered[endPosition - 1];
      const matchText = original.substring(firstChar.originIndex, lastChar.originIndex + 1);

      result.matches.push(matchText);
      result.positions.push({
        start: firstChar.originIndex,
        length: matchText.length,
      });

      i = endPosition;
    } else {
      i++;
    }
  }

  return result;
}
