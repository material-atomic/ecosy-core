import type { FormatterOptions, ILogFormatter, LogLevel } from "../types";
import { parseArgs } from "../utils";

/**
 * Formats log messages into the Common Event Format (CEF) standard.
 * Often used by ArcSight and other SIEM solutions.
 */
export class CefFormatter implements ILogFormatter {
  constructor(private readonly options: FormatterOptions = {}) {}

  /** Identity reported for this app. Defaults to `"LoggerChain"`, what 1.0.0 emitted. */
  private get service() { return this.options.service ?? "LoggerChain"; }

  format(level: LogLevel, args: any[]) {
    const { summary } = parseArgs(args);
    const severityMap: Record<LogLevel, string> = { error: "10", warn: "5", info: "3", log: "3", debug: "1" };
    return `CEF:0|CoreFramework|${this.service}|1.0.0|LOG:${level.toUpperCase()}|${summary}|${severityMap[level]}|msg=${summary}`;
  }
}
