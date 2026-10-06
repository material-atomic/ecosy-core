/* Against the built package in dist/, the thing that ships. */
import { test } from "node:test";
import assert from "node:assert/strict";

const { get, merge, mergeShallow, clone, isEqual } = await import(new URL("../dist/utilities/index.mjs", import.meta.url).href);

test("get: dot, bracket and array paths", () => {
  const data = { users: [{ name: "Alice" }] };
  assert.equal(get(data, "users[0].name"), "Alice");
  assert.equal(get(data, "users.0.name"), "Alice");
  assert.equal(get(data, ["users", "0", "name"]), "Alice");
});

test("get: default only for undefined, falsy values come back as they are", () => {
  const data = { zero: 0, no: false, empty: "", nil: null };
  assert.equal(get(data, "missing", "d"), "d");
  assert.equal(get(data, "zero", 1), 0);
  assert.equal(get(data, "no", true), false);
  assert.equal(get(data, "empty", "x"), "");
  assert.equal(get(data, "nil", "x"), null);
  assert.equal(get(null, "a", "d"), "d");
  assert.equal(get({ a: null }, "a.b", "d"), "d");
});

test("get: an empty path is the data itself", () => {
  const data = { a: 1 };
  assert.equal(get(data, ""), data);
  assert.equal(get(data, []), data);
});

test("merge: deep for plain objects, arrays replaced whole", () => {
  assert.deepEqual(merge({ a: 1, b: { c: 2 } }, { b: { d: 3 } }), { a: 1, b: { c: 2, d: 3 } });
  assert.deepEqual(merge({ list: [1, 2, 3] }, { list: [9] }), { list: [9] });
});

test("merge: prototype-polluting keys are ignored", () => {
  const result = merge({}, JSON.parse('{"__proto__":{"polluted":true},"constructor":{"x":1}}'));
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(result, "constructor"), false);
});

test("mergeShallow: each key given replaces the current one whole; the rest stay", () => {
  assert.deepEqual(mergeShallow({ a: 1, b: { c: 2, d: 3 } }, { b: { c: 2 } }), { a: 1, b: { c: 2 } });
  assert.deepEqual(mergeShallow({ a: 1 }, undefined), { a: 1 });
  const result = mergeShallow({}, JSON.parse('{"__proto__":{"polluted":true},"constructor":{"x":1}}'));
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(result, "constructor"), false);
});

test("clone: deep and detached", () => {
  const source = { a: { b: [1, { c: 2 }] }, d: new Date(0), m: new Map([["k", { v: 1 }]]) };
  const copy = clone(source);
  assert.deepEqual(copy, source);
  copy.a.b[1].c = 99;
  copy.m.get("k").v = 99;
  assert.equal(source.a.b[1].c, 2);
  assert.equal(source.m.get("k").v, 1);
});

test("isEqual: deep, including Date, Map and Set", () => {
  assert.equal(isEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }), true);
  assert.equal(isEqual({ a: 1 }, { a: 2 }), false);
  assert.equal(isEqual(new Date(5), new Date(5)), true);
  assert.equal(isEqual(new Map([["a", 1]]), new Map([["a", 2]])), false);
  assert.equal(isEqual(new Set([1, 2]), new Set([1, 2])), true);
});

const { set, unset, toPath } = await import(new URL("../dist/utilities/index.mjs", import.meta.url).href);

test("toPath: the same keys get reads", () => {
  assert.deepEqual(toPath("a.b[0].c"), ["a", "b", "0", "c"]);
  assert.deepEqual(toPath(".a..b."), ["a", "b"]);
  assert.deepEqual(toPath(["a.b", "c"]), ["a.b", "c"]);
  assert.deepEqual(toPath("a[b]"), ["a[b]"]);
});

test("set: writes in place, returns nothing, get reads it back", () => {
  const state = { cart: { items: [{ qty: 1 }, { qty: 5 }] } };
  const items = state.cart.items;
  assert.equal(set(state, "cart.items[0].qty", 3), undefined);
  assert.equal(get(state, "cart.items[0].qty"), 3);
  assert.equal(state.cart.items, items, "existing containers are walked into, not replaced");
  assert.equal(state.cart.items[1].qty, 5);
});

test("set: creates missing containers - bracket index makes an array, dot an object", () => {
  const state = {};
  set(state, "list[0].name", "a");
  set(state, "map.0.name", "b");
  assert.ok(Array.isArray(state.list));
  assert.deepEqual(state.list, [{ name: "a" }]);
  assert.ok(!Array.isArray(state.map));
  assert.deepEqual(state.map, { 0: { name: "b" } });
});

test("set: destroys what cannot be walked into", () => {
  const state = { a: 1, d: new Date(0), n: null };
  set(state, "a.b", 2);
  set(state, "d.x", 3);
  set(state, "n[0]", 4);
  assert.deepEqual(state, { a: { b: 2 }, d: { x: 3 }, n: [4] });
});

test("set: refuses unsafe segments, empty paths and non-containers", () => {
  assert.throws(() => set({}, "__proto__.polluted", true), TypeError);
  assert.throws(() => set({}, "a.constructor.prototype.x", 1), TypeError);
  assert.equal({}.polluted, undefined);
  assert.throws(() => set({}, "", 1), TypeError);
  assert.throws(() => set(null, "a", 1), TypeError);
  assert.throws(() => set(new Date(), "a", 1), TypeError);
});

test("unset: deletes object keys, splices array elements, ignores missing paths", () => {
  const state = { a: { b: 1, c: 2 }, items: ["x", "y", "z"] };
  unset(state, "a.b");
  unset(state, "items[1]");
  unset(state, "missing.deep.path");
  unset(state, "items[9]");
  assert.deepEqual(state, { a: { c: 2 }, items: ["x", "z"] });
  assert.throws(() => unset(state, "__proto__"), TypeError);
  assert.throws(() => unset(state, []), TypeError);
});
