import type { FormatterOptions, ILogFormatter, LoggerStandard } from "../types";
import { JsonFormatter } from "./json";
import { TextFormatter } from "./text";
import { GelfFormatter } from "./gelf";
import { SyslogFormatter } from "./syslog";
import { CefFormatter } from "./cef";
import { LeefFormatter } from "./leef";
import { W3cFormatter } from "./w3c";
import { OtlpFormatter } from "./otlp";
import { FluentdFormatter } from "./fluentd";
import { LokiFormatter } from "./loki";
import { PrettyFormatter } from "./pretty";

/**
 * Factory class responsible for instantiating the correct log formatter based on the chosen standard.
 * Caches formatter instances to optimize memory usage (Singleton pattern).
 */
export class FormatterFactory {
  private static formatters: Record<string, ILogFormatter> = {
    "JSON": new JsonFormatter(),
    "TEXT": new TextFormatter(),
    "GELF": new GelfFormatter(),
    "Syslog": new SyslogFormatter(),
    "CEF": new CefFormatter(),
    "LEEF": new LeefFormatter(),
    "W3C": new W3cFormatter(),
    "OTLP": new OtlpFormatter(),
    "Fluentd": new FluentdFormatter(),
    "Loki": new LokiFormatter(),
    "PRETTY": new PrettyFormatter()
  };

  /** Constructors, for the case where a formatter has to be configured. */
  private static constructors: Record<string, new (options?: FormatterOptions) => ILogFormatter> = {
    "JSON": JsonFormatter,
    "TEXT": TextFormatter,
    "GELF": GelfFormatter,
    "Syslog": SyslogFormatter,
    "CEF": CefFormatter,
    "LEEF": LeefFormatter,
    "W3C": W3cFormatter,
    "OTLP": OtlpFormatter,
    "Fluentd": FluentdFormatter,
    "Loki": LokiFormatter,
    "PRETTY": PrettyFormatter
  };

  /**
   * Returns the formatter for a standard, falling back to TEXT.
   *
   * Without `options` this hands back the shared instance, as it always has.
   * With them it builds a new one, because the shared instance is exactly that
   * — shared — and configuring it would reach into every other logger in the
   * process.
   *
   * @param standard The format to use. Unknown or omitted means TEXT.
   * @param options Formatter settings, such as the service name.
   */
  static get(standard?: LoggerStandard, options?: FormatterOptions): ILogFormatter {
    const key = standard && this.formatters[standard] ? standard : "TEXT";

    if (!options || Object.keys(options).length === 0) {
      return this.formatters[key];
    }

    return new this.constructors[key](options);
  }
}
