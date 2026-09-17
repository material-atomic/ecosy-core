/**
 * Encryption and signing tokens.
 *
 * Web Crypto only, so it runs on Node, on the edge and in Workers alike. Not
 * re-exported from the package index — reach it by subpath:
 *
 * ```ts
 * import { AesGcm } from "@ecosy/core/crypt";
 * export const AppCrypt = AesGcm({ secret: process.env.APP_SECRET });
 * ```
 */

export { AesGcm, AesCbc, AesCtr, type AesOptions, type AesKeyLength } from "./aes";
export { defineCipher } from "./define-cipher";
export { assertCrypt, ensureCrypt, SELF_TESTED, type AssertCryptOptions } from "./assert";
export type {
  CipherContext,
  CipherOptions,
  CipherPrimitive,
  CryptEncryptOptions,
  CryptLogger,
  CryptPurpose,
  CryptToken,
  CryptTokenClass,
} from "./types";
