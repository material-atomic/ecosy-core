import type { ClassType } from "../types/inject";

/**
 * Where a crypt token reports what a developer should know about: a key made
 * up for this process, a relaxed self-test, a key id it does not hold.
 *
 * Console-shaped, so `console` itself fits and so does `@ecosy/logger`. Only
 * `warn` is used — the build keeps `console.warn`, it drops `console.info`.
 */
export interface CryptLogger {
  warn(...args: unknown[]): void;
}

/**
 * Keeps two uses of one token apart. Everything encrypted or signed under one
 * purpose is unreadable, and every signature invalid, under another — so a
 * CSRF token can never pass for a session id's signature.
 */
export interface CryptPurpose {
  purpose: string;
}

export interface CryptEncryptOptions extends CryptPurpose {
  /**
   * Additional authenticated data: not stored in the output, but required to
   * be the same when decrypting. Binds a ciphertext to where it belongs — a
   * session's value to that session's id — so it cannot be copied elsewhere.
   */
  aad?: string;
}

/**
 * What every crypt token does, whether built with {@link defineCipher} or
 * written by hand.
 *
 * A miss is `null` or `false`, never a throw: a forged cookie is input, not an
 * error in the app.
 */
export interface CryptToken {
  /**
   * `false` relaxes two self-test checks — a ciphertext that repeats for the
   * same input, and one that ignores its AAD — from errors to warnings.
   * Nothing else is ever relaxed. Absent means strict.
   */
  readonly strict?: boolean;

  /**
   * Encrypts text, authenticated. The output is URL- and cookie-safe text.
   * Binary data goes in encoded — base64, say — so what comes back out is the
   * same text.
   */
  encrypt(plain: string, options: CryptEncryptOptions): Promise<string>;

  /** The plaintext, or `null` for anything that does not decrypt under these options. */
  decrypt(cipher: string, options: CryptEncryptOptions): Promise<string | null>;

  /** A signature for `data`, the same every time under the same key. */
  sign(data: string, options: CryptPurpose): Promise<string>;

  /** Whether `signature` is one this token made for `data`, under any of its keys. */
  verify(data: string, signature: string, options: CryptPurpose): Promise<boolean>;

  /**
   * Signatures of `data` under every key held, current first. What a lookup by
   * signed id tries after a secret rotation. Optional for hand-written tokens.
   */
  signAll?(data: string, options: CryptPurpose): Promise<string[]>;
}

export type CryptTokenClass = ClassType<CryptToken>;

/** What a cipher primitive is handed for one operation. */
export interface CipherContext {
  /** Raw key bytes, `keyLength` long, derived for this purpose. */
  key: Uint8Array<ArrayBuffer>;
  /** Fresh random bytes, `ivLength` long, per encryption. */
  iv: Uint8Array<ArrayBuffer>;
  /** Everything the output must be bound to. */
  aad: Uint8Array<ArrayBuffer>;
}

/**
 * The algorithm itself — all {@link defineCipher} asks for. Keys, rotation, key
 * ids, purposes, the output format and signing are the factory's job.
 */
export interface CipherPrimitive {
  /** Identifies the algorithm in the output. Letters, digits and dashes. */
  name: string;
  /** Bytes of key material per purpose. */
  keyLength: number;
  /** Bytes of IV per encryption. */
  ivLength: number;
  encrypt(plain: Uint8Array<ArrayBuffer>, context: CipherContext): Promise<Uint8Array>;
  /** `null` — or a throw — when the input does not authenticate. */
  decrypt(cipher: Uint8Array<ArrayBuffer>, context: CipherContext): Promise<Uint8Array | null>;
}

export interface CipherOptions {
  /**
   * The secret, or several: encryption and signing use the first, decryption
   * and verification accept any. Rotate by putting the new one first and
   * dropping the old one once nothing made with it is still in use.
   *
   * Omitted, a key is generated for this process — see the warning it logs.
   */
  secret?: string | readonly string[];
  /** See {@link CryptToken.strict}. Only matters for a primitive of your own. */
  strict?: boolean;
  /** Defaults to `console`. */
  logger?: CryptLogger;
}
