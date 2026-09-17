import { randomBytes, toBase64Url, toHex, utf8 } from "./encoding";
import type { CryptLogger, CryptToken } from "./types";

/**
 * Marks a token class whose guarantees are already established — built with
 * `defineCipher`, which tests a primitive of its own before first use and trusts
 * the built-in ones. A registered symbol, so a second copy of this package
 * recognises the mark too.
 */
export const SELF_TESTED = Symbol.for("@ecosy/core/crypt:self-tested");

export interface AssertCryptOptions {
  /** Overrides the token's own `strict`. `false` skips every check. */
  strict?: boolean;
  /** Kept for callers that pass one; nothing is reported, every failure throws. */
  logger?: CryptLogger;
}

const PURPOSE_A = "@ecosy/core/crypt:self-test:a";
const PURPOSE_B = "@ecosy/core/crypt:self-test:b";

const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** `text` with the character at `position` changed to a different one of the same alphabet. */
function tamperAt(text: string, position: number): string {
  const current = text[position];
  const index = BASE64URL.indexOf(current);
  if (index < 0) return text;
  const replacement = BASE64URL[(index + 17) % BASE64URL.length];
  return text.slice(0, position) + replacement + text.slice(position + 1);
}

/**
 * Variants of `text`, each changed in one character, spread across its length.
 * Several, because one change can land where a lenient decoder happens to
 * reject the result for an unrelated reason — invalid UTF-8, say — and hide a
 * missing integrity check.
 */
function tampered(text: string, count = 16): string[] {
  const variants = new Set<string>();
  const step = Math.max(1, Math.floor(text.length / count));
  for (let position = 0; position < text.length; position += step) {
    const variant = tamperAt(text, position);
    if (variant !== text) variants.add(variant);
  }
  return [...variants];
}

async function decryptsTo(token: CryptToken, cipher: string, options: { purpose: string; aad?: string }) {
  try {
    return await token.decrypt(cipher, options);
  } catch {
    return null;
  }
}

async function verifies(token: CryptToken, data: string, signature: string, purpose: string) {
  try {
    return await token.verify(data, signature, { purpose });
  } catch {
    return false;
  }
}

/**
 * Proves a crypt token keeps the guarantees everything built on it relies on,
 * using random probe values. Every token goes through it once before its first
 * use; run it in the tests of a token written by hand as well.
 *
 * Each check is an error, the first one to fail:
 *  1. `decrypt(encrypt(x))` is not `x`.
 *  2. the ciphertext is `x`, or contains it as text, hex or base64 — encryption
 *     that hands the plaintext back.
 *  3. encrypting the same input twice gives the same output — no random IV.
 *  4. a ciphertext changed in one character still decrypts.
 *  5. a ciphertext decrypts with a different AAD.
 *  6. `sign` gives two different signatures for the same input.
 *  7. `verify` rejects a real signature, or accepts an altered one or one for other data.
 *  8. a ciphertext decrypts under another purpose.
 *  9. a signature verifies under another purpose.
 *
 * `strict: false` skips the whole thing: a token whose guarantees are not
 * checked is not one to warn about halfway, it is a deliberate choice.
 *
 * @throws Error naming the first check that failed.
 */
export async function assertCrypt(token: CryptToken, options: AssertCryptOptions = {}): Promise<void> {
  const strict = options.strict ?? token.strict ?? true;

  if (!strict) return;

  const fail = (check: number, message: string) => new Error(`[ecosy/crypt] self-test ${check} failed: ${message}`);
  const relaxed = (check: number, message: string) => {
    throw fail(check, message);
  };

  const probeBytes = randomBytes(24);
  const probe = toHex(probeBytes);
  const base = { purpose: PURPOSE_A, aad: "self-test" };

  const cipher = await token.encrypt(probe, base);

  // 1
  if ((await decryptsTo(token, cipher, base)) !== probe) {
    throw fail(1, "decrypt(encrypt(x)) did not give x back");
  }

  // 2
  const exposures = [probe, toBase64Url(utf8(probe)), btoa(probe), toHex(utf8(probe))];
  if (cipher === probe || exposures.some((form) => cipher.includes(form))) {
    throw fail(2, "the output contains the plaintext");
  }

  // 3
  if ((await token.encrypt(probe, base)) === cipher) {
    relaxed(3, "the same input encrypted twice gave the same output");
  }

  // 4
  for (const altered of tampered(cipher)) {
    if ((await decryptsTo(token, altered, base)) !== null) {
      throw fail(4, "an altered ciphertext still decrypted");
    }
  }

  // 5
  if ((await decryptsTo(token, cipher, { purpose: PURPOSE_A, aad: "other" })) !== null) {
    relaxed(5, "a ciphertext decrypted with a different AAD");
  }

  // 8
  if ((await decryptsTo(token, cipher, { purpose: PURPOSE_B, aad: base.aad })) !== null) {
    throw fail(8, "a ciphertext decrypted under another purpose");
  }

  // 6
  const signature = await token.sign(probe, { purpose: PURPOSE_A });
  if ((await token.sign(probe, { purpose: PURPOSE_A })) !== signature) {
    throw fail(6, "sign gave different signatures for the same input");
  }

  // 7
  if (!(await verifies(token, probe, signature, PURPOSE_A))) {
    throw fail(7, "verify rejected a signature sign just made");
  }
  for (const altered of tampered(signature, 8)) {
    if (await verifies(token, probe, altered, PURPOSE_A)) {
      throw fail(7, "verify accepted an altered signature");
    }
  }
  if (await verifies(token, `${probe}x`, signature, PURPOSE_A)) {
    throw fail(7, "verify accepted a signature made for other data");
  }

  // 9
  if (await verifies(token, probe, signature, PURPOSE_B)) {
    throw fail(9, "a signature verified under another purpose");
  }
}

const checked = new WeakMap<object, Promise<void>>();

/**
 * Runs {@link assertCrypt} once per token class, skipping classes marked
 * {@link SELF_TESTED}. What session and csrf call before first use.
 */
export function ensureCrypt(token: CryptToken, logger?: CryptLogger): Promise<void> {
  const Class = token.constructor as unknown as Record<symbol, unknown> & object;

  if (Class[SELF_TESTED] === true) {
    return Promise.resolve();
  }

  let pending = checked.get(Class);

  if (!pending) {
    pending = assertCrypt(token, { logger });
    checked.set(Class, pending);
  }

  return pending;
}
