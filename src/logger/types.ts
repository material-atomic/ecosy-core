/**
 * Represents the severity level of a log entry.
 */
export type LogLevel = "info" | "log" | "warn" | "error" | "debug";

/**
 * Standard log formats supported by the logger factory.
 * Includes generic formats (JSON, TEXT) and specialized telemetry standards.
 */
export type LoggerStandard = "GELF" | "JSON" | "Syslog" | "CEF" | "LEEF" | "W3C" | "OTLP" | "Fluentd" | "Loki" | "TEXT" | "PRETTY" | (string & {});

/**
 * One entry as it was logged, before any formatting.
 *
 * Handed to every delivery beside the formatted payload. A logger has one
 * formatter and may have several deliveries, and they need not want the same
 * format: a terminal wants PRETTY, Graylog wants GELF. A delivery that speaks
 * a format of its own builds it from this instead of taking the logger's.
 */
export interface LogRecord {
  level: LogLevel;
  args: any[];
  /** The name given to `new AppLogger("Router")`, if any. */
  context?: string;
  time: Date;
}

/**
 * Strategy interface for formatting raw log arguments into a specific standard.
 */
export interface ILogFormatter {
  /**
   * Formats the log arguments according to the standard.
   * @param level The severity level of the log.
   * @param args The raw arguments passed to the logger.
   * @returns The formatted payload (can be a string, object, or array).
   */
  format(level: LogLevel, args: any[], record?: LogRecord): any;
}

/**
 * Strategy interface for delivering formatted log payloads to a destination.
 */
export interface ILogDelivery {
  /**
   * Sends the formatted log data to the designated transport layer (e.g. Console, HTTP, File).
   * @param level The severity level of the log.
   * @param formattedData The payload formatted by an ILogFormatter.
   */
  send(level: LogLevel, formattedData: any, record?: LogRecord): void | Promise<void>;
}

/**
 * The primary logging interface used by applications.
 */
export interface ILogger {
  info(...args: any[]): void;
  log(...args: any[]): void;
  warn(...args: any[]): void;
  error(...args: any[]): void;
  debug(...args: any[]): void;
}

/**
 * Severity order, lowest first. `log` and `info` sit at the same height: every
 * standard here treats them as one severity, and they differ only in which
 * console method receives them.
 */
export const LOG_SEVERITY: Record<LogLevel, number> = {
  debug: 10,
  log: 20,
  info: 20,
  warn: 30,
  error: 40,
};

/**
 * Settings a formatter reads. Each field falls back to what the formatter
 * emitted before it was configurable, so an existing setup is unaffected.
 */
export interface FormatterOptions {
  /**
   * The name this application reports itself as — Loki's `component`, OTLP's
   * `service.name`, Syslog's APP-NAME, the product field in CEF and LEEF.
   */
  service?: string;
}

/**
 * Anything console-shaped. The global `console` satisfies it, and so does a
 * test double that records what it was given.
 *
 * Only `log` is required: a target without a method for some level falls back
 * to `log`, which is how a minimal sink stays usable.
 */
export interface LogAdapter {
  log(...args: any[]): void;
  info?(...args: any[]): void;
  warn?(...args: any[]): void;
  error?(...args: any[]): void;
  debug?(...args: any[]): void;
}

/**
 * Settings for {@link Logger}.
 */
export interface LoggerOptions extends FormatterOptions {
  /** Output format. Defaults to `"TEXT"`. */
  standard?: LoggerStandard;
  /**
   * Where entries go. Defaults to `console`.
   *
   * Takes a console-shaped object, an {@link ILogDelivery}, or an array mixing
   * the two — a delivery is recognised by having a `send` method.
   */
  adapter?: LogAdapter | ILogDelivery | (LogAdapter | ILogDelivery)[];
  /**
   * Lowest severity to emit; anything below it is dropped **before** being
   * formatted. Defaults to `"debug"`, which emits everything.
   */
  level?: LogLevel;
  /**
   * Set `false` to silence the logger entirely — for a test run, or a build
   * where logging is switched off by configuration. Defaults to `true`.
   */
  enable?: boolean;
  /**
   * Colour for the console deliveries this logger builds from `adapter` (or
   * the default one). Only PRETTY entries are coloured. See {@link ColorMode}.
   */
  color?: ColorMode;
  /** Colours to use. Defaults to {@link NestTheme}. */
  theme?: LogTheme;
}

/**
 * - `"auto"` (default): ANSI when writing to a TTY through the global console,
 *   `%c` CSS in a browser console, plain otherwise — a file, a pipe, a CI log,
 *   a custom adapter. `NO_COLOR` turns it off; `FORCE_COLOR` turns it on for
 *   the global console only, never for a custom adapter.
 * - `"ansi"`, `"css"`, `"none"`: that, regardless of where it goes.
 * - `true` / `false`: `"auto"` / `"none"`.
 */
export type ColorMode = "auto" | "ansi" | "css" | "none" | boolean;

/** The colours a theme may use — the eight every terminal has, plus gray and bold. */
export type ColorName = "black" | "red" | "green" | "yellow" | "blue" | "magenta" | "cyan" | "white" | "gray" | "bold";

/**
 * Which colour each part of a PRETTY line takes. Data, not behaviour: the same
 * theme renders as ANSI in a terminal and as CSS in a browser.
 */
export interface LogTheme {
  /** `[App]` and the PID. */
  app: ColorName | ColorName[];
  time: ColorName | ColorName[];
  /** `[Context]`. */
  context: ColorName | ColorName[];
  /** `+12ms`. */
  delta: ColorName | ColorName[];
  /** The level label and the message text, per level. */
  levels: Record<LogLevel, ColorName | ColorName[]>;
}

/**
 * Constructor interface for creating new Logger instances.
 */
export interface ILoggerConstructor {
  /**
   * @param context Shown as `[Context]` by PRETTY and sent as `_context` in
   * GELF. Optional, so an injector that constructs with no arguments still can.
   */
  new (context?: string): ILogger;
}
