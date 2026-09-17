# Changelog

## 0.7.0 (2026-09-18)

Everything the Ecosy packages kept rewriting for themselves now lives here, each
behind its own subpath. Node-only modules stay off the package index, as `cache`
and `syhemo` already did.

### Features

- **`@ecosy/core/crypt`**: encryption and signing tokens on Web Crypto, so they run on Node, the edge and Workers alike. `AesGcm` (the default), `AesCbc` and `AesCtr` — the last two with HMAC-SHA256 around them, since neither has integrity of its own — all built with `defineCipher`, which takes an algorithm and adds everything easy to get wrong: a key per purpose (HKDF-SHA256), a `secret` list for rotation with the key id carried in the output, a key generated for the process when no secret is given (with the warning that says what that costs), the `e1.<algorithm>.<key id>.<iv>.<ciphertext>` format with its header bound in as AAD, and HMAC signing independent of the cipher. `purpose` is required everywhere: one use of a token can never pass for another. `assertCrypt` puts a token through nine checks — round trip, plaintext in the output, a fixed IV, integrity, AAD, deterministic signing, verification, and purpose separation both ways — and every token goes through it once before its first use. `strict: false` skips it.
- **`@ecosy/core/session`**: sessions with the id in a signed cookie and the data encrypted in a store, and no tie to any framework — cookies go through a `CookieJar` an adapter builds. `set` (batch → queue → save), `setQueue` (queue → save), `setIn`/`unset` (straight onto the state, then save), `persist`, `start`, `getAsync`, `regenerate` with a grace period for the old id, `destroy`, `setUser` and `revokeUser`. Writes that overlap are settled path by path, by call order, so a `set` held in a batch never undoes a `setIn` made after it. Saving is one at a time per session with a single trailing save, so the store ends on the latest state. `MemoryStore` is the default: `max`, `distance`, `onMax`, optional `persist` of full snapshots, sweeping on read and write, `prune`, `listByUser`, `deleteByUser`.
- **`@ecosy/core/csrf`**: `origin()` — the check that needs no token and no secret — plus signed tokens for forms and scripts (`issue`, `verify`, `read`, and `claim` for single use), `cookie()`/`check()`/`stateful()` for a front end that reads `XSRF-TOKEN` and sends it back in a header, `login.*` for the nonce before there is a session, and `oauth.*` for a sign-in's state, PKCE and OIDC nonce.
- **`@ecosy/core/queue`** and **`@ecosy/core/batch`**: work run one at a time per key, and items gathered for a moment then handled together. A queue's timeout frees the caller but holds the key until the task really ends, which is what keeps a task past its deadline from running beside its own retry.
- **`@ecosy/core/logger`**: `@ecosy/logger` moved in whole, tests included.
- **`@ecosy/core/schedule`**: `@ecosy/schedule` moved in, now sharing the core injection types and using `Queue` for the lane a task holds. That fixes an overlap: a handler past its deadline is still running, and both its retry and the next fire used to start beside it.
- **`storageKey`**: `Session`, `MemoryStore`, `Queue` and `Batch` take one. State then lives on `globalThis` under that name, so every copy of a module shares it — needed on Next, where the proxy and the route handlers are separate module graphs. Without it, state belongs to the class, and anchoring the class (`@ecosy/anchor`) does the same thing.
- **`set` and `unset`**: path writes in `@ecosy/core/utilities`, the counterparts of `get`, sharing its path parser. Both refuse `__proto__`, `constructor` and `prototype`.
- **Types**: `ClassType`, `InjectMap`, `Injected` and `Promisable` have one definition, in `@ecosy/core/types`. `InjectClass` and `CacheInjects` in `cache` are aliases of them.
- **Tests**: the package has a suite — `node --test` against `dist`, the thing that ships — and `prepublishOnly` runs it.

### Breaking Changes

- **`Subscriber.shallow` is now `Subscriber.ops`** (`Shallow` is `StateOps`). `merge`, `clone` and `isEqual` are all deep, so the old name said the opposite of what they do. The old name stays as a deprecated alias, so nothing has to change yet.

## 0.6.1 (2026-09-15)

### Fixes

- **Exports**: `@ecosy/core/package.json` resolves; `require("@ecosy/core/package.json")` threw `ERR_PACKAGE_PATH_NOT_EXPORTED` before.

## 0.6.0

### Features

