import { assertSafeKey, parsePath } from "./path";

/** Whether a value can be walked into: a plain object or an array. */
function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  if (Array.isArray(value)) return true;
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

/**
 * Writes `value` at `path` inside `data`, in place. The counterpart of
 * {@link get}, reading paths the same way.
 *
 * Destructive along the way: whatever sits on the path and cannot be walked
 * into — a primitive, `null`, a `Date`, a `Map`, a class instance — is replaced
 * by a fresh container. A plain object or an array already on the path is kept
 * and walked into. A missing container is an array when the next segment is a
 * bracket index (`"items[0]"`), otherwise a plain object (`"items.0"`).
 *
 * Returns nothing: `data` itself is what changed.
 *
 * @param data - A plain object or array to write into.
 * @param path - Dot/bracket string or array of keys. Must not be empty.
 * @param value - The value to store.
 * @throws TypeError when `data` cannot be written into, the path is empty, or a
 * segment is `__proto__`, `constructor` or `prototype`.
 *
 * @example
 * ```ts
 * const state = { cart: { items: [{ qty: 1 }] } };
 * set(state, "cart.items[0].qty", 3);
 * set(state, "cart.coupon.code", "SALE"); // creates { coupon: { code } }
 * ```
 */
export function set(data: unknown, path: string | readonly string[], value: unknown): void {
  if (!isContainer(data)) {
    throw new TypeError("set: data must be a plain object or an array");
  }

  const segments = parsePath(path);

  if (segments.length === 0) {
    throw new TypeError("set: path must not be empty");
  }

  segments.forEach((segment) => assertSafeKey(segment.key));

  let node = data as Record<string, unknown>;

  for (let i = 0; i < segments.length - 1; i++) {
    const key = segments[i].key;

    if (!isContainer(node[key])) {
      node[key] = segments[i + 1].index ? [] : {};
    }

    node = node[key] as Record<string, unknown>;
  }

  node[segments[segments.length - 1].key] = value;
}
