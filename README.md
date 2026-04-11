# @ecosy/core

A modular, tree-shakable collection of essential utilities, serialization primitives, and event-driven patterns for modern TypeScript applications.

## Installation

```bash
yarn add @ecosy/core
```

## Features

### Subpath Imports

| Entry point              | Description                                   |
| ------------------------ | --------------------------------------------- |
| `@ecosy/core`            | Re-exports all modules                        |
| `@ecosy/core/types`      | TypeScript type utilities                     |
| `@ecosy/core/utilities`  | Runtime utility functions                     |
| `@ecosy/core/subscriber` | Pub/sub event emitter with state              |
| `@ecosy/core/http`       | HTTP client with interceptors and upload      |
| `@ecosy/core/logger`     | Structured logger with log levels             |
| `@ecosy/core/syhemo`     | System health monitor                         |
| `@ecosy/core/serialize`  | Serialization engine (JSON, URL, queryString) |
| `@ecosy/core/slugify`    | Unicode-safe string slugifier                 |
| `@ecosy/core/searchify`  | Diacritic-insensitive fuzzy search            |

### Types

Deep utility types for TypeScript — `Freezable<T>`, `PartialLiteral<T>`, `Promisable<V>`, `ToString<T>`, and more.

### Utilities

- **`clone`** — Deep clone with circular reference handling
- **`freeze`** — Deep freeze via clone + `Object.freeze`
- **`isEqual`** — Structural deep equality (Date, Map, Set, TypedArrays)
- **`merge`** — Deep merge with prototype pollution protection
- **`flatten`** / **`flattenToArray`** — Object flattening
- **`get`** — Safe deep path resolution (`"a.b[0].c"`)
- **`defer`** / **`deferAsync`** — rAF + setTimeout scheduling with cancel
- Type guards: `isFunction`, `isObject`, `isLiteralObject`, `isComplexObject`, `isObjectable`, `hasOwnProperty`

### Subscriber

Pub/sub event emitter with built-in state management, async once, and typed wiring.

### Http

Configurable HTTP client with request/response interceptors, auth token injection, URL interpolation via Serialize, and XHR-based upload with progress tracking.

### Serialize

Centralized serialization engine:

- **`Serialize.Primitive`** — Type guards and deep normalization (BigInt, Date, undefined stripping)
- **`Serialize.JSON`** — Safe stringify/parse that never throws
- **`Serialize.URL`** — Robust encode/decode with `:param` URL building
- **`Serialize.queryString`** — Advanced parse/stringify (bracket, index, comma formats)

### Slugify & Searchify

- **`slugify`** — Unicode-safe slug generation with custom transformer map
- **`searchify`** — Diacritic-insensitive fuzzy search using sliding window algorithm

## Documentation

Full API reference and guides: **[docs.ecosy.io](https://docs.ecosy.io)**

## Related Packages

| Package                                                              | Description                                                     |
| -------------------------------------------------------------------- | --------------------------------------------------------------- |
| [`@ecosy/datekit`](https://github.com/material-atomic/ecosy-datekit) | Headless date utilities (Dateify, Dayify, Monthify, Yearify)    |
| [`@ecosy/mailer`](https://github.com/material-atomic/ecosy-mailer)   | Email engine with template formatting, retry, and rate limiting |
| [`@ecosy/store`](https://github.com/material-atomic/ecosy-store)     | State management with slices and reducers                       |
| [`@ecosy/react`](https://github.com/material-atomic/ecosy-react)     | React hooks for `@ecosy/store`                                  |

## License

MIT
