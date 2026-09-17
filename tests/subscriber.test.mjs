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

test("ops: replaceable, and `shallow` still names the same thing", () => {
  const sub = new Subscriber({ n: 1 });
  let compared = 0;

  sub.ops = {
    isEqual: (a, b) => {
      compared++;
      return JSON.stringify(a) === JSON.stringify(b);
    },
  };

  assert.equal(typeof sub.shallow.merge, "function");
  assert.equal(typeof sub.ops.clone, "function");

  sub.setState({ n: 1 });
  sub.setState({ n: 2 });
  assert.equal(compared, 2, "the replacement is what decides a change");
  assert.equal(sub.getState().n, 2);

  sub.shallow = { isEqual: () => true };
  sub.setState({ n: 3 });
  assert.equal(sub.getState().n, 2, "no change, by the ops set through the old name");
});
