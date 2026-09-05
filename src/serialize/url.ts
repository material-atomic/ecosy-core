import { freeze } from "../utilities/freeze";
import type { PrimitiveValue, SerializeURL } from "./types";

/** URL encoding/decoding with malformed-character recovery. */
export const Url: SerializeURL = freeze({
  encode(value: string, component: boolean | ((value: string) => string) = true): string {
    if (!value) return "";
    if (typeof component === "function") return component(value);

    try {
      return component ? encodeURIComponent(value) : encodeURI(value);
    } catch {
      // Strip broken surrogate chars and retry instead of crashing
      const sanitized = value.replace(/[\uD800-\uDFFF]/g, "");
      return component ? encodeURIComponent(sanitized) : encodeURI(sanitized);
    }
  },
  decode: (value: string, component: boolean | ((value: string) => string) = true): string => {
    if (!value) return "";
    if (typeof component === "function") return component(value);

    const decoder = component ? decodeURIComponent : decodeURI;
    const normalized = component ? value.replace(/\+/g, "%20") : value;

    return normalized.replace(/(%[0-9A-F]{2})+/gi, (match) => {
      try {
        return decoder(match);
      } catch {
        console.warn(`[Serialize.URL] Cannot decode part: ${match}`);
        return match; // Keep broken parts intact, recover what we can
      }
    });
  },
  build: (uri: string, params: Record<string, PrimitiveValue> | null | undefined): string => {
    if (!uri) return "";
    if (!params || typeof params !== "object") return uri;

    // Single-pass regex replace for maximum speed
    return uri.replace(/:([a-zA-Z\d_]+)/g, (fullMatch, key) => {
      const value = params[key];

      // If param is not provided, keep the ":key" placeholder
      if (value === null || value === undefined) {
        return fullMatch;
      }

      // Auto-encode the value using the same URL encoder
      return Url.encode(String(value), true);
    });
  },
});
