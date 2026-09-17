import type { FormatterOptions, ILogFormatter, LogLevel, LogRecord } from "../types";
import { getHostname, parseArgs } from "../utils";

/**
 * Formats log messages into the Graylog Extended Log Format (GELF) v1.1.
 * Ideal for sending structured logs to Graylog or Logstash.
 */
export class GelfFormatter implements ILogFormatter {
  constructor(private readonly options: FormatterOptions = {}) {}

  /** Identity reported for this app. Defaults to `"logger-core"`, what 1.0.0 emitted. */
  private get service() { return this.options.service ?? "logger-core"; }

  private mapLevel(level: LogLevel): number {
    const mapping: Record<LogLevel, number> = { error: 3, warn: 4, info: 6, log: 6, debug: 7 };
    return mapping[level];
  }
  format(level: LogLevel, args: any[], record?: LogRecord) {
    const { summary, full } = parseArgs(args);
    return JSON.stringify({
      version: "1.1",
      host: getHostname(),
      short_message: summary,
      full_message: full,
      timestamp: (record?.time.getTime() ?? Date.now()) / 1000,
      level: this.mapLevel(level),
      _framework_chain: this.service,
      /* GELF's additional fields are underscore-prefixed; undefined drops out
         of JSON.stringify, so a logger without a context sends none. */
      _context: record?.context,
    });
  }
}
