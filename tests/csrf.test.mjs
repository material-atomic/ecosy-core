/* Against the built package in dist/, the thing that ships. */
import { test } from "node:test";
import assert from "node:assert/strict";

const { Csrf, safeReturnTo } = await import(new URL("../dist/csrf/index.mjs", import.meta.url).href);
const { AesGcm } = await import(new URL("../dist/crypt/index.mjs", import.meta.url).href);

const quiet = { warn() {} };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const crypt = () => AesGcm({ secret: "csrf-test-secret-csrf-test-secret", logger: quiet });

function browser() {
  const cookies = new Map();
  const log = [];
  return {
    cookies,
    log,
    jar: () => ({
      get: (name) => cookies.get(name),
      set: (name, value, options) => { log.push(["set", name, options]); cookies.set(name, value); },
      delete: (name, options) => { log.push(["delete", name, options]); cookies.delete(name); },
    }),
  };
}

const post = (headers = {}, url = "https://app.example.com/api/x") => new Request(url, { method: "POST", headers });

/* ---------------- origin ---------------- */

test("origin: safe methods and Authorization pass", () => {
  const csrf = new (Csrf({ encrypt: crypt() }))();
  assert.equal(csrf.origin(new Request("https://app.example.com/", { headers: { "sec-fetch-site": "cross-site" } })), true);
  assert.equal(csrf.origin(post({ "sec-fetch-site": "cross-site", authorization: "Bearer x" })), true);
});

test("origin: Sec-Fetch-Site decides when present", () => {
  const csrf = new (Csrf({ encrypt: crypt() }))();
  assert.equal(csrf.origin(post({ "sec-fetch-site": "same-origin" })), true);
  assert.equal(csrf.origin(post({ "sec-fetch-site": "none" })), true);
  assert.equal(csrf.origin(post({ "sec-fetch-site": "cross-site", origin: "https://evil.example" })), false);
  assert.equal(csrf.origin(post({ "sec-fetch-site": "same-site", origin: "https://sub.example.com" })), false, "sibling subdomains refused by default");

  const lenient = new (Csrf({ encrypt: crypt(), allowSameSite: true, trustedOrigins: ["https://partner.example"] }))();
  assert.equal(lenient.origin(post({ "sec-fetch-site": "same-site" })), true);
  assert.equal(lenient.origin(post({ "sec-fetch-site": "cross-site", origin: "https://partner.example" })), true);
});

test("origin: without Sec-Fetch-Site, Origin then Referer; neither means not a browser", () => {
  const csrf = new (Csrf({ encrypt: crypt() }))();
  assert.equal(csrf.origin(post({ origin: "https://app.example.com" })), true);
  assert.equal(csrf.origin(post({ origin: "https://evil.example" })), false);
  assert.equal(csrf.origin(post({ origin: "null" })), false);
  assert.equal(csrf.origin(post({ referer: "https://app.example.com/page" })), true);
  assert.equal(csrf.origin(post({ referer: "https://evil.example/page" })), false);
  assert.equal(csrf.origin(post()), true);
});

test("origin: X-Forwarded-* only with trustProxy", () => {
  const headers = { origin: "https://public.example", "x-forwarded-proto": "https", "x-forwarded-host": "public.example" };
  const internal = "http://10.0.0.5:3000/api/x";
  assert.equal(new (Csrf({ encrypt: crypt() }))().origin(post(headers, internal)), false);
  assert.equal(new (Csrf({ encrypt: crypt(), trustProxy: true }))().origin(post(headers, internal)), true);
});

/* ---------------- tokens ---------------- */

test("tokens: valid for their binding and purpose only", async () => {
  const csrf = new (Csrf({ encrypt: crypt() }))();
  const token = await csrf.issue({ bind: "session-1", purpose: "change-email" });

  assert.ok(await csrf.verify(token, { bind: "session-1", purpose: "change-email" }));
  assert.equal(await csrf.verify(token, { bind: "session-2", purpose: "change-email" }), null);
  assert.equal(await csrf.verify(token, { bind: "session-1", purpose: "delete-account" }), null);
  assert.equal(await csrf.verify(`${token}x`, { bind: "session-1", purpose: "change-email" }), null);
  assert.equal(await csrf.verify(null, { bind: "session-1", purpose: "change-email" }), null);
  assert.equal(await csrf.verify("a.b", { bind: "session-1", purpose: "change-email" }), null);
});

test("tokens: the expiry cannot be extended by editing it", async () => {
  const csrf = new (Csrf({ encrypt: crypt(), maxAge: 20 }))();
  const token = await csrf.issue({ bind: "s", purpose: "p" });
  const [nonce, , ...signature] = token.split(".");
  const extended = [nonce, (Date.now() + 3_600_000).toString(36), ...signature].join(".");
  assert.equal(await csrf.verify(extended, { bind: "s", purpose: "p" }), null);

  await sleep(30);
  assert.equal(await csrf.verify(token, { bind: "s", purpose: "p" }), null, "expired");
});

test("tokens: verify hands back a nonce unique per token", async () => {
  const csrf = new (Csrf({ encrypt: crypt() }))();
  const a = await csrf.verify(await csrf.issue({ bind: "s", purpose: "p" }), { bind: "s", purpose: "p" });
  const b = await csrf.verify(await csrf.issue({ bind: "s", purpose: "p" }), { bind: "s", purpose: "p" });
  assert.notEqual(a.nonce, b.nonce);
  assert.ok(a.expiresAt > Date.now());
});

