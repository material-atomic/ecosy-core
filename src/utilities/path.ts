/** One segment of a path, and whether it was written as a bracket index. */
export interface PathSegment {
  key: string;
  index: boolean;
}

/* Marks a segment that came from `[n]`. A NUL character, so it cannot be
   confused with anything a caller writes between dots. */
const INDEX_MARK = String.fromCharCode(0);

/**
 * Splits a path into segments. The single parser behind {@link toPath}, so
 * `get`, `set` and `unset` can never disagree on what a path means.
 */
export function parsePath(path: string | readonly string[]): PathSegment[] {
  if (Array.isArray(path)) {
    return path.map((key) => ({ key, index: false }));
  }

  return (path as string)
    .replace(/\[(\d+)]/g, `.${INDEX_MARK}$1`)
    .split(".")
    .filter(Boolean)
    .map((segment) =>
      segment.startsWith(INDEX_MARK)
        ? { key: segment.slice(INDEX_MARK.length), index: true }
        : { key: segment, index: false },
    );
}

/**
 * Splits a path into keys, the way `get`, `set` and `unset` all read it: dot
 * notation (`"a.b"`), numeric brackets (`"a[0]"`), or an array of keys taken as
 * they are. Empty segments from leading or trailing dots are dropped.
 *
 * @param path - A dot/bracket string or an array of keys.
 * @returns The keys, in order.
 */
export function toPath(path: string | readonly string[]): string[] {
  return parsePath(path).map((segment) => segment.key);
}

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Throws on a key that would write through to a prototype. Reading such a key
 * is merely odd; writing one is prototype pollution.
 */
export function assertSafeKey(key: string): void {
  if (UNSAFE_KEYS.has(key)) {
    throw new TypeError(`Unsafe path segment "${key}"`);
  }
}
