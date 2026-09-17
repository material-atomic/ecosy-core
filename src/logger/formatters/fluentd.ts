import type { FormatterOptions, ILogFormatter, LogLevel } from "../types";
import { getHostname, parseArgs } from "../utils";

/**
 * Formats log messages into the Fluentd Forward Protocol standard.
 * Outputs an array payload: `[ tag, timestamp, record ]`.
 */
export class FluentdFormatter implements ILogFormatter {
  constructor(private readonly options: FormatterOptions = {}) {}

  /** Identity reported for this app. Defaults to `"app.chain"`, what 1.0.0 emitted. */
  private get service() { return this.options.service ?? "app.chain"; }

  format(level: LogLevel, args: any[]) {
    return JSON.stringify([
      `${this.service}.${level}`,
      Math.floor(Date.now() / 1000),
      { message: parseArgs(args).summary, host: getHostname() }
    ]);
  }
}
