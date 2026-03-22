# Changelog

## 0.1.0 (2026-03-22)

### Features

- **Types**: `primitive`, `LiteralObject`, `LiteralFunction`, `Objectable`, `Freezable`, `PartialLiteral`, `ToString`, `Promisable`, `AtomicObject`, `PrimitiveClass`, `BuiltInPrimitive`, `ExtendedFunction`
- **Utilities**: `clone`, `freeze`, `isEqual`, `merge`, `isFunction`, `isObject`, `isLiteralObject`, `isComplexObject`, `isObjectable`, `hasOwnProperty`, `toString`, `ucfirst`
- **Subscriber**: pub/sub event emitter with built-in state management
  - `subscribe` / `dispatch` for arbitrary channels
  - `setState` / `getState` / `onStateChange` for state management
  - `subscribeAsyncOnce` with AbortSignal support
  - `Subscriber.wire` for typed event domains
