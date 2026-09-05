import { freeze } from "../utilities/freeze";
import { Primitive } from "./primitive";
import type { SerializeJSON } from "./types";

/** Safe JSON stringify/parse that never throws. */
export const Json: SerializeJSON = freeze({
  stringify: (value: unknown, space?: number) => {
    try {
      const normalized = Primitive.normalize(value);
      return JSON.stringify(normalized, null, space) ?? "";
    } catch {
      // Catch edge cases (e.g. circular references not handled by normalize)
      return "";
    }
  },
  parse: <T = unknown>(
    text: string,
    reviver?: (this: any, key: string, value: any) => any,
  ): T | null => {
    if (!text) {
      return null;
    }

    try {
      return JSON.parse(text, reviver) as T;
    } catch {
      return null; // Return null instead of throwing to keep the flow alive
    }
  },
});
