import { isEqual } from "../utilities/is-equal";
import { isLiteralObject } from "../utilities/object";

export type PathKeys = readonly string[];

/** A change between two states: a value written at a path, or a path removed. */
export type PathChange = { path: PathKeys; value: unknown; removed?: false } | { path: PathKeys; removed: true };

/**
 * The changes that turn `before` into `after`, path by path.
 *
 * Plain objects are walked into; anything else — arrays included, the way
 * `merge` treats them — is compared whole and reported as one change.
 */
export function diffPaths(before: unknown, after: unknown, prefix: PathKeys = []): PathChange[] {
  if (isLiteralObject(before) && isLiteralObject(after)) {
    const changes: PathChange[] = [];
    const left = before as Record<string, unknown>;
    const right = after as Record<string, unknown>;

    for (const key of Object.keys(right)) {
      if (!Object.prototype.hasOwnProperty.call(left, key)) {
        changes.push({ path: [...prefix, key], value: right[key] });
      } else {
        changes.push(...diffPaths(left[key], right[key], [...prefix, key]));
      }
    }

    for (const key of Object.keys(left)) {
      if (!Object.prototype.hasOwnProperty.call(right, key)) {
        changes.push({ path: [...prefix, key], removed: true });
      }
    }

    return changes;
  }

  return isEqual(before, after) ? [] : [{ path: prefix, value: after }];
}

/** The paths a partial writes: its plain objects walked into, everything else a leaf. */
export function leafPaths(partial: unknown, prefix: PathKeys = []): PathKeys[] {
  if (!isLiteralObject(partial)) return [prefix];

  const keys = Object.keys(partial as Record<string, unknown>);
  if (keys.length === 0) return [prefix];

  return keys.flatMap((key) => leafPaths((partial as Record<string, unknown>)[key], [...prefix, key]));
}

/* Joins keys that may themselves contain dots. A control character nobody writes into a key. */
const SEPARATOR = String.fromCharCode(1);

const encode = (path: PathKeys) => path.join(SEPARATOR);

/**
 * The write order of every path touched while writes are still pending.
 *
 * A write that lands late — a `set` held in a batch or queue — must not undo a
 * write made after it was called. Each write takes the next number; a path
 * remembers the highest number written to it, and a late write gives way on
 * any path where a later number, on it, above it or below it, was recorded.
 */
export class WriteOrder {
  private counter = 0;
  private readonly paths = new Map<string, number>();

  /** The number for a new write. */
  next(): number {
    return ++this.counter;
  }

  /** Records that write `seq` touched `path`. */
  record(path: PathKeys, seq: number): void {
    const key = encode(path);
    const current = this.paths.get(key) ?? 0;
    if (seq > current) this.paths.set(key, seq);
  }

  /** The latest write touching `path` itself, anything inside it, or anything containing it. */
  latest(path: PathKeys): number {
    const key = encode(path);
    let latest = 0;

    for (const [recorded, seq] of this.paths) {
      const related =
        recorded === key ||
        key === "" ||
        recorded === "" ||
        recorded.startsWith(key + SEPARATOR) ||
        key.startsWith(recorded + SEPARATOR);

      if (related && seq > latest) latest = seq;
    }

    return latest;
  }

  /** Forgets recorded paths — once nothing is pending, no late write can need them. */
  clear(): void {
    this.paths.clear();
  }
}