- **Cache `inject`**: `DiskCache` and `RedisCache` take an `inject` map — the same shape `Schedule({ … })` and `Route({ … })` take. Each class is constructed once per cache instance and handed to `onError` as its third argument, so a failed write can go through the app's own logger instead of one reached around the cache. A handler written for `(error, key)` still fits.

### Bug Fixes

- **Build kept dropping `console.warn`**: terser ran with `drop_console: true`, which took the cache's default `onError` with it — a failed cache write in the published package was silent. It now drops only `log`, `info` and `debug`.

## 0.4.0 (2026-08-24)

### Features

- **Fetcher**: Introduced a new **Mutable Chaining Builder** pattern for HTTP requests. The new `Fetcher` unifies client creation and pipeline execution, allowing deep configuration via `.use()`, `.request()`, `.transform()`, `.retry()`, and `.onResult()`.
- **Fetcher Plugins**: Added a plugin ecosystem based on Koa-style `FetcherMiddleware` for limitless extensibility.
- **Plugin `dedupe`**: A built-in plugin that prevents the "Thundering Herd" problem by deduplicating identical concurrent requests and sharing the same Promise.
- **Plugin `logger`**: A built-in plugin that logs request/response lifecycles and measures execution time.
- **Plugin `cache`**: A built-in plugin providing lightweight in-memory caching with TTL support.
- **Exports**: Added `./http/fetcher` and `./http/plugins` to the root exports.

### Improvements

- **Http Architecture**: Extracted the core client creation logic into `client.ts` (`createClient`). `Http` instances are now tightly scoped to their respective `Fetcher` builders rather than relying on static mutable state.
- **Late-Binding Auth**: The new `Fetcher.retry` hook supports returning a Promise, enabling seamless, domain-agnostic refresh token debouncing (e.g. dropping in `refreshing` lock logic without modifying the core).

### Bug Fixes

- **Http**: Fixed an issue where `URLSearchParams` was not properly supported/parsed when passed as query parameters.
- **Http**: Updated `DELETE` requests to allow sending a `body` payload, accommodating APIs that require a request body for deletion.

### Breaking Changes

- **HttpStorage**: Removed `HttpStorage` entirely. Storage and token injection logic should now be handled directly via `Fetcher` interceptors (`.request()`) and lifecycle hooks (`.retry()`).

## 0.3.4 (2026-04-16)

### Bug Fixes

- **Env**: replaced direct `import.meta` access with `new Function("return import.meta")()` in the default env getter. `import.meta` is a compile-time syntax that causes a parse error on runtimes without ESM support (e.g. Hermes in React Native). The `new Function` wrapper defers evaluation to runtime and is safely caught by the existing try/catch.

---

## 0.3.3 (2026-04-16)

### Features

- **HttpStorage**: `getItem`, `setItem`, `removeItem` now accept both sync and async return values (`Promisable<T>`). This allows using async storage backends (e.g. `AsyncStorage` in React Native, `expo-secure-store`, database-backed stores) without needing a synchronous wrapper.
- **Http.getToken / Http.getHeaders**: both are now `async` and `await` the storage calls, making the auth token flow compatible with async storage adapters.

### Improvements

- **Imports**: type imports now point directly at `./types/built-in` instead of the barrel `./types`, improving tree-shaking and avoiding circular dependency risks.
- **Imports**: replaced subpath alias `@ecosy/core/types` with relative `../types/built-in` in internal utility files (`is-function.ts`, `object.ts`), keeping resolution self-contained within the package.
- **Imports**: reordered `http.ts` imports for consistency.

---

## 0.3.2 (2026-04-16)

### Features

- **HttpOptions.configs**: constructor-level pass-through bag merged into every request sent through this instance. Same shape and allowlist as per-call `HttpRequest.configs` (`credentials`, `cache`, `mode`, `redirect`, `referrer`, `referrerPolicy`, `integrity`, `keepalive`, `priority`, `duplex`, plus framework extensions `next`, `cf`, `dispatcher`). Per-call `configs` override instance defaults. Avoids needing an `on("request", …)` interceptor just to set things like `credentials: "include"` on every call.

### Improvements

- Extracted `filterFetchConfigs` helper so the allowlist filter is applied in a single place (both constructor defaults and per-call `configs`), replacing the inline `for … of Object.keys` loop in `request()`.

---

## 0.3.1 (2026-04-15)

### Features

