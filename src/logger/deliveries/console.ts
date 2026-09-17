/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ColorMode, ILogDelivery, LogAdapter, LogLevel, LogTheme } from "../types";
import { ansi, css, NestTheme, resolveColor } from "../color";
import { isPretty, type PrettyEntry } from "../formatters/pretty";

export interface ConsoleDeliveryOptions {
  /** How PRETTY entries are coloured. Defaults to `"auto"`. See {@link ColorMode}. */
  color?: ColorMode;
  /** Defaults to {@link NestTheme}. */
  theme?: LogTheme;
}

/**
 * Sends formatted entries to a console-shaped target.
 *
 * Calls the method matching the level, falling back to `log` when the target
 * has none, and spreads an array payload — which is what makes `TEXT` render
 * as if `console.log` had been called directly. A PRETTY entry is laid out as
 * a NestJS-style line, coloured for where it is going.
 *
 * Safe in both the browser and Node.
 */
export class ConsoleDelivery implements ILogDelivery {
  private readonly mode: "ansi" | "css" | "none";
  private readonly theme: LogTheme;

  /**
   * @param target Where to write. Defaults to the global `console`.
   * @param options Colour and theme for PRETTY entries.
   */
  constructor(private readonly target: LogAdapter = console, options: ConsoleDeliveryOptions = {}) {
    this.mode = resolveColor(options.color, target);
    this.theme = options.theme ?? NestTheme;
  }

  send(level: LogLevel, formattedData: any) {
    const logFn = (this.target[level] ?? this.target.log).bind(this.target) as (...data: any[]) => void;

    if (isPretty(formattedData)) {
      logFn(...this.render(formattedData));
    } else if (Array.isArray(formattedData)) {
      logFn(...formattedData);
    } else {
      logFn(formattedData);
    }
  }

  /**
   * One line of text, then whatever was logged that is not text — objects and
   * Errors go to the console as they are, so it can inspect them and print a
   * stack, instead of flattening them into the line.
   *
   * The line is the console's format string, so a `%` in it would be read as
   * a specifier: `"50%s done"` logged with an object would print the object in
   * the middle. It is escaped to `%%` whenever arguments follow — which is the
   * only time the console unescapes it.
   */
  private render(e: PrettyEntry): any[] {
    const isText = (a: unknown) => typeof a === "string" || typeof a === "number" || typeof a === "boolean";
    const text = e.message.filter(isText).map(String).join(" ");
    const rest = e.message.filter((a) => !isText(a));

    const t = this.theme;
    const parts = {
      app: `[${e.app}]${e.pid === null ? "" : ` ${e.pid}`}  - `,
      time: `${e.time}  `,
      level: `${e.level.toUpperCase().padStart(5)} `,
      context: e.context ? `[${e.context}] ` : "",
      text,
      delta: e.delta === null ? "" : ` +${e.delta}ms`,
    };

    if (this.mode === "css") {
      const esc = (s: string) => s.replace(/%/g, "%%");
      const segs: [string, string][] = [
        [parts.app, css(t.app)], [parts.time, css(t.time)], [parts.level, css(t.levels[e.level])],
        [parts.context, css(t.context)], [parts.text, css(t.levels[e.level])], [parts.delta, css(t.delta)],
      ];
      const used = segs.filter(([s]) => s);
      return [used.map(([s]) => `%c${esc(s)}`).join(""), ...used.map(([, style]) => style), ...rest];
    }

    const paint = this.mode === "ansi" ? ansi : (s: string) => s;
    const line =
      paint(parts.app, t.app) + paint(parts.time, t.time) + paint(parts.level, t.levels[e.level]) +
      (parts.context ? paint(parts.context, t.context) : "") + paint(parts.text, t.levels[e.level]) +
      (parts.delta ? paint(parts.delta, t.delta) : "");
    return [rest.length ? line.replace(/%/g, "%%") : line, ...rest];
  }
}
