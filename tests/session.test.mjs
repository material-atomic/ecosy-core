/* Against the built package in dist/, the thing that ships. */
import { test } from "node:test";
import assert from "node:assert/strict";

const { Session, MemoryStore } = await import(new URL("../dist/session/index.mjs", import.meta.url).href);
const { AesGcm } = await import(new URL("../dist/crypt/index.mjs", import.meta.url).href);
const { Queue } = await import(new URL("../dist/queue/index.mjs", import.meta.url).href);
const { Batch } = await import(new URL("../dist/batch/index.mjs", import.meta.url).href);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const quiet = { warn() {} };
const SECRET = "session-test-secret-session-test-secret";

/** A browser's cookie store, as a jar. `requests` shares it across loads, like one browser. */
function browser() {
  const cookies = new Map();
  const log = [];
  return {
    cookies,
    log,
    jar: () => ({
      get: (name) => cookies.get(name),
      set: (name, value, options) => {
        log.push(["set", name, options]);
        cookies.set(name, value);
      },
      delete: (name, options) => {
        log.push(["delete", name, options]);
        cookies.delete(name);
      },
    }),
  };
}

/** A store that records what reaches it, around a MemoryStore. */
function recordingStore({ delay = 0 } = {}) {
  const Inner = MemoryStore({ logger: quiet });
  const writes = [];
  return {
    writes,
    Store: class {
      inner = new Inner();
      get(key) { return this.inner.get(key); }
      async set(key, record) {
        writes.push([key, record]);
        if (delay) await sleep(delay);
        return this.inner.set(key, record);
      }
      delete(key) { return this.inner.delete(key); }
      listByUser(user) { return this.inner.listByUser(user); }
      deleteByUser(user) { return this.inner.deleteByUser(user); }
    },
  };
}

const crypt = () => AesGcm({ secret: SECRET, logger: quiet });

test("a new session is not stored and sets no cookie until something is written", async () => {
  const b = browser();
  const AppSession = Session({ encrypt: crypt(), logger: quiet });
  const session = await new AppSession().load(b.jar());
  assert.equal(session.isNew, true);
  assert.deepEqual(session.get(), {});
  await session.persist();
  assert.equal(b.cookies.size, 0);
});

test("set saves, sets a signed cookie, and the next request reads the state back", async () => {
  const b = browser();
  const AppSession = Session({ encrypt: crypt(), logger: quiet });

  const first = await new AppSession().load(b.jar());
  await first.set({ theme: "dark", cart: { items: [1] } });
  const cookie = b.cookies.get("sid");
  assert.ok(cookie.startsWith(`${first.id}.`));
  assert.equal(first.isNew, false);

  const second = await new AppSession().load(b.jar());
  assert.equal(second.id, first.id);
  assert.deepEqual(second.get(), { theme: "dark", cart: { items: [1] } });
  assert.equal(second.get("cart.items[0]"), 1);
  assert.equal(second.get("missing", "d"), "d");

  const [, , options] = b.log.find(([kind]) => kind === "set");
  assert.equal(options.httpOnly, true);
  assert.equal(options.sameSite, "lax");
  assert.equal(options.maxAge, 7 * 24 * 60 * 60);
});

test("get returns a copy: changing it changes nothing", async () => {
  const AppSession = Session({ encrypt: crypt(), logger: quiet });
  const session = await new AppSession().load(browser().jar());
  await session.set({ a: { b: 1 } });
  session.get().a.b = 99;
  session.get("a").b = 99;
  assert.equal(session.get("a.b"), 1);
});

test("a forged or unknown cookie never becomes the session id", async () => {
  const AppSession = Session({ encrypt: crypt(), logger: quiet });
  const b = browser();
  b.cookies.set("sid", "attacker-chosen-id.fake-signature");
  const session = await new AppSession().load(b.jar());
  assert.notEqual(session.id, "attacker-chosen-id");
  assert.equal(session.isNew, true);

  const other = Session({ encrypt: AesGcm({ secret: `${SECRET}-other`, logger: quiet }), logger: quiet });
  const real = await new other().load(browser().jar());
  await real.set({ x: 1 });
  const b2 = browser();
  b2.cookies.set("sid", `${real.id}.whatever`);
  assert.notEqual((await new AppSession().load(b2.jar())).id, real.id);
});

test("the store sees neither the id nor the data", async () => {
  const { Store, writes } = recordingStore();
  const AppSession = Session({ encrypt: crypt(), store: Store, logger: quiet });
  const session = await new AppSession().load(browser().jar());
  await session.set({ email: "someone@example.com" });

  const [key, record] = writes[0];
  assert.ok(!key.includes(session.id));
  assert.ok(!record.data.includes("someone@example.com"));
  assert.ok(!record.data.includes(session.id));
});

