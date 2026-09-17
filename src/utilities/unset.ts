import { assertSafeKey, toPath } from "./path";

/**
 * Removes whatever sits at `path` inside `data`, in place. The counterpart of
 * {@link set}, reading paths the same way.
 *
 * On an object the key is deleted. On an array the element is spliced out, so
 * the ones after it move up — `unset(state, "items[1]")` leaves no hole. A path
 * that does not exist is a no-op.
 *
 * @param data - The object or array to remove from.
 * @param path - Dot/bracket string or array of keys. Must not be empty.
 * @throws TypeError when the path is empty or a segment is `__proto__`,
 * `constructor` or `prototype`.
 */
export function unset(data: unknown, path: string | readonly string[]): void {
  const keys = toPath(path);

  if (keys.length === 0) {
    throw new TypeError("unset: path must not be empty");
  }

  keys.forEach(assertSafeKey);

  let node: unknown = data;

  for (let i = 0; i < keys.length - 1; i++) {
    if (typeof node !== "object" || node === null) return;
    node = (node as Record<string, unknown>)[keys[i]];
  }

  if (typeof node !== "object" || node === null) return;

  const last = keys[keys.length - 1];

  if (Array.isArray(node)) {
    const index = Number(last);
    if (Number.isInteger(index) && index >= 0 && index < node.length) {
      node.splice(index, 1);
    }
    return;
  }

  if (Object.prototype.hasOwnProperty.call(node, last)) {
    delete (node as Record<string, unknown>)[last];
  }
}
