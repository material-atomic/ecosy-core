/* Against the built package in dist/, the thing that ships. */
import { test } from "node:test";
import assert from "node:assert/strict";

const { Queue, QueueTimeoutError } = await import(new URL("../dist/queue/index.mjs", import.meta.url).href);
const { Batch } = await import(new URL("../dist/batch/index.mjs", import.meta.url).href);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};

/* ---------------- Queue ---------------- */

test("queue: one at a time per key, in order; other keys run beside", async () => {
  const q = new (Queue())();
  const log = [];
  const gate = deferred();

  const a1 = q.run("a", async () => { log.push("a1:start"); await gate.promise; log.push("a1:end"); return 1; });
  const a2 = q.run("a", async () => { log.push("a2"); return 2; });
  const b1 = q.run("b", async () => { log.push("b1"); return 3; });

  await sleep(5);
  assert.deepEqual(log, ["a1:start", "b1"]);
  gate.resolve();
  assert.deepEqual(await Promise.all([a1, a2, b1]), [1, 2, 3]);
  assert.deepEqual(log, ["a1:start", "b1", "a1:end", "a2"]);
});

test("queue: instances of one class share lanes, two Queue() calls do not", async () => {
  const Shared = Queue();
  const gate = deferred();
  const order = [];
  void new Shared().run("k", async () => { await gate.promise; order.push("first"); });
  const second = new Shared().run("k", () => order.push("second"));
  const other = new (Queue())().run("k", () => order.push("other"));
  await other;
  assert.deepEqual(order, ["other"]);
  gate.resolve();
  await second;
  assert.deepEqual(order, ["other", "first", "second"]);
});

test("queue: a failing task rejects its caller only; the lane carries on", async () => {
  const q = new (Queue())();
  const failed = q.run("k", () => { throw new Error("boom"); });
  const next = q.run("k", () => "ok");
  await assert.rejects(failed, /boom/);
  assert.equal(await next, "ok");
});

test("queue: retry with backoff after a throw", async () => {
  const q = new (Queue({ retry: 2, backoff: () => 1 }))();
  let calls = 0;
  const result = await q.run("k", () => {
    calls++;
    if (calls < 3) throw new Error("flaky");
    return "done";
  });
  assert.equal(result, "done");
  assert.equal(calls, 3);
});

test("queue: timeout frees the caller but holds the key until the task really ends", async () => {
  const q = new (Queue({ timeout: 10 }))();
  const gate = deferred();
  let secondStarted = false;

  const slow = q.run("k", () => gate.promise);
  const second = q.run("k", () => { secondStarted = true; });

  await assert.rejects(slow, (error) => error instanceof QueueTimeoutError);
  await sleep(20);
  assert.equal(secondStarted, false, "no overlap with the task still running");
  assert.equal(q.size("k"), 2);

  gate.resolve();
  await second;
  assert.equal(secondStarted, true);
});

test("queue: pending waits for what was queued at call time, not what comes after", async () => {
  const q = new (Queue())();
  const first = deferred();
  const later = deferred();
  const ended = [];

  void q.run("k", async () => { await first.promise; ended.push("first"); });
  const waiting = q.pending("k").then(() => ended.push("pending"));
  void q.run("k", async () => { await later.promise; ended.push("later"); });

  first.resolve();
  await waiting;
  assert.deepEqual(ended, ["first", "pending"]);
  later.resolve();
  await q.pending("k");
  assert.equal(q.size("k"), 0);
});

test("queue: pending never rejects, empty lanes are removed", async () => {
  const q = new (Queue())();
  await q.pending("nothing");
  const failed = q.run("k", () => { throw new Error("x"); });
  await assert.rejects(failed);
  await q.pending("k");
  assert.equal(q.size("k"), 0);
});

/* ---------------- Batch ---------------- */

test("batch: same-turn items flush together, each caller gets its own result", async () => {
  const b = new (Batch())();
  const flushes = [];
  const handler = { flush: (items) => { flushes.push(items); return items.map((n) => n * 10); } };

  const results = await Promise.all([b.add("g", 1, handler), b.add("g", 2, handler), b.add("g", 3, handler)]);
  assert.deepEqual(flushes, [[1, 2, 3]]);
  assert.deepEqual(results, [10, 20, 30]);
});

test("batch: groups are separate; a void flush resolves callers with undefined", async () => {
  const b = new (Batch())();
  const seen = {};
  const handler = (name) => ({ flush: (items) => { seen[name] = items; } });
  const [x, y] = await Promise.all([b.add("a", "x", handler("a")), b.add("b", "y", handler("b"))]);
  assert.deepEqual(seen, { a: ["x"], b: ["y"] });
  assert.equal(x, undefined);
  assert.equal(y, undefined);
});

test("batch: window gathers across turns; max flushes early", async () => {
  const b = new (Batch({ window: 30, max: 3 }))();
  const flushes = [];
  const handler = { flush: (items) => void flushes.push(items) };

  void b.add("g", 1, handler);
  await sleep(5);
  void b.add("g", 2, handler);
  assert.deepEqual(flushes, []);
  await b.add("g", 3, handler);
  assert.deepEqual(flushes, [[1, 2, 3]], "max reached before the window closed");

  const late = b.add("g", 4, handler);
  await sleep(5);
  assert.equal(flushes.length, 1);
  await late;
  assert.deepEqual(flushes, [[1, 2, 3], [4]]);
});

test("batch: a throwing flush rejects every caller in it", async () => {
  const b = new (Batch())();
  const handler = { flush: () => { throw new Error("store down"); } };
  const calls = [b.add("g", 1, handler), b.add("g", 2, handler)];
  for (const call of calls) await assert.rejects(call, /store down/);
});

test("batch: pending waits for gathering and in-flight flushes, never rejects", async () => {
  const b = new (Batch({ window: 10 }))();
  const gate = deferred();
  const done = [];
  const handler = { flush: async (items) => { await gate.promise; done.push(...items); } };

  const call = b.add("g", "a", handler);
  const waiting = b.pending("g").then(() => done.push("pending"));
  await sleep(20);
  assert.deepEqual(done, []);
  gate.resolve();
  await call;
  await waiting;
  assert.deepEqual(done, ["a", "pending"]);

  const failing = b.add("g", "b", { flush: () => { throw new Error("x"); } });
  await b.pending("g");
  await assert.rejects(failing);
});

test("batch: flush(group) runs now", async () => {
  const b = new (Batch({ window: 10_000 }))();
  const flushes = [];
  const call = b.add("g", 1, { flush: (items) => void flushes.push(items) });
  await b.flush("g");
  await call;
  assert.deepEqual(flushes, [[1]]);
});
