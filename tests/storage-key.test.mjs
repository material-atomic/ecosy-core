/* Two factory calls stand in for two evaluations of one module — Next's proxy and route layers. */
import { test } from "node:test";
import assert from "node:assert/strict";

const { Queue } = await import(new URL("../dist/queue/index.mjs", import.meta.url).href);
const { Batch } = await import(new URL("../dist/batch/index.mjs", import.meta.url).href);
const { Session, MemoryStore } = await import(new URL("../dist/session/index.mjs", import.meta.url).href);
const { AesGcm } = await import(new URL("../dist/crypt/index.mjs", import.meta.url).href);

const quiet = { warn() {} };
const unique = (name) => `${name}-${Math.random().toString(36).slice(2)}`;

test("Queue: same storageKey shares lanes across factory calls; none does not", async () => {
  const key = unique("q");
  const a = new (Queue({ storageKey: key }))();
  const b = new (Queue({ storageKey: key }))();
  let release;
  void a.run("k", () => new Promise((r) => (release = r)));
  assert.equal(b.size("k"), 1);
  assert.equal(new (Queue())().size("k"), 0);
  await new Promise((r) => setTimeout(r, 0)); // the task starts on the next turn
  release();
  await b.pending("k");
});

test("Batch: same storageKey gathers into one flush across factory calls", async () => {
  const key = unique("b");
  const flushes = [];
  const handler = { flush: (items) => void flushes.push(items) };
  await Promise.all([new (Batch({ storageKey: key }))().add("g", 1, handler), new (Batch({ storageKey: key }))().add("g", 2, handler)]);
  assert.deepEqual(flushes, [[1, 2]]);
});

test("MemoryStore: same storageKey, same records", async () => {
  const key = unique("m");
  const record = { data: "d", createdAt: Date.now(), expiresAt: Date.now() + 60_000 };
  await new (MemoryStore({ storageKey: key, logger: quiet }))().set("r", record);
  assert.ok(await new (MemoryStore({ storageKey: key, logger: quiet }))().get("r"));
  assert.equal(await new (MemoryStore({ logger: quiet }))().get("r"), null);
  assert.throws(() => MemoryStore({ storageKey: "" }), TypeError);
});

test("Session: a session written by one copy is loaded by another with the same storageKey", async () => {
  const key = unique("s");
  const cookies = new Map();
  const jar = () => ({ get: (n) => cookies.get(n), set: (n, v) => void cookies.set(n, v), delete: (n) => void cookies.delete(n) });
  const make = (storageKey) =>
    Session({ encrypt: AesGcm({ secret: "storage-key-secret-storage-key-secret", logger: quiet }), storageKey, logger: quiet });

  const proxyLayer = await new (make(key))().load(jar());
  await proxyLayer.set({ from: "proxy" });

  const routeLayer = await new (make(key))().load(jar());
  assert.equal(routeLayer.id, proxyLayer.id);
  assert.equal(routeLayer.get("from"), "proxy");

  const unshared = await new (make(undefined))().load(jar());
  assert.equal(unshared.isNew, true, "without storageKey each copy has its own store");
});
