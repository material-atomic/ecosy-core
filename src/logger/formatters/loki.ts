import type { FormatterOptions, ILogFormatter, LogLevel } from "../types";
import { getHostname, parseArgs } from "../utils";

/**
 * Formats log messages into the Grafana Loki JSON Stream format.
 * Groups log streams with nanosecond timestamps.
 */
export class LokiFormatter implements ILogFormatter {
  constructor(private readonly options: FormatterOptions = {}) {}

  /** Identity reported for this app. Defaults to `"core-image"`, what 1.0.0 emitted. */
  private get service() { return this.options.service ?? "core-image"; }

  format(level: LogLevel, args: any[]) {
    const { summary } = parseArgs(args);
    return JSON.stringify({
      streams: [
        {
          stream: { level: level, host: getHostname(), component: this.service },
          values: [
            [(Date.now() * 1000000).toString(), summary]
          ]
        }
      ]
    });
  }
}
