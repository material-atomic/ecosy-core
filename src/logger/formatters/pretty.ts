/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FormatterOptions, ILogFormatter, LogLevel, LogRecord } from "../types";

/** Marks a payload as a PRETTY entry, so a console delivery knows to lay it out. */
export const PRETTY = Symbol.for("@ecosy/logger:pretty");

/**
 * A PRETTY entry: the parts of a NestJS-style line, not yet rendered.
 *
 * Parts rather than a string because how a line is coloured depends on where
 * it goes — ANSI in a terminal, `%c` arguments in a browser console, nothing
 * in a file — and the formatter cannot know that; the delivery does.
 */
export interface PrettyEntry {
  readonly [PRETTY]: true;
  app: string;
  pid: number | null;
  time: string;
  level: LogLevel;
  context?: string;
  /** The arguments as logged. Objects and Errors are kept as they are, for the console to inspect. */
  message: any[];
  /** Milliseconds since the previous PRETTY entry in this process, or null for the first. */
  delta: number | null;
}

let lastAt: number | null = null;

/**
 * `[App] 12345  - 09/11/2026, 10:04:05 AM     LOG [Router] Mapped /users +3ms`
 *
 * For people reading a terminal. For a collector, pick a structured standard —
 * and a logger can do both: PRETTY to the console, GELF to Graylog.
 */
export class PrettyFormatter implements ILogFormatter {
  constructor(private readonly options: FormatterOptions = {}) {}

  format(level: LogLevel, args: any[], record?: LogRecord): PrettyEntry {
    const now = record?.time ?? new Date();
    const at = now.getTime();
    const delta = lastAt === null ? null : at - lastAt;
    lastAt = at;

    return {
      [PRETTY]: true,
      app: this.options.service ?? "App",
      pid: typeof process !== "undefined" && typeof process.pid === "number" ? process.pid : null,
      time: now.toLocaleString("en-US", {
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true,
      }),
      level,
      context: record?.context,
      message: args,
      delta,
    };
  }
}

export const isPretty = (data: unknown): data is PrettyEntry =>
  typeof data === "object" && data !== null && (data as any)[PRETTY] === true;
