import { assertCrypt, SELF_TESTED } from "./assert";
import { fromBase64Url, fromUtf8, randomBytes, toBase64Url, utf8 } from "./encoding";
import type {
  CipherOptions,
  CipherPrimitive,
  CryptEncryptOptions,
  CryptLogger,
  CryptPurpose,
  CryptToken,
  CryptTokenClass,
} from "./types";

const VERSION = "e1";
const HKDF_SALT = utf8("@ecosy/core/crypt");

/* Per process, not per module graph: Next evaluates a module once per layer,
   and a key made in the route layer must decrypt in the page layer. */
const AUTO_KEY = Symbol.for("@ecosy/core/crypt:auto-key");
const WARNED = Symbol.for("@ecosy/core/crypt:warned");

type Holder = typeof globalThis & {
  [AUTO_KEY]?: Uint8Array<ArrayBuffer>;
  [WARNED]?: Set<string>;
};

function warnOnce(logger: CryptLogger, id: string, message: string) {
  const holder = globalThis as Holder;
  const warned = (holder[WARNED] ??= new Set());
  if (warned.has(id)) return;
  warned.add(id);
  logger.warn(message);
}

function autoKey(): Uint8Array<ArrayBuffer> {
  const holder = globalThis as Holder;
  if (!holder[AUTO_KEY]) {
    Object.defineProperty(holder, AUTO_KEY, {
      value: randomBytes(32),
      writable: false,
      configurable: false,
      enumerable: false,
    });
  }
  return holder[AUTO_KEY]!;
}

interface KeyEntry {
  kid: string;
  derive(label: string, bytes: number): Promise<Uint8Array<ArrayBuffer>>;
}

function keyEntry(material: Uint8Array<ArrayBuffer>): Promise<KeyEntry> {
  const base = crypto.subtle.importKey("raw", material, "HKDF", false, ["deriveBits"]);
  const cache = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();

  const derive = (label: string, bytes: number) => {
    const id = `${bytes}:${label}`;
    let pending = cache.get(id);
    if (!pending) {
      pending = base
        .then((key) =>
          crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: HKDF_SALT, info: utf8(label) }, key, bytes * 8),
        )
        .then((bits) => new Uint8Array(bits));
      cache.set(id, pending);
    }
    return pending;
  };

  return derive(JSON.stringify(["kid"]), 6).then((bits) => ({ kid: toBase64Url(bits), derive }));
}

function requirePurpose(options: CryptPurpose | undefined): string {
  const purpose = options?.purpose;
  if (typeof purpose !== "string" || purpose.length === 0) {
    throw new TypeError("[ecosy/crypt] a non-empty `purpose` is required");
  }
  return purpose;
}

function normaliseSecrets(secret: CipherOptions["secret"]): string[] | null {
  if (secret === undefined) return null;

  const list = typeof secret === "string" ? [secret] : [...secret];

  if (list.length === 0 || list.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new TypeError("[ecosy/crypt] `secret` must be a non-empty string or a non-empty list of them");
  }

  return list;
}

/**
 * Builds a crypt token factory from a cipher primitive.
 *
 * The primitive only encrypts and decrypts bytes. Everything that is easy to
 * get wrong around it is done here, the same way for every algorithm:
 *
 *  - **keys per purpose** — HKDF-SHA256 from the secret, labelled with the
 *    algorithm and purpose, so one secret serves many uses that cannot be
 *    mistaken for each other;
 *  - **rotation** — `secret` may be a list: the first encrypts and signs, all
 *    of them decrypt and verify, told apart by a key id carried in the output;
 *  - **a generated key** when no secret is given, one per process, with a
 *    warning saying what that costs;
 *  - **the output format** `e1.<algorithm>.<key id>.<iv>.<ciphertext>`, with
 *    everything but the ciphertext bound in as AAD;
 *  - **signing** — HMAC-SHA256 under a purpose key, independent of the
 *    algorithm, so a signature survives a change of cipher.
 *
 * A primitive of your own is put through {@link assertCrypt} before its first
 * use; the built-in ones are not, their tests do that.
 *
 * @example
 * ```ts
 * export const ChaCha = defineCipher({ name: "chacha20-poly1305", keyLength: 32, ivLength: 12, encrypt, decrypt });
 * export const AppCrypt = ChaCha({ secret: process.env.APP_SECRET });
 * ```
 */
export function defineCipher(primitive: CipherPrimitive) {
  return defineCipherWith(primitive, false);
}

