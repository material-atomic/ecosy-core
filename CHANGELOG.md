# Changelog

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
