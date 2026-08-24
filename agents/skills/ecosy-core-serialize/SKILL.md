---
name: ecosy-core-serialize
description: Guides the AI on using the centralized Serialize engine from @ecosy/core for JSON parsing, URL encoding, query string building, and deep interpolation.
---

# `ecosy-core-serialize` Skill

When working with data serialization, URL encoding, query strings, or JSON parsing in a project using `@ecosy/core`, you must **NOT** use the standard `JSON.stringify`, `JSON.parse`, `encodeURIComponent`, or standard `URLSearchParams`. You must use the unified `Serialize` class to guarantee safety (e.g., BigInt handling, preventing throws on malformed JSON).

## 1. Safe JSON Operations (`Serialize.JSON`)

Always use `Serialize.JSON` for parsing and stringifying. It handles `BigInt` values safely, preserves Dates, and never throws errors on malformed JSON (returns `null` instead).

```typescript
import { Serialize } from "@ecosy/core";

// 1. Safe Stringify (Handles BigInt, Dates, custom classes)
const jsonString = Serialize.JSON.stringify({ 
  id: 123n, 
  createdAt: new Date(),
  data: { nested: true }
});

// 2. Safe Parse (Returns null instead of throwing on invalid JSON)
const parsed = Serialize.JSON.parse<{ id: bigint; data: any }>(jsonString);
if (parsed) {
  console.log(parsed.id);
}
```

## 2. URL and Query String Formatting

Use `Serialize.URL` for encoding/decoding and building paths. Use `Serialize.queryString` for object-to-query conversions.

```typescript
import { Serialize } from "@ecosy/core";

// 1. Safe URL encoding/decoding (resilient against malformed URI errors)
const encoded = Serialize.URL.encode("hello world & special");
const decoded = Serialize.URL.decode(encoded);

// 2. Building URIs with parameters natively
const fullUrl = Serialize.URL.build("/users", { limit: 10, offset: 0 }); 
// Output: "/users?limit=10&offset=0"

// 3. Stringify complex query objects (supports array formats)
const qs = Serialize.queryString.stringify(
  { ids: [1, 2, 3], status: "active" }, 
  { arrayFormat: "bracket" }
); 
// Output: "ids[]=1&ids[]=2&ids[]=3&status=active"

// 4. Parse Query Strings
const parsedQuery = Serialize.queryString.parse("?page=1&limit=20");
```

## 3. String Interpolation

For injecting dynamic parameters into paths or template strings, use `Serialize.interpolate`. It automatically handles deep path resolution (e.g., `{user.id}`) safely.

```typescript
import { Serialize } from "@ecosy/core";

// Deep object resolution
const path = Serialize.interpolate("/api/users/{user.id}/posts/{postId}", {
  user: { id: "999" },
  postId: "abc-123"
});
// Output: "/api/users/999/posts/abc-123"

// Array resolution
const msg = Serialize.interpolate("Hello {0}, your score is {1}", ["John", 100]);
// Output: "Hello John, your score is 100"
```

## 4. Primitive Checks and Normalization

Use `Serialize.Primitive` for type guards and deep data normalization.

```typescript
import { Serialize } from "@ecosy/core";

if (Serialize.Primitive.isPlainObject(unknownData)) {
  // unknownData is narrowed to Record<string, unknown>
}

// Deep normalize data structure
const normalized = Serialize.Primitive.normalize({
  a: 1,
  b: undefined, // Stripped out during normalization (usually)
  c: new Date()
});
```
