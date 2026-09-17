/* Against the built package in dist/, the thing that ships. */
import { test } from "node:test";
import assert from "node:assert/strict";

const { get, merge, clone, isEqual } = await import(new URL("../dist/utilities/index.mjs", import.meta.url).href);

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