test("setIn and unset write the state right away and save", async () => {
  const b = browser();
  const AppSession = Session({ encrypt: crypt(), logger: quiet });
  const session = await new AppSession().load(b.jar());
  await session.set({ cart: { items: [{ qty: 1 }], coupon: "X" } });

  const writing = session.setIn("cart.items[0].qty", 3);
  assert.equal(session.get("cart.items[0].qty"), 3, "visible before the save finishes");
  await writing;
  await session.unset("cart.coupon");

  const again = await new AppSession().load(b.jar());
  assert.deepEqual(again.get(), { cart: { items: [{ qty: 3 }] } });
});

test("set is refused anything but a plain object", async () => {
  const AppSession = Session({ encrypt: crypt(), logger: quiet });
  const session = await new AppSession().load(browser().jar());
  await assert.rejects(() => session.set("theme"), TypeError);
  await assert.rejects(() => session.setIn("__proto__.x", 1), TypeError);
});

test("values are stored as JSON at once: a Date is its string before and after reload", async () => {
  const b = browser();
  const AppSession = Session({ encrypt: crypt(), logger: quiet });
  const session = await new AppSession().load(b.jar());
  const at = new Date(0);
  await session.set({ at, gone: undefined, fn: () => 1 });
  await session.setIn("nested.at", at);
  assert.deepEqual(session.get(), { at: at.toISOString(), nested: { at: at.toISOString() } });

  await session.setIn("nested", undefined);
  assert.deepEqual(session.get(), { at: at.toISOString() });

  const again = await new AppSession().load(b.jar());
  assert.deepEqual(again.get(), session.get());
});

/* ---------------- conflicts ---------------- */

const batched = () =>
  Session({ encrypt: crypt(), queue: Queue(), batch: Batch({ window: 20 }), logger: quiet });

test("a setIn made after a pending set wins on its path; the set keeps the rest", async () => {
  const AppSession = batched();
  const session = await new AppSession().load(browser().jar());
  await session.setQueue({ cart: { coupon: null, items: [{ qty: 1 }] } });

  const pending = session.set({ cart: { coupon: "SALE" } });
  await session.setIn("cart.coupon", "MANUAL");
  await pending;

  assert.deepEqual(session.get(), { cart: { coupon: "MANUAL", items: [{ qty: 1 }] } });
});

test("path-level: a newer setIn deep inside does not wipe a pending set's sibling", async () => {
  const AppSession = batched();
  const session = await new AppSession().load(browser().jar());
  await session.setQueue({ cart: { coupon: null, count: 1 } });

  const pending = session.set({ cart: { coupon: "SALE" } });
  await session.setIn("cart.count", 3);
  await pending;

  assert.deepEqual(session.get(), { cart: { coupon: "SALE", count: 3 } });
});

test("batch coalescing several sets keeps call order: set, setIn, set — the last set wins", async () => {
  const AppSession = batched();
  const session = await new AppSession().load(browser().jar());

  const first = session.set({ plan: "free" });
  await session.setIn("plan", "trial");
  const second = session.set({ plan: "pro" });
  await Promise.all([first, second]);

  assert.equal(session.get("plan"), "pro");
});

test("two pending sets in one batch: the later call wins, even though the earlier one is applied first", async () => {
  const AppSession = batched();
  const session = await new AppSession().load(browser().jar());
  const first = session.set({ plan: "free", seats: 1 });
  const second = session.set({ plan: "pro" });
  await Promise.all([first, second]);
  assert.deepEqual(session.get(), { plan: "pro", seats: 1 });
});

test("queued writes apply in call order: two setQueue calls, the later wins", async () => {
  const AppSession = Session({ encrypt: crypt(), queue: Queue(), logger: quiet });
  const session = await new AppSession().load(browser().jar());
  const a = session.setQueue({ step: 1, seen: true });
  const b = session.setQueue({ step: 2 });
  await Promise.all([a, b]);
  assert.deepEqual(session.get(), { step: 2, seen: true });
});

test("a setIn made before a set is overwritten by it", async () => {
  const AppSession = batched();
  const session = await new AppSession().load(browser().jar());
  await session.setIn("plan", "trial");
  await session.set({ plan: "pro" });
  assert.equal(session.get("plan"), "pro");
});

test("get sees the state now; getAsync waits for pending sets", async () => {
  const AppSession = batched();
  const session = await new AppSession().load(browser().jar());
  const pending = session.set({ step: 2 });
  assert.equal(session.get("step"), undefined);
  assert.equal(await session.getAsync("step"), 2);
  await pending;
});