test("tokens: claim makes them single-use", async () => {
  const spent = new Set();
  const claim = (nonce) => (spent.has(nonce) ? false : (spent.add(nonce), true));
  const csrf = new (Csrf({ encrypt: crypt(), claim }))();
  const token = await csrf.issue({ bind: "s", purpose: "p" });
  assert.ok(await csrf.verify(token, { bind: "s", purpose: "p" }));
  assert.equal(await csrf.verify(token, { bind: "s", purpose: "p" }), null);
  assert.ok(await csrf.verify(await csrf.issue({ bind: "s", purpose: "p" }), { bind: "s", purpose: "p", claim: null }));
});

test("tokens: bind and purpose are required", async () => {
  const csrf = new (Csrf({ encrypt: crypt() }))();
  await assert.rejects(() => csrf.issue({ bind: "", purpose: "p" }), TypeError);
  await assert.rejects(() => csrf.verify("x", { bind: "s" }), TypeError);
});

test("read: header first, then urlencoded or multipart field; the body stays readable", async () => {
  const csrf = new (Csrf({ encrypt: crypt() }))();
  assert.equal(await csrf.read(post({ "x-csrf-token": "from-header" })), "from-header");

  const urlencoded = new Request("https://app.example.com/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "_csrf=from-form&x=1",
  });
  assert.equal(await csrf.read(urlencoded), "from-form");
  assert.equal((await urlencoded.formData()).get("x"), "1");

  const form = new FormData();
  form.set("_csrf", "from-multipart");
  form.set("file", new Blob(["data"]), "a.txt");
  assert.equal(await csrf.read(new Request("https://app.example.com/", { method: "POST", body: form })), "from-multipart");

  const json = new Request("https://app.example.com/", { method: "POST", headers: { "content-type": "application/json" }, body: '{"_csrf":"x"}' });
  assert.equal(await csrf.read(json), null);

  const huge = new Request("https://app.example.com/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "content-length": String(10 * 1024 * 1024) },
    body: "_csrf=x",
  });
  assert.equal(await csrf.read(huge), null);
});

/* ---------------- login ---------------- */

test("login: the form token only works in the browser that opened the form", async () => {
  const csrf = new (Csrf({ encrypt: crypt() }))();
  const victim = browser();
  const attacker = browser();

  const attackerToken = await csrf.login.start(attacker.jar());
  await csrf.login.start(victim.jar());

  assert.equal(await csrf.login.verify(attacker.jar(), attackerToken), true);
  assert.equal(await csrf.login.verify(victim.jar(), attackerToken), false, "login CSRF refused");
  assert.equal(await csrf.login.verify(browser().jar(), attackerToken), false, "no cookie");

  await csrf.login.finish(victim.jar());
  assert.equal(victim.cookies.size, 0);
});

test("login: cookie is __Host- and Secure by default, plain when secure is false", async () => {
  const b = browser();
  await new (Csrf({ encrypt: crypt() }))().login.start(b.jar());
  const [, name, options] = b.log[0];
  assert.equal(name, "__Host-csrf_login");
  assert.equal(options.secure, true);
  assert.equal(options.path, "/");
  assert.equal(options.httpOnly, true);

  const dev = browser();
  await new (Csrf({ encrypt: crypt(), secure: false }))().login.start(dev.jar());
  assert.equal(dev.log[0][1], "csrf_login");
});

test("login: an existing nonce cookie is reused, not replaced on every visit", async () => {
  const csrf = new (Csrf({ encrypt: crypt() }))();
  const b = browser();
  await csrf.login.start(b.jar());
  const first = [...b.cookies.values()][0];
  const token = await csrf.login.start(b.jar());
  assert.equal([...b.cookies.values()][0], first);
  assert.equal(await csrf.login.verify(b.jar(), token), true);
});

/* ---------------- oauth ---------------- */

test("oauth: round trip gives back returnTo, verifier and nonce, and spends the cookie", async () => {
  const csrf = new (Csrf({ encrypt: crypt() }))();
  const b = browser();
  const start = await csrf.oauth.start(b.jar(), { returnTo: "/projects?tab=1#x" });

  assert.equal(start.codeChallengeMethod, "S256");
  const finish = await csrf.oauth.finish(b.jar(), start.state);
  assert.equal(finish.returnTo, "/projects?tab=1#x");
  assert.equal(finish.nonce, start.nonce);

  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(finish.codeVerifier)));
  const challenge = btoa(String.fromCharCode(...digest)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  assert.equal(challenge, start.codeChallenge);

  assert.equal(b.cookies.size, 0);
  assert.equal(await csrf.oauth.finish(b.jar(), start.state), null, "a state works once");
});

test("oauth: a state from another browser, altered, or expired is refused", async () => {
  const csrf = new (Csrf({ encrypt: crypt(), oauth: { maxAge: 30 } }))();
  const attacker = browser();
  const victim = browser();

  const attackerStart = await csrf.oauth.start(attacker.jar());
  await csrf.oauth.start(victim.jar());
  assert.equal(await csrf.oauth.finish(victim.jar(), attackerStart.state), null, "valid state, other browser");

  const b = browser();
  const start = await csrf.oauth.start(b.jar());
  const [payload, ...signature] = start.state.split(".");
  const forged = btoa(JSON.stringify({ ...JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))), r: "/admin" }))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  assert.equal(await csrf.oauth.finish(b.jar(), [forged, ...signature].join(".")), null, "altered");

  const late = browser();
  const lateStart = await csrf.oauth.start(late.jar());
  await sleep(40);
  assert.equal(await csrf.oauth.finish(late.jar(), lateStart.state), null, "expired");
});

test("safeReturnTo: only paths on this app", () => {
  assert.equal(safeReturnTo("/a/b?c=1"), "/a/b?c=1");
  for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "", null]) {
    assert.equal(safeReturnTo(bad), "/");
  }
  assert.equal(safeReturnTo("/api/logout", /^\/(api|login|logout)(\/|$)/), "/");
});