- **HttpRequest.configs**: new pass-through bag for fetch `RequestInit` fields the library does not manage (`credentials`, `cache`, `mode`, `redirect`, `referrer`, `referrerPolicy`, `integrity`, `keepalive`, `priority`, `duplex`) plus framework extensions (`next` for Next.js, `cf` for Cloudflare Workers, `dispatcher` for undici). Unknown keys are silently dropped via allowlist, so compromised callers cannot smuggle arbitrary fields. Lib-level fields (`method`, `headers`, `body`, `signal`) always win.

### Security

- **Http.getURL**: protocol-relative URLs (`//host/…`) are rejected; absolute URLs must use `http:`/`https:` and their origin must match `baseURL` or an entry in the new `allowedOrigins` constructor option. Prevents silent host-hijack via attacker-controlled path strings (class-of-issue behind CVE-2024-39338 in axios).
- **Http.getURL**: path-param values are now percent-encoded via `Serialize.URL.encode`, so `{id}` with value `"../admin"` can no longer traverse the URL.
- **Http.request**: credentialed responses (Authorization / Cookie sent) that arrived from a different origin — typically via a server-controlled 3xx redirect — are refused. Guards against token exfil on runtimes that don't auto-strip Authorization on cross-origin redirect.
- **Http.getToken**: stored token is validated against RFC 7230 header-value charset. A CRLF or control char (e.g. from XSS-written storage) no longer smuggles headers or causes the runtime to silently drop Authorization (fail-open).
- **Http.getQuery / getURL**: `__proto__`, `constructor`, and `prototype` are stripped from `params`/`query` before serialization, closing a prototype-pollution path to downstream parsers.

### Notes for upgraders

- **Http** constructor now accepts either a base URL string (unchanged form) **or** an `HttpOptions` object (`{ baseURL?, allowedOrigins? }`). `new Http("https://api")` works the same as before. If you call multiple hosts from one instance, pass `allowedOrigins` via the object form.
- If you were relying on **pre-encoded** path params (e.g. passing `"%20"`), remove the pre-encoding — the library encodes once now.
- Calls that depended on following redirects across origins while carrying credentials will throw. That was the exploit path this release closes.

---

## 0.3.0 (2026-04-15)

### Features

- **Http**: New `Endpoint` registry for grouping service endpoints by name (`Endpoint.register(service, endpoints)` / `Endpoint.all()`), also exposed as `Http.Endpoint`
- **Http**: New `HttpUpload` enum (`UPLOAD`, `RELATED`) replacing the `"UPLOAD"` string literal in `Http.createFactory`
- **Http**: New `related()` method for `multipart/related` uploads (JSON metadata + binary body), ready for Google Drive-style APIs
- **Http**: `getBody()` now accepts `Uint8Array` / `ArrayBuffer` payloads for binary requests
- **Env**: New `./env` subpath exporting the `getEnv()` helper (previously inlined in `http.ts`)
- **Utilities**: New `sanitizeMime()` and `MIME_REGEX` for validating MIME strings
- **Utilities**: New `isFormData()` standalone type guard
- **Utilities**: Consolidated `toString`, `ucfirst`, `pascalToKebab` into a single `./string` module
- **Utilities**: Consolidated `objectToFormData` (and new `isFormData`) into `./formdata`

### Improvements

- Internal modules now use direct relative imports (e.g. `./utilities/get`) instead of barrel re-exports, improving tree-shaking
- `XMLHttpRequest` is declared globally inside `http.ts` so the upload path compiles on non-DOM runtimes (React Native, Workers)

### Breaking Changes

- **Http**: Removed `Http.prototype.isFormData` — use the new standalone `isFormData` from `@ecosy/core/utilities`
- **Http**: `createFactory` typing now uses `HttpMethod | HttpUpload` instead of `HttpMethod | "UPLOAD"`. Passing the raw string `"UPLOAD"` still works at runtime (enum value is `"UPLOAD"`) but callers on strict TS should use `HttpUpload.UPLOAD`
- **Barrel**: `syhemo` is no longer re-exported from the root `@ecosy/core` entry; import from the `@ecosy/core/syhemo` subpath instead
- **Utilities files**: `to-string.ts`, `ucfirst.ts`, `pascal-to-kebab.ts`, `object-to-formdata.ts` removed as standalone files. Public exports are unchanged when importing from `@ecosy/core/utilities`

---

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
