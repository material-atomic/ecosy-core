import { defineCipherWith } from "./define-cipher";
import { concat } from "./encoding";
import type { CipherOptions, CipherPrimitive, CryptTokenClass } from "./types";

export type AesKeyLength = 128 | 256;

export interface AesOptions extends CipherOptions {
  /** Key size in bits. Defaults to 256. */
  keyLength?: AesKeyLength;
}

const MAC_BYTES = 32;

function checkKeyLength(name: string, keyLength: number | undefined): AesKeyLength {
  const bits = keyLength ?? 256;
  if (bits !== 128 && bits !== 256) {
    throw new TypeError(`[ecosy/crypt] ${name}: keyLength must be 128 or 256, got ${keyLength}`);
  }
  return bits;
}

function importAes(raw: Uint8Array<ArrayBuffer>, name: string, usage: KeyUsage) {
  return crypto.subtle.importKey("raw", raw, { name }, false, [usage]);
}

function aesGcm(bits: AesKeyLength): CipherPrimitive {
  return {
    name: `aes-${bits}-gcm`,
    keyLength: bits / 8,
    ivLength: 12,
    async encrypt(plain, { key, iv, aad }) {
      const cryptoKey = await importAes(key, "AES-GCM", "encrypt");
      return new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, cryptoKey, plain));
    },
    async decrypt(cipher, { key, iv, aad }) {
      const cryptoKey = await importAes(key, "AES-GCM", "decrypt");
      return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: aad }, cryptoKey, cipher));
    },
  };
}

/**
 * Encrypt-then-MAC around a mode with no integrity of its own. The key is split:
 * the first part encrypts, the last 32 bytes key an HMAC-SHA256 over
 * `aad ‖ iv ‖ ciphertext`, appended to the output and checked before anything
 * is decrypted.
 */
function withHmac(
  name: string,
  bits: AesKeyLength,
  ivLength: number,
  params: (iv: Uint8Array<ArrayBuffer>) => AlgorithmIdentifier | AesCbcParams | AesCtrParams,
  webName: string,
): CipherPrimitive {
  const encBytes = bits / 8;

  const split = async (key: Uint8Array<ArrayBuffer>, usage: KeyUsage) => ({
    enc: await importAes(key.slice(0, encBytes), webName, usage),
    mac: await crypto.subtle.importKey(
      "raw",
      key.slice(encBytes),
      { name: "HMAC", hash: "SHA-256" },
      false,
      [usage === "encrypt" ? "sign" : "verify"],
    ),
  });

  return {
    name,
    keyLength: encBytes + MAC_BYTES,
    ivLength,
    async encrypt(plain, { key, iv, aad }) {
      const { enc, mac } = await split(key, "encrypt");
      const body = new Uint8Array(await crypto.subtle.encrypt(params(iv), enc, plain));
      const tag = new Uint8Array(await crypto.subtle.sign("HMAC", mac, concat(aad, iv, body)));
      return concat(body, tag);
    },
    async decrypt(cipher, { key, iv, aad }) {
      if (cipher.length < MAC_BYTES) return null;
      const { enc, mac } = await split(key, "decrypt");
      const body = cipher.slice(0, cipher.length - MAC_BYTES);
      const tag = cipher.slice(cipher.length - MAC_BYTES);
      if (!(await crypto.subtle.verify("HMAC", mac, tag, concat(aad, iv, body)))) return null;
      return new Uint8Array(await crypto.subtle.decrypt(params(iv), enc, body));
    },
  };
}

/**
 * AES-GCM crypt token. Authenticated on its own; the default choice.
 *
 * @example
 * ```ts
 * export const AppCrypt = AesGcm({ secret: [process.env.APP_SECRET!, process.env.APP_SECRET_OLD!] });
 * ```
 */
export function AesGcm(options: AesOptions = {}): CryptTokenClass {
  return defineCipherWith(aesGcm(checkKeyLength("AesGcm", options.keyLength)), true)(options);
}

/** AES-CBC crypt token, made safe with HMAC-SHA256 (encrypt-then-MAC). */
export function AesCbc(options: AesOptions = {}): CryptTokenClass {
  const bits = checkKeyLength("AesCbc", options.keyLength);
  return defineCipherWith(withHmac(`aes-${bits}-cbc-hs256`, bits, 16, (iv) => ({ name: "AES-CBC", iv }), "AES-CBC"), true)(options);
}

/** AES-CTR crypt token, made safe with HMAC-SHA256 (encrypt-then-MAC). */
export function AesCtr(options: AesOptions = {}): CryptTokenClass {
  const bits = checkKeyLength("AesCtr", options.keyLength);
  return defineCipherWith(
    withHmac(`aes-${bits}-ctr-hs256`, bits, 16, (iv) => ({ name: "AES-CTR", counter: iv, length: 64 }), "AES-CTR"),
    true,
  )(options);
}