/** @internal `trusted` skips the self-test — for primitives this package ships and tests. */
export function defineCipherWith(primitive: CipherPrimitive, trusted: boolean) {
  if (!/^[A-Za-z0-9-]+$/.test(primitive.name)) {
    throw new TypeError(`[ecosy/crypt] cipher name "${primitive.name}" may only use letters, digits and dashes`);
  }
  if (!(primitive.keyLength > 0) || !(primitive.ivLength >= 0)) {
    throw new TypeError(`[ecosy/crypt] cipher "${primitive.name}" needs a positive keyLength and a non-negative ivLength`);
  }

  const algorithm = primitive.name;

  return function cipherFactory(options: CipherOptions = {}): CryptTokenClass {
    const secrets = normaliseSecrets(options.secret);
    const logger = options.logger ?? console;
    const strict = options.strict ?? true;

    let keyring: Promise<KeyEntry[]> | null = null;

    const keys = () => {
      if (!keyring) {
        if (!secrets) {
          warnOnce(
            logger,
            "auto-key",
            "[ecosy/crypt] No secret given: using a key generated for this process. " +
              "Everything encrypted or signed with it is unreadable after a restart and " +
              "is not shared between instances. Pass `secret` to keep it.",
          );
        }
        const materials = secrets ? secrets.map((secret) => utf8(secret)) : [autoKey()];
        keyring = Promise.all(materials.map(keyEntry));
      }
      return keyring;
    };

    const find = async (kid: string) => {
      const entry = (await keys()).find((candidate) => candidate.kid === kid);
      if (!entry) {
        warnOnce(
          logger,
          `kid:${algorithm}:${kid}`,
          `[ecosy/crypt] "${kid}" is not a key this token holds — made with a secret since removed, ` +
            "or with a generated key from an earlier process. Treated as invalid.",
        );
      }
      return entry;
    };

    const aadFor = (kid: string, purpose: string, aad?: string) =>
      utf8(JSON.stringify([VERSION, algorithm, kid, purpose, aad ?? ""]));

    const signWith = async (entry: KeyEntry, data: string, purpose: string) => {
      const raw = await entry.derive(JSON.stringify(["sign", purpose]), 32);
      const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, utf8(data)));
      return `${entry.kid}.${toBase64Url(mac)}`;
    };

    class CipherToken implements CryptToken {
      static readonly [SELF_TESTED] = true;

      readonly strict = strict;

      async encrypt(plain: string, encryptOptions: CryptEncryptOptions): Promise<string> {
        const purpose = requirePurpose(encryptOptions);
        if (typeof plain !== "string") {
          throw new TypeError("[ecosy/crypt] encrypt takes text; encode binary data first");
        }
        await ready();

        const [entry] = await keys();
        const iv = randomBytes(primitive.ivLength);
        const key = await entry.derive(JSON.stringify(["enc", algorithm, purpose]), primitive.keyLength);
        const sealed = await primitive.encrypt(utf8(plain), { key, iv, aad: aadFor(entry.kid, purpose, encryptOptions.aad) });

        return [VERSION, algorithm, entry.kid, toBase64Url(iv), toBase64Url(sealed)].join(".");
      }

      async decrypt(cipher: string, encryptOptions: CryptEncryptOptions): Promise<string | null> {
        const purpose = requirePurpose(encryptOptions);
        if (typeof cipher !== "string") return null;
        await ready();

        const parts = cipher.split(".");
        if (parts.length !== 5 || parts[0] !== VERSION || parts[1] !== algorithm) return null;

        const [, , kid, ivText, sealedText] = parts;
        const iv = fromBase64Url(ivText);
        const sealed = fromBase64Url(sealedText);
        if (!iv || !sealed || iv.length !== primitive.ivLength) return null;

        const entry = await find(kid);
        if (!entry) return null;

        const key = await entry.derive(JSON.stringify(["enc", algorithm, purpose]), primitive.keyLength);

        try {
          const plain = await primitive.decrypt(sealed, { key, iv, aad: aadFor(kid, purpose, encryptOptions.aad) });
          return plain ? fromUtf8(plain) : null;
        } catch {
          return null;
        }
      }

      async sign(data: string, signOptions: CryptPurpose): Promise<string> {
        const purpose = requirePurpose(signOptions);
        await ready();
        const [entry] = await keys();
        return signWith(entry, String(data), purpose);
      }

      async signAll(data: string, signOptions: CryptPurpose): Promise<string[]> {
        const purpose = requirePurpose(signOptions);
        await ready();
        return Promise.all((await keys()).map((entry) => signWith(entry, String(data), purpose)));
      }

      async verify(data: string, signature: string, signOptions: CryptPurpose): Promise<boolean> {
        const purpose = requirePurpose(signOptions);
        if (typeof signature !== "string") return false;
        await ready();

        const dot = signature.indexOf(".");
        if (dot <= 0) return false;

        const mac = fromBase64Url(signature.slice(dot + 1));
        if (!mac || mac.length !== 32) return false;

        const entry = await find(signature.slice(0, dot));
        if (!entry) return false;

        const raw = await entry.derive(JSON.stringify(["sign", purpose]), 32);
        const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
        return crypto.subtle.verify("HMAC", key, mac, utf8(String(data)));
      }
    }

    /* A primitive of your own is tested once, on a throwaway key, before this
       token does anything with a real one. */
    let testing: Promise<void> | null = trusted ? Promise.resolve() : null;

    const ready = () => {
      if (!testing) {
        /* Silent: tampering in the self-test can hit the key id, and that is
           not something to report from a throwaway key. */
        const Probe = defineCipherWith(primitive, true)({
          secret: toBase64Url(randomBytes(32)),
          strict,
          logger: { warn() {} },
        });
        testing = assertCrypt(new Probe(), { strict, logger });
      }
      return testing;
    };

    return CipherToken;
  };
}
