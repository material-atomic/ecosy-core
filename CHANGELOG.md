# Changelog

## 0.2.1 (2026-04-06)

### Bug Fixes

- **Http**: Replaced direct `process.env` access with a safe `getEnv()` helper that guards against missing `process` (e.g. Edge, Cloudflare Workers)
- **Http**: Added optional chaining on `this.baseURL?.replace()` to prevent crash when `baseURL` is undefined
- **Http/Subscriber**: Changed `@ecosy/core/*` subpath imports to relative `./` imports for bundler compatibility

---

## 0.2.0 (2026-03-25)

### Features

- **Serialize**: New centralized serialization engine (`Serialize.Primitive`, `Serialize.JSON`, `Serialize.URL`, `Serialize.queryString`)
- **Slugify**: Unicode-safe string slugifier with custom transformer map and multi-language support
- **Searchify**: Diacritic-insensitive fuzzy search using sliding window algorithm with per-character cache
- **Http**: URL interpolation now uses `Serialize.interpolate`
- **Http**: `getQuery` refactored to use `Serialize.queryString.stringify` (supports nested objects and arrays)
- **Http**: `isValidQuery` refactored to use `Serialize.Primitive.isPrimitive` (now accepts `null`)
- **Utilities**: Added `get()` for safe deep object path resolution (dot/bracket notation)
- **Utilities**: Added `defer()` / `deferAsync()` — rAF + setTimeout scheduling with cancellation
- **Types**: Added `BuiltInPrimitive`, `ExtendedFunction`, `Freezable`, `PartialLiteral`, `ToString`
- **Subpath exports**: Added `./http`, `./logger`, `./syhemo`, `./serialize`, `./slugify`, `./searchify`

### Improvements

- Full JSDoc coverage for all exported types, classes, and functions
- All Vietnamese comments translated to English
- Optimized `Serialize` with static getters and lazy initialization

### Breaking Changes

- **Dateify/Dayify/Monthify/Yearify** moved to [`@ecosy/datekit`](https://github.com/material-atomic/ecosy-datekit)
  - Consumers must update: `@ecosy/core/dateify` → `@ecosy/datekit/dateify`
- **Mailer** moved to [`@ecosy/mailer`](https://github.com/material-atomic/ecosy-mailer)
- Removed `./dateify`, `./dayify`, `./monthify`, `./yearify` subpath exports

---

## 0.1.0 (2026-03-22)

### Features

- **Types**: `primitive`, `LiteralObject`, `LiteralFunction`, `Objectable`, `Freezable`, `PartialLiteral`, `ToString`, `Promisable`, `AtomicObject`, `PrimitiveClass`, `BuiltInPrimitive`, `ExtendedFunction`
- **Utilities**: `clone`, `freeze`, `isEqual`, `merge`, `isFunction`, `isObject`, `isLiteralObject`, `isComplexObject`, `isObjectable`, `hasOwnProperty`, `toString`, `ucfirst`
- **Subscriber**: pub/sub event emitter with built-in state management
  - `subscribe` / `dispatch` for arbitrary channels
  - `setState` / `getState` / `onStateChange` for state management
  - `subscribeAsyncOnce` with AbortSignal support
  - `Subscriber.wire` for typed event domains