test("requests on the same session share one live state", async () => {
  const b = browser();
  const AppSession = Session({ encrypt: crypt(), logger: quiet });
  const a = await new AppSession().load(b.jar());
  await a.set({ n: 1 });
  const c = await new AppSession().load(b.jar());
  await a.setIn("n", 2);
  assert.equal(c.get("n"), 2);
});

test("saves are one at a time and the store ends on the latest state", async () => {
  const { Store, writes } = recordingStore({ delay: 15 });
  const b = browser();
  const AppSession = Session({ encrypt: crypt(), store: Store, logger: quiet });
  const session = await new AppSession().load(b.jar());

  await Promise.all([1, 2, 3, 4, 5].map((n) => session.setIn("n", n)));
  assert.ok(writes.length <= 2, `expected at most 2 store writes, got ${writes.length}`);

  const again = await new AppSession().load(b.jar());
  assert.equal(again.get("n"), 5);
});

/* ---------------- lifecycle ---------------- */

test("regenerate moves to a new id and cookie; the old id works only for the grace period", async () => {
  const b = browser();
  const AppSession = Session({ encrypt: crypt(), regenerate: { grace: 40 }, logger: quiet });
  const session = await new AppSession().load(b.jar());
  await session.set({ user: "u1" });
  const oldId = session.id;
  const oldCookie = b.cookies.get("sid");

  await session.regenerate();
  assert.notEqual(session.id, oldId);
  assert.notEqual(b.cookies.get("sid"), oldCookie);
  assert.equal(session.get("user"), "u1");

  const stale = browser();
  stale.cookies.set("sid", oldCookie);
  assert.equal((await new AppSession().load(stale.jar())).id, oldId, "within grace");

  await sleep(60);
  assert.notEqual((await new AppSession().load(stale.jar())).id, oldId, "after grace");

  assert.equal((await new AppSession().load(b.jar())).get("user"), "u1");
});

test("destroy removes the record and the cookie", async () => {
  const b = browser();
  const AppSession = Session({ encrypt: crypt(), logger: quiet });
  const session = await new AppSession().load(b.jar());
  await session.set({ x: 1 });
  const oldCookie = b.cookies.get("sid");
  await session.destroy();

  assert.equal(b.cookies.has("sid"), false);
  const replay = browser();
  replay.cookies.set("sid", oldCookie);
  assert.equal((await new AppSession().load(replay.jar())).isNew, true);
});

test("an expired session is not loaded", async () => {
  const b = browser();
  const { Store } = recordingStore();
  const AppSession = Session({ encrypt: crypt(), store: Store, maxAge: 30, logger: quiet });
  const session = await new AppSession().load(b.jar());
  await session.set({ x: 1 });

  // Same store, a separate class: nothing cached in memory, only what the store holds.
  const Fresh = Session({ encrypt: crypt(), store: Store, maxAge: 30, logger: quiet });
  assert.equal((await new Fresh().load(b.jar())).isNew, false, "still valid");
  await sleep(60);
  const Later = Session({ encrypt: crypt(), store: Store, maxAge: 30, logger: quiet });
  assert.equal((await new Later().load(b.jar())).isNew, true, "expired");
});

test("revokeUser ends every session of that user", async () => {
  const AppSession = Session({ encrypt: crypt(), logger: quiet });
  const laptop = browser();
  const phone = browser();

  for (const device of [laptop, phone]) {
    const session = await new AppSession().load(device.jar());
    await session.set({ device: "x" });
    await session.setUser("user-42");
  }

  await new AppSession().revokeUser("user-42");
  assert.equal((await new AppSession().load(laptop.jar())).isNew, true);
  assert.equal((await new AppSession().load(phone.jar())).isNew, true);
});

test("secret rotation: sessions saved under the old secret load and move to the new key", async () => {
  const { Store, writes } = recordingStore();
  const b = browser();
  const OLD = "old-session-secret-old-session-secret";
  const NEW = "new-session-secret-new-session-secret";

  const Before = Session({ encrypt: AesGcm({ secret: OLD, logger: quiet }), store: Store, logger: quiet });
  const s1 = await new Before().load(b.jar());
  await s1.set({ kept: true });
  const oldKey = writes.at(-1)[0];

  const After = Session({ encrypt: AesGcm({ secret: [NEW, OLD], logger: quiet }), store: Store, logger: quiet });
  const s2 = await new After().load(b.jar());
  assert.equal(s2.id, s1.id);
  assert.equal(s2.get("kept"), true);

  await s2.persist();
  const newKey = writes.at(-1)[0];
  assert.notEqual(newKey, oldKey);
  assert.equal(await new Store().get(oldKey), null, "moved, not copied");
});

