import type { FormatterOptions, ILogFormatter, LogLevel } from "../types";
import { parseArgs } from "../utils";

/**
 * Formats log messages into the Log Event Extended Format (LEEF) standard.
 * Commonly used by IBM QRadar.
 */
export class LeefFormatter implements ILogFormatter {
  constructor(private readonly options: FormatterOptions = {}) {}

  /** Identity reported for this app. Defaults to `"LoggerChain"`, what 1.0.0 emitted. */
  private get service() { return this.options.service ?? "LoggerChain"; }

  format(level: LogLevel, args: any[]) {
    const { summary } = parseArgs(args);
    return `LEEF:2.0|CoreFramework|${this.service}|1.0.0|${level.toUpperCase()}|^|cat=System^msg=${summary}^devTime=${new Date().toISOString()}`;
  }
}
