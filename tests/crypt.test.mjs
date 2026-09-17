/* Against the built package in dist/, the thing that ships. */
import { test } from "node:test";
import assert from "node:assert/strict";

const { AesGcm, AesCbc, AesCtr, defineCipher, assertCrypt, ensureCrypt } = await import(
  new URL("../dist/crypt/index.mjs", import.meta.url).href
);

const recorder = () => {
  const lines = [];
  return { lines, warn: (...args) => lines.push(args.join(" ")) };
};

const SECRET = "a-long-enough-test-secret-0123456789";
const P = { purpose: "session:data" };

for (const [name, Factory] of [["AesGcm", AesGcm], ["AesCbc", AesCbc], ["AesCtr", AesCtr]]) {
  for (const keyLength of [128, 256]) {
    test(`${name}-${keyLength}: passes every self-test check`, async () => {
      const Token = Factory({ secret: SECRET, keyLength });
      await assertCrypt(new Token());
    });
  }

  test(`${name}: round trip, output is cookie-safe text`, async () => {
    const token = new (Factory({ secret: SECRET }))();
    const cipher = await token.encrypt("xin chào — 🌏", { ...P, aad: "sid-1" });
    assert.match(cipher, /^[A-Za-z0-9._-]+$/);
    assert.equal(await token.decrypt(cipher, { ...P, aad: "sid-1" }), "xin chào — 🌏");
  });
}

test("encrypt/decrypt: wrong aad, wrong purpose, garbage and truncation are null", async () => {
  const token = new (AesGcm({ secret: SECRET }))();
  const cipher = await token.encrypt("value", { ...P, aad: "sid-1" });
  assert.equal(await token.decrypt(cipher, { ...P, aad: "sid-2" }), null);
  assert.equal(await token.decrypt(cipher, { purpose: "csrf", aad: "sid-1" }), null);
  assert.equal(await token.decrypt("not-a-cipher", P), null);
  assert.equal(await token.decrypt(cipher.slice(0, -4), { ...P, aad: "sid-1" }), null);
  assert.equal(await token.decrypt(undefined, P), null);
});

test("purpose is required", async () => {
  const token = new (AesGcm({ secret: SECRET }))();
  await assert.rejects(() => token.encrypt("x", {}), TypeError);
  await assert.rejects(() => token.sign("x", { purpose: "" }), TypeError);
});

test("another secret cannot read or verify", async () => {
  const a = new (AesGcm({ secret: SECRET }))();
  const b = new (AesGcm({ secret: `${SECRET}-other`, logger: recorder() }))();
  assert.equal(await b.decrypt(await a.encrypt("v", P), P), null);
  assert.equal(await b.verify("v", await a.sign("v", P), P), false);
});

test("rotation: the new secret signs and encrypts, the old one still reads", async () => {
  const before = new (AesGcm({ secret: "old-secret-old-secret-old-secret" }))();
  const after = new (AesGcm({ secret: ["new-secret-new-secret-new-secret", "old-secret-old-secret-old-secret"] }))();

  const oldCipher = await before.encrypt("kept", P);
  const oldSignature = await before.sign("id-1", P);

  assert.equal(await after.decrypt(oldCipher, P), "kept");
  assert.equal(await after.verify("id-1", oldSignature, P), true);
  assert.notEqual(await after.sign("id-1", P), oldSignature);

  const all = await after.signAll("id-1", P);
  assert.equal(all.length, 2);
  assert.equal(all[0], await after.sign("id-1", P));
  assert.equal(all[1], oldSignature);
});

test("sign is deterministic and algorithm-independent", async () => {
  const gcm = new (AesGcm({ secret: SECRET }))();
  const cbc = new (AesCbc({ secret: SECRET }))();
  assert.equal(await gcm.sign("id", P), await gcm.sign("id", P));
  assert.equal(await gcm.sign("id", P), await cbc.sign("id", P));
});

test("an unknown key id warns once and is invalid", async () => {
  const logger = recorder();
  const writer = new (AesGcm({ secret: "writer-secret-writer-secret-writer" }))();
  const reader = new (AesGcm({ secret: "reader-secret-reader-secret-reader", logger }))();
  const cipher = await writer.encrypt("v", P);
  assert.equal(await reader.decrypt(cipher, P), null);
  assert.equal(await reader.decrypt(cipher, P), null);
  assert.equal(logger.lines.filter((line) => line.includes("is not a key this token holds")).length, 1);
});

test("no secret: one generated key per process, shared by every token, warned once", async () => {
  const logger = recorder();
  const a = new (AesGcm({ logger }))();
  const b = new (AesCtr({ logger }))();
  await a.sign("x", P);
  await b.sign("x", P);
  assert.equal(await b.verify("x", await a.sign("x", P), P), true);
  assert.equal(logger.lines.filter((line) => line.includes("No secret given")).length <= 1, true);
});

test("secret is read on first use, not when the token is built", async () => {
  // A build-time evaluation of `AesGcm({ secret: process.env.SECRET })` must not throw.
  const Empty = AesGcm({ secret: "" });
  const Missing = AesGcm({ secret: [] });
  await assert.rejects(() => new Empty().sign("x", P), TypeError);
  await assert.rejects(() => new Missing().encrypt("x", P), TypeError);

  // Anything not about the secret still fails immediately.
  assert.throws(() => AesGcm({ keyLength: 192 }), TypeError);
});

