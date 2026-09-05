import { freeze } from "../utilities/freeze";
import { Primitive } from "./primitive";
import { Url } from "./url";
import type { SerializeQueryOptions, SerializeQueryString } from "./types";

/** Query string parse/stringify with configurable array formats. */
export const queryString: SerializeQueryString = freeze({
  parse(query: string): Record<string, string> {
    if (!query) return {};
    const cleanQuery = query.startsWith("?") ? query.slice(1) : query;
    const result: Record<string, string> = {};

    cleanQuery.split("&").forEach((part) => {
      if (!part) return;
      const [key, value] = part.split("=");
      if (key) {
        result[Url.decode(key)] = value ? Url.decode(value) : "";
      }
    });

    return result;
  },
  stringify(params: Record<string, unknown>, options: SerializeQueryOptions = {}): string {
    if (params === null || typeof params !== "object") return "";

    const {
      arrayFormat = "none",
      arrayFormatSeparator = ",",
      skipNull = false,
      skipEmptyString = false,
      encode = true,
      strict = true,
      sort = false,
    } = options;

    const isValidKey = (k: string) => k.length > 0 && /^[a-zA-Z0-9_\-.[\]]+$/.test(k);

    // Internal encode wrapper
    const encoder = (val: string): string => {
      if (!encode) return val;
      return Url.encode(val, encode);
    };

    const resultPairs: string[] = [];

    // Flat recursion — traverse arrays and nested objects
    const traverse = (prefix: string, obj: unknown) => {
      if (Array.isArray(obj)) {
        if (arrayFormat === "comma" || arrayFormat === "separator") {
          const validVals = obj.filter((v) => v !== null && v !== undefined && v !== "");
          if (validVals.length > 0) {
            resultPairs.push(
              `${encoder(prefix)}=${encoder(validVals.map(String).join(arrayFormatSeparator))}`,
            );
          }
          return;
        }
        obj.forEach((val, idx) => {
          let arrayKey = prefix;
          if (arrayFormat === "bracket") arrayKey = `${prefix}[]`;
          else if (arrayFormat === "index") arrayKey = `${prefix}[${idx}]`;
          traverse(arrayKey, val);
        });
        return;
      }

      if (Primitive.isPlainObject(obj)) {
        for (const subKey in obj) {
          if (Object.prototype.hasOwnProperty.call(obj, subKey)) {
            traverse(`${prefix}[${subKey}]`, obj[subKey as keyof typeof obj]);
          }
        }
        return;
      }

      // Primitive formatting
      if (obj === null || obj === undefined) {
        if (!skipNull) resultPairs.push(`${encoder(prefix)}=`);
        return;
      }
      if (obj === "") {
        if (!skipEmptyString) resultPairs.push(`${encoder(prefix)}=`);
        return;
      }
      if (typeof obj === "boolean") {
        resultPairs.push(`${encoder(prefix)}=${obj ? "true" : "false"}`);
        return;
      }
      if (Primitive.isDate(obj)) {
        resultPairs.push(`${encoder(prefix)}=${encoder(obj.toISOString())}`);
        return;
      }

      resultPairs.push(`${encoder(prefix)}=${encoder(String(obj))}`);
    };

    // Run the top-level iteration
    let keys = Object.keys(params);
    if (sort) keys = typeof sort === "function" ? keys.sort(sort) : keys.sort();

    for (const key of keys) {
      if (strict && !isValidKey(key)) continue;
      traverse(key, params[key]);
    }

    return resultPairs.join("&");
  },
});
