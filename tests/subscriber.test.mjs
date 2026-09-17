/* Against the built package in dist/, the thing that ships. */
import { test } from "node:test";
import assert from "node:assert/strict";

const { Subscriber } = await import(new URL("../dist/subscriber.mjs", import.meta.url).href);

test("setState: merges and notifies with a detached copy", () => {
  const sub = new Subscriber({ count: 0, nested: { a: 1 } });
  const seen = [];
  sub.onStateChange((state) => seen.push(state));

  sub.setState({ nested: { b: 2 } });

  assert.deepEqual(sub.getState(), { count: 0, nested: { a: 1, b: 2 } });
  assert.equal(seen.length, 1);
  seen[0].nested.a = 99;
  assert.equal(sub.getState().nested.a, 1);
});

test("setState: no change, no event", () => {
  const sub = new Subscriber({ count: 1 });
  let calls = 0;
  sub.onStateChange(() => calls++);
  sub.setState({ count: 1 });
  assert.equal(calls, 0);
});

test("subscribe: unsubscribe stops delivery", () => {
  const sub = new Subscriber({});
  let calls = 0;
  const off = sub.subscribe("ping", () => calls++);
  sub.dispatch("ping");
  off();
  sub.dispatch("ping");
  assert.equal(calls, 1);
});
