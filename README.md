# @ecosy/core

Lightweight utilities, pub/sub subscriber, and types for TypeScript applications.

## Installation

```bash
npm install @ecosy/core
# or
yarn add @ecosy/core
```

## Modules

| Entry point | Description |
|--|--|
| `@ecosy/core` | Re-exports utilities + subscriber |
| `@ecosy/core/types` | TypeScript type utilities |
| `@ecosy/core/utilities` | Runtime utility functions |
| `@ecosy/core/subscriber` | Pub/sub event emitter with state |

---

## Types

```ts
import type {
  primitive,
  LiteralObject,
  LiteralFunction,
  Objectable,
  Freezable,
  PartialLiteral,
  ToString,
  Promisable,
  AtomicObject,
} from "@ecosy/core/types";
```

| Type | Description |
|--|--|
| `primitive` | `string \| number \| boolean \| bigint \| symbol \| undefined \| null` |
| `LiteralObject` | Plain object type (`Record<PropertyKey, unknown> \| object`) |
| `LiteralFunction<R, A>` | Generic function type `(...args: A) => R` |
| `Objectable` | `LiteralObject \| Array \| LiteralFunction` |
| `Freezable<T>` | Recursively readonly version of `T` |
| `PartialLiteral<T>` | Deep partial that respects built-in types (Map, Set, Promise, etc.) |
| `ToString<T>` | Converts type to its string literal representation |
| `Promisable<V>` | `V \| Promise<V>` |
| `AtomicObject<K, V>` | `{ [K]: V }` |

---

## Utilities

```ts
import {
  clone,
  freeze,
  isEqual,
  isFunction,
  isObject,
  isLiteralObject,
  isComplexObject,
  isObjectable,
  hasOwnProperty,
  merge,
  toString,
  ucfirst,
} from "@ecosy/core/utilities";
```

### `clone<T>(data: T): T`

Deep clones a value. Handles circular references, Date, RegExp, Map, Set, ArrayBuffer, TypedArrays, arrays, and plain objects. Skips non-cloneable types (Error, Promise, WeakMap, DOM nodes, etc.).

```ts
const original = { a: 1, b: { c: [2, 3] } };
const cloned = clone(original);
cloned.b.c.push(4);
original.b.c.length; // 3 — unaffected
```

### `freeze<T>(data: T): Freezable<T>`

Deep freezes a value by cloning first, then recursively calling `Object.freeze`.

```ts
const frozen = freeze({ a: { b: 1 } });
frozen.a.b = 2; // throws in strict mode
```

### `isEqual(a: unknown, b: unknown): boolean`

Deep structural equality check. Supports primitives, arrays, plain objects, Date, RegExp, Map, Set, ArrayBuffer, and TypedArrays.

```ts
isEqual({ a: [1, 2] }, { a: [1, 2] }); // true
isEqual(new Date(0), new Date(0));      // true
```

### `merge<T>(source, target, cloneDeep?): T`

Deep merges `target` into `source`. Prototype-polluting keys (`__proto__`, `constructor`, `prototype`) are rejected.

```ts
merge({ a: 1, b: { c: 2 } }, { b: { d: 3 } });
// { a: 1, b: { c: 2, d: 3 } }
```

### `isFunction(value): value is LiteralFunction`

Checks if a value is a function (sync, async, or generator).

### `isObject(value): value is object`

Checks if a value is a non-null object.

### `isLiteralObject(value): value is LiteralObject`

Checks if a value is a plain object (`{}` or `Object.create(null)`).

### `isComplexObject<T>(value): value is T`

Checks if a value is a non-array object (e.g., class instance).

### `isObjectable(value): value is Objectable`

Checks if a value is an object, array, or function.

### `hasOwnProperty(obj, key): boolean`

Type-safe `Object.prototype.hasOwnProperty.call()`.

### `toString(value): string`

Returns the internal `[[Class]]` tag via `Object.prototype.toString`.

```ts
toString([]);   // "[object Array]"
toString(null); // "[object Null]"
```

### `ucfirst<T>(str: T): Capitalize<T>`

Capitalizes the first character of a string.

---

## Subscriber

A pub/sub event emitter with built-in state management.

```ts
import { Subscriber } from "@ecosy/core/subscriber";
```

### Basic usage

```ts
const sub = new Subscriber({ count: 0 });

// Subscribe to state changes
const unsub = sub.onStateChange((state) => {
  console.log("Count:", state.count);
});

// Update state
sub.setState({ count: 1 }); // logs "Count: 1"

// Cleanup
unsub();
```

### Custom channels

```ts
sub.subscribe("user:login", (user) => {
  console.log("Logged in:", user.name);
});

sub.dispatch("user:login", { name: "Alice" });
```

### Async once

```ts
const payload = await sub.subscribeAsyncOnce("data:ready");
```

> [!WARNING]
> If the channel is never dispatched and no `AbortSignal` is provided, the returned Promise will never resolve, causing a **memory leak**. Always pass an `AbortSignal` or ensure the channel will eventually be dispatched.

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 5000); // timeout after 5s

try {
  const payload = await sub.subscribeAsyncOnce("data:ready", undefined, controller.signal);
} catch {
  console.log("Timed out or cancelled");
}
```

### Wiring events

```ts
const events = {
  auth: {
    login: "$auth:login",
    logout: "$auth:logout",
  },
} as const;

const wired = Subscriber.wire(sub, events);

// Dispatch
wired.auth.login({ user: "Alice" });

// Listen
wired.auth.onLogin((payload) => {
  console.log(payload.user);
});
```

---

## Related packages

| Package | Description |
|--|--|
| [`@ecosy/store`](https://github.com/material-atomic/ecosy-store) | State management with slices and reducers |
| [`@ecosy/react`](https://github.com/material-atomic/ecosy-react) | React hooks for `@ecosy/store` |

## License

MIT
