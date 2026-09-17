/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ColorMode, ColorName, LogAdapter, LogTheme } from "./types";

/**
 * The colours NestJS's ConsoleLogger uses: the app and PID green, the context
 * and the time delta yellow, the level and its message in the level's colour.
 */
export const NestTheme: LogTheme = {
  app: "green",
  time: "white",
  context: "yellow",
  delta: "yellow",
  levels: {
    log: "green",
    info: "green",
    warn: "yellow",
    error: "red",
    debug: "magenta",
  },
};

const ANSI: Record<ColorName, string> = {
  black: "\x1b[30m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m",
  blue: "\x1b[34m", magenta: "\x1b[35m", cyan: "\x1b[36m", white: "\x1b[37m",
  gray: "\x1b[90m", bold: "\x1b[1m",
};
const ANSI_RESET = "\x1b[0m";

const CSS: Record<ColorName, string> = {
  black: "color:#111827", red: "color:#ef4444", green: "color:#22c55e", yellow: "color:#eab308",
  blue: "color:#3b82f6", magenta: "color:#a855f7", cyan: "color:#06b6d4", white: "color:inherit",
  gray: "color:#9ca3af", bold: "font-weight:bold",
};

const list = (c: ColorName | ColorName[]) => (Array.isArray(c) ? c : [c]);

/** ANSI-wrap `text` in the theme colour. */
export const ansi = (text: string, color: ColorName | ColorName[]) =>
  `${list(color).map((c) => ANSI[c]).join("")}${text}${ANSI_RESET}`;

/** The CSS declaration for a theme colour, for a `%c` segment. */
export const css = (color: ColorName | ColorName[]) => list(color).map((c) => CSS[c]).join(";");

/**
 * Decides what a console delivery actually does with colour.
 *
 * "auto" colours only where colour is known to render and to be wanted: the
 * global console, in a browser (CSS) or on a terminal (ANSI). A custom adapter
 * is taken at its word as something else — a file, a test double, a buffer —
 * where escape codes are noise. NO_COLOR turns colour off anywhere; FORCE_COLOR
 * turns it on for the global console when it is not a TTY (no-color.org).
 */
export function resolveColor(mode: ColorMode | undefined, target: LogAdapter): "ansi" | "css" | "none" {
  if (mode === false || mode === "none") return "none";
  if (mode === "ansi" || mode === "css") return mode;

  const env: Record<string, string | undefined> =
    typeof process !== "undefined" && process.env ? process.env : {};
  if (env.NO_COLOR) return "none";

  /* A custom adapter is a file, a buffer, a test double — never coloured by
     "auto", FORCE_COLOR included. FORCE_COLOR answers "is this a terminal?"
     for the global console; it is set wholesale in CI, and read as licence to
     colour everything it would put escape codes into log files. Colour for a
     custom adapter is asked for by name: color: "ansi". */
  if (target !== (globalThis as any).console) return "none";

  const browser = typeof window !== "undefined" && typeof document !== "undefined";
  if (browser) return "css";
  if (env.FORCE_COLOR && env.FORCE_COLOR !== "0") return "ansi";

  const stdout: any = typeof process !== "undefined" ? (process as any).stdout : undefined;
  return stdout?.isTTY ? "ansi" : "none";
}