/* ---- tokens that break the guarantees ---- */

const xorPrimitive = (overrides = {}) => ({
  name: "test-xor",
  keyLength: 32,
  ivLength: 12,
  async encrypt(plain, { key, iv, aad }) {
    const out = new Uint8Array(plain.length + 1);
    plain.forEach((byte, i) => (out[i] = byte ^ key[i % key.length] ^ iv[i % iv.length]));
    out[plain.length] = aad.reduce((sum, byte) => (sum + byte) % 256, 0);
    return out;
  },
  async decrypt(cipher, { key, iv, aad }) {
    const check = aad.reduce((sum, byte) => (sum + byte) % 256, 0);
    if (cipher[cipher.length - 1] !== check) return null;
    const body = cipher.slice(0, -1);
    return body.map((byte, i) => byte ^ key[i % key.length] ^ iv[i % iv.length]);
  },
  ...overrides,
});

test("defineCipher: a primitive with no integrity fails check 4 on first use", async () => {
  const Token = defineCipher(xorPrimitive())({ secret: SECRET, logger: recorder() });
  await assert.rejects(() => new Token().encrypt("x", P), /self-test 4/);
});

test("strict: false skips the self-test entirely — nothing is checked, nothing is warned", async () => {
  const logger = recorder();
  const Token = defineCipher(xorPrimitive())({ secret: SECRET, strict: false, logger });
  const token = new Token();
  assert.equal(await token.decrypt(await token.encrypt("x", P), P), "x");
  assert.equal(logger.lines.filter((line) => line.includes("self-test")).length, 0);
  await assertCrypt(token, { strict: false });
});

test("defineCipher: identity primitive fails check 2", async () => {
  const identity = xorPrimitive({
    name: "test-identity",
    ivLength: 0,
    encrypt: async (plain) => plain,
    decrypt: async (cipher) => cipher,
  });
  const Token = defineCipher(identity)({ secret: SECRET, logger: recorder() });
  await assert.rejects(() => new Token().encrypt("x", P), /self-test 2/);
});

/* A hand-written token: correct except for the parts each case breaks. */
function handWritten({ fixedIv = false, ignoreAad = false, ignorePurpose = false, strict } = {}) {
  const inner = new (AesGcm({ secret: SECRET }))();
  const purposeOf = (options) => (ignorePurpose ? { ...options, purpose: "fixed" } : options);
  const aadOf = (options) => (ignoreAad ? { ...purposeOf(options), aad: "" } : purposeOf(options));
  const cache = new Map();

  return new (class {
    strict = strict;
    async encrypt(plain, options) {
      if (!fixedIv) return inner.encrypt(plain, aadOf(options));
      const id = JSON.stringify([plain, aadOf(options)]);
      if (!cache.has(id)) cache.set(id, await inner.encrypt(plain, aadOf(options)));
      return cache.get(id);
    }
    decrypt(cipher, options) { return inner.decrypt(cipher, aadOf(options)); }
    sign(data, options) { return inner.sign(data, purposeOf(options)); }
    verify(data, signature, options) { return inner.verify(data, signature, purposeOf(options)); }
  })();
}

test("assertCrypt: a correct hand-written token passes", async () => {
  await assertCrypt(handWritten());
});

test("assertCrypt: every check throws, and a token that says strict: false is not checked", async () => {
  await assert.rejects(() => assertCrypt(handWritten({ fixedIv: true })), /self-test 3/);
  await assert.rejects(() => assertCrypt(handWritten({ ignoreAad: true })), /self-test 5/);
  await assert.rejects(() => assertCrypt(handWritten({ ignorePurpose: true })), /self-test (8|9)/);

  await assertCrypt(handWritten({ fixedIv: true, ignoreAad: true, ignorePurpose: true, strict: false }));
});

test("the built-in algorithms go through the self-test too, and strict: false skips it", async () => {
  /* Counted at the Web Crypto call, since the self-test leaves no other trace:
     a first encrypt that also runs the test does several, one that skips it
     does exactly one. */
  const real = crypto.subtle.encrypt.bind(crypto.subtle);
  let calls = 0;
  crypto.subtle.encrypt = (...args) => {
    calls++;
    return real(...args);
  };

  try {
    const tested = new (AesGcm({ secret: SECRET }))();
    await tested.encrypt("v", P);
    const withTest = calls;

    calls = 0;
    const skipped = new (AesGcm({ secret: SECRET, strict: false }))();
    await skipped.encrypt("v", P);
    const withoutTest = calls;

    assert.equal(withoutTest, 1, "one encryption, nothing else");
    assert.ok(withTest > withoutTest, `expected the self-test to encrypt as well, got ${withTest} vs ${withoutTest}`);
  } finally {
    crypto.subtle.encrypt = real;
  }
});

test("ensureCrypt: skips defineCipher tokens, tests others once per class", async () => {
  await ensureCrypt(new (AesGcm({ secret: SECRET }))());
  const bad = handWritten({ ignorePurpose: true });
  const first = ensureCrypt(bad);
  assert.equal(ensureCrypt(bad), first);
  await assert.rejects(() => first, /self-test/);
});
