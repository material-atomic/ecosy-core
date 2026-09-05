const isServer = () => typeof window === "undefined";

// ─── ANSI colors (server / Node.js) ───────────────────────
const ansi = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
};

// ─── CSS styles (browser / DevTools) ──────────────────────
const css = {
  LOG: "color:#22c55e;font-weight:bold",
  WARN: "color:#eab308;font-weight:bold",
  ERROR: "color:#ef4444;font-weight:bold",
  DEBUG: "color:#a855f7;font-weight:bold",
  VERBOSE: "color:#06b6d4;font-weight:bold",
} as const;

const cssReset = "color:inherit;font-weight:normal";
const cssContext = "color:#eab308;font-weight:normal";
const cssTimestamp = "color:#9ca3af;font-weight:normal";
const cssMessage: Record<LogLevel, string> = {
  LOG: "color:#22c55e",
  WARN: "color:#eab308",
  ERROR: "color:#ef4444",
  DEBUG: "color:#a855f7",
  VERBOSE: "color:#06b6d4",
};

function timestamp(): string {
  const now = new Date();
  return now.toLocaleString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

function pid(): number {
  if (isServer() && typeof process !== "undefined") return process.pid;
  return 0;
}

/** Log severity level. */
export type LogLevel = "LOG" | "WARN" | "ERROR" | "DEBUG" | "VERBOSE";

/** A buffered log entry stored in the shared global log buffer. */
export interface LogEntry {
  /** Unix timestamp in milliseconds. */
  timestamp: number;
  /** Severity level of the log entry. */
  level: LogLevel;
  /** Logger context name (e.g. module or class name). */
  context: string;
  /** The logged message. */
  message: string;
}

const levelAnsi: Record<LogLevel, string> = {
  LOG: ansi.green,
  WARN: ansi.yellow,
  ERROR: ansi.red,
  DEBUG: ansi.magenta,
  VERBOSE: ansi.cyan,
};

const MAX_LOG_BUFFER = 200;

// Use globalThis to share log buffer across all module bundles
const LOG_KEY = Symbol.for("@ecosy:logger");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;
if (!g[LOG_KEY]) {
  g[LOG_KEY] = { buffer: [] as LogEntry[], errors: 0, warns: 0, total: 0 };
}

const shared: { buffer: LogEntry[]; errors: number; warns: number; total: number } = g[LOG_KEY];

/**
 * Syhemo's built-in logging stack: colour-coded output plus the shared buffer
 * and counters the monitor reads.
 *
 * This is NOT a general-purpose logger, and it is not re-exported from the
 * package index — reach for `@ecosy/logger` for formatters, deliveries and
 * telemetry standards. What lives here exists so that {@link Syhemo} works out
 * of the box: it is one concrete implementation of the `SyhemoLogger` and
 * `SyhemoLogSource` ports, and Syhemo accepts any other.
 *
 * An app that wants its own logs to appear in monitoring snapshots has to
 * write them through something that fills the same buffer — either this class,
 * or its own implementation of `SyhemoLogSource` handed to Syhemo.
 *
 * - **Server (Node.js)**: ANSI escape codes for terminal colour.
 * - **Browser**: `%c` CSS formatting for DevTools.
 *
 * @example
 * ```ts
 * const logger = new BufferedLogger("MyModule");
 * logger.log("Server started on port 3000");
 * logger.warn("Deprecated API used");
 * logger.error("Connection failed", error);
 * logger.debug("Payload:", data);
 * ```
 */
export class BufferedLogger {
  /**
   * @param context - Label shown in log output, e.g. `[MyModule]`.
   *                  Defaults to `"@ecosy"`.
   */
  constructor(private readonly context: string = "@ecosy") {}

  private format(level: LogLevel, message: string, ...args: unknown[]): void {
    const fn = level === "ERROR" ? console.error : level === "WARN" ? console.warn : console.log;

    // Buffer log entry for Syhemo monitor (globalThis-backed)
    shared.buffer.push({
      timestamp: Date.now(),
      level,
      context: this.context,
      message,
    });
    if (shared.buffer.length > MAX_LOG_BUFFER) {
      shared.buffer.shift();
    }

    // Track counts
    shared.total++;
    if (level === "ERROR") shared.errors++;
    if (level === "WARN") shared.warns++;

    if (isServer()) {
      this.formatServer(fn, level, message, ...args);
    } else {
      this.formatBrowser(fn, level, message, ...args);
    }
  }

  private formatServer(
    fn: (...a: unknown[]) => void,
    level: LogLevel,
    message: string,
    ...args: unknown[]
  ): void {
    const color = levelAnsi[level];
    const ts = `${ansi.white}${timestamp()}${ansi.reset}`;
    const lv = `${color}${ansi.bold}${level.padEnd(7)}${ansi.reset}`;
    const pidStr = `${ansi.yellow}${pid()}${ansi.reset}`;
    const ctx = `${ansi.yellow}[${this.context}]${ansi.reset}`;
    const msg = `${color}${message}${ansi.reset}`;

    fn(`${lv} ${pidStr}  - ${ts}     ${ctx} ${msg}`, ...args);
  }

  private formatBrowser(
    fn: (...a: unknown[]) => void,
    level: LogLevel,
    message: string,
    ...args: unknown[]
  ): void {
    const template = `%c${level.padEnd(7)}%c  - %c${timestamp()}%c     %c[${this.context}]%c %c${message}`;
    fn(
      template,
      css[level],
      cssReset,
      cssTimestamp,
      cssReset,
      cssContext,
      cssReset,
      cssMessage[level],
      ...args,
    );
  }

  /** Log a message at the `LOG` level (green). */
  log(message: string, ...args: unknown[]): void {
    this.format("LOG", message, ...args);
  }

  /** Log a message at the `WARN` level (yellow). */
  warn(message: string, ...args: unknown[]): void {
    this.format("WARN", message, ...args);
  }

  /** Log a message at the `ERROR` level (red). */
  error(message: string, ...args: unknown[]): void {
    this.format("ERROR", message, ...args);
  }

  /** Log a message at the `DEBUG` level (magenta). */
  debug(message: string, ...args: unknown[]): void {
    this.format("DEBUG", message, ...args);
  }

  /** Log a message at the `VERBOSE` level (cyan). */
  verbose(message: string, ...args: unknown[]): void {
    this.format("VERBOSE", message, ...args);
  }

  // ─── Log source port (see SyhemoLogSource in ./syhemo) ───

  /**
   * Returns a shallow copy of all buffered log entries (non-destructive).
   * Satisfies the `getLogs` half of Syhemo's log source port.
   */
  static getLogs(): LogEntry[] {
    return [...shared.buffer];
  }

  /**
   * Running totals since the process started.
   *
   * Non-destructive on purpose: these become Prometheus counters, and a
   * counter that resets when it is read cannot be shared by two consumers and
   * cannot produce a correct rate. The scraper takes the difference between
   * two reads; that is its job, not this one's.
   */
  static counts(): { errors: number; warns: number; total: number } {
    return {
      errors: shared.errors,
      warns: shared.warns,
      total: shared.total,
    };
  }
}