test("a hand-written crypt token that ignores purpose is refused before first use", async () => {
  const inner = new (AesGcm({ secret: SECRET, logger: quiet }))();
  class Careless {
    encrypt(plain, o) { return inner.encrypt(plain, { ...o, purpose: "one" }); }
    decrypt(cipher, o) { return inner.decrypt(cipher, { ...o, purpose: "one" }); }
    sign(data) { return inner.sign(data, { purpose: "one" }); }
    verify(data, signature) { return inner.verify(data, signature, { purpose: "one" }); }
  }
  const AppSession = Session({ encrypt: Careless, logger: quiet });
  await assert.rejects(() => new AppSession().load(browser().jar()), /self-test/);
});

/* ---------------- MemoryStore ---------------- */

const record = (expiresIn, user) => ({ data: "d", createdAt: Date.now(), expiresAt: Date.now() + expiresIn, user });

test("MemoryStore: expired records are not returned", async () => {
  const store = new (MemoryStore({ logger: quiet }))();
  await store.set("a", record(-1));
  await store.set("b", record(10_000));
  assert.equal(await store.get("a"), null);
  assert.ok(await store.get("b"));
});

test("MemoryStore: max 0 is unlimited; full store drops expired first, then within distance", async () => {
  const unlimited = new (MemoryStore({ logger: quiet }))();
  for (let i = 0; i < 50; i++) await unlimited.set(`k${i}`, record(10_000));
  assert.ok(await unlimited.get("k49"));

  const Store = MemoryStore({ max: 2, distance: 1_000, logger: quiet });
  const store = new Store();
  await store.set("soon", record(500));
  await store.set("later", record(60_000));
  await store.set("new", record(60_000));
  assert.equal(await store.get("soon"), null, "expiring within distance made room");
  assert.ok(await store.get("new"));
});

test("MemoryStore: onMax picks what goes, or refuses; without it a full store refuses", async () => {
  const seen = [];
  const Store = MemoryStore({
    max: 2,
    logger: quiet,
    onMax: ({ entries, incoming, max }) => {
      seen.push({ keys: entries.map((e) => e.key), incoming: incoming.key, max, hasData: "data" in entries[0] });
      return incoming.key === "refuse" ? false : [entries[0].key, "not-held"];
    },
  });
  const store = new Store();
  await store.set("a", record(60_000));
  await store.set("b", record(60_000));
  await store.set("c", record(60_000));
  assert.equal(await store.get("a"), null);
  assert.ok(await store.get("c"));
  assert.deepEqual(seen[0], { keys: ["a", "b"], incoming: "c", max: 2, hasData: false });

  await store.set("refuse", record(60_000));
  assert.equal(await store.get("refuse"), null);

  const warnings = [];
  const plain = new (MemoryStore({ max: 1, logger: { warn: (m) => warnings.push(m) } }))();
  await plain.set("a", record(60_000));
  await plain.set("b", record(60_000));
  assert.equal(await plain.get("b"), null);
  assert.equal(warnings.length, 1);
});

test("MemoryStore: onMax returning the wrong type is a TypeError outside production", async () => {
  const store = new (MemoryStore({ max: 1, logger: quiet, onMax: () => "a" }))();
  await store.set("a", record(60_000));
  await assert.rejects(() => store.set("b", record(60_000)), TypeError);
});

test("MemoryStore: persist loads once dropping expired, saves full snapshots including deletions", async () => {
  const saves = [];
  const Store = MemoryStore({
    logger: quiet,
    persist: {
      load: () => [["old", record(-1)], ["kept", record(60_000)]],
      save: (entries) => void saves.push(entries.map(([key]) => key).sort()),
      delay: 5,
    },
  });
  const store = new Store();
  assert.equal(await store.get("old"), null);
  assert.ok(await store.get("kept"));

  await store.set("x", record(60_000));
  await store.delete("kept");
  await sleep(30);
  assert.deepEqual(saves.at(-1), ["x"], "a deleted record does not come back from the snapshot");
});

test("MemoryStore: listByUser, deleteByUser, prune", async () => {
  const store = new (MemoryStore({ logger: quiet }))();
  await store.set("a", record(60_000, "u1"));
  await store.set("b", record(60_000, "u1"));
  await store.set("c", record(60_000, "u2"));
  assert.deepEqual((await store.listByUser("u1")).map((m) => m.key).sort(), ["a", "b"]);
  await store.deleteByUser("u1");
  assert.equal(await store.get("a"), null);
  assert.ok(await store.get("c"));
});
