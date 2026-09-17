/* eslint-disable @typescript-eslint/no-explicit-any */
import type {
  ILogFormatter,
  ILogDelivery,
  ILogger,
  ILoggerConstructor,
  LogAdapter,
  LoggerOptions,
  LogLevel,
  LoggerStandard,
  LogRecord} from "./types";
import {
  LOG_SEVERITY
} from "./types";
import { FormatterFactory } from "./formatters/factory";
import { ConsoleDelivery } from "./deliveries/console";

abstract class AbstractLogger implements ILogger {
  constructor(protected readonly context?: string) {}

  protected abstract readonly formatter: ILogFormatter;
  protected abstract readonly deliveries: ILogDelivery[];
  protected abstract readonly enabled: boolean;
  protected abstract readonly minSeverity: number;

  protected dispatch(level: LogLevel, args: any[]) {
    /* Checked before formatting, not in a delivery: a dropped entry should
       cost nothing, and formatting it first would still run the JSON.stringify
       whose result is then thrown away. */
    if (!this.enabled || LOG_SEVERITY[level] < this.minSeverity) return;

    const record: LogRecord = { level, args, context: this.context, time: new Date() };
    const formatted = this.formatter.format(level, args, record);
    for (const delivery of this.deliveries) {
      try {
        const result = delivery.send(level, formatted, record);
        if (result instanceof Promise) {
          result.catch(err => console.error("[Logger] Async Delivery Error:", err));
        }
      } catch (err) {
        console.error("[Logger] Sync Delivery Error:", err);
      }
    }
  }

  info(...args: any[]) { this.dispatch("info", args); }
  log(...args: any[]) { this.dispatch("log", args); }
  warn(...args: any[]) { this.dispatch("warn", args); }
  error(...args: any[]) { this.dispatch("error", args); }
  debug(...args: any[]) { this.dispatch("debug", args); }
}

/**
 * Turns whatever `adapter` was given into deliveries.
 *
 * A delivery is told apart by having a `send` method; anything else is treated
 * as console-shaped and wrapped. That is what lets `adapter: console` work
 * without the caller knowing the ILogDelivery interface exists.
 */
function toDeliveries(adapter: LoggerOptions["adapter"], options: LoggerOptions): ILogDelivery[] {
  const targets = Array.isArray(adapter) ? adapter : [adapter];

  return targets.map((target) =>
    typeof (target as ILogDelivery)?.send === "function"
      ? (target as ILogDelivery)
      : new ConsoleDelivery(target as LogAdapter, { color: options.color, theme: options.theme })
  );
}

/**
 * Creates a Logger class bound to a format, an output adapter, a severity
 * threshold and an on/off switch.
 *
 * @example
 * const AppLogger = Logger({
 *   standard: "JSON",
 *   service: "sniprender",
 *   adapter: console,
 *   level: "info",
 * });
 *
 * const logger = new AppLogger();
 * logger.debug("dropped, below the threshold");
 * logger.warn("emitted");
 *
 * @example
 * // Silenced, without the call sites having to know
 * Logger({ enable: false });
 *
 * @param options Format, adapter, service name, level and enable flag.
 * @returns A class constructor implementing ILogger.
 */
export function Logger(options?: LoggerOptions): ILoggerConstructor;
/**
 * The positional form kept from 1.0.0.
 *
 * @param standard The log format standard. Defaults to "TEXT".
 * @param deliveries Transports to dispatch to. Defaults to ConsoleDelivery.
 * @returns A class constructor implementing ILogger.
 */
export function Logger(standard?: LoggerStandard, deliveries?: ILogDelivery[]): ILoggerConstructor;
export function Logger(
  arg?: LoggerOptions | LoggerStandard,
  deliveries?: ILogDelivery[]
): ILoggerConstructor {
  /* A string is the 1.0.0 signature; anything else is the options object. */
  const options: LoggerOptions = typeof arg === "string" ? { standard: arg } : { ...arg };

  const { service } = options;
  const staticFormatter = FormatterFactory.get(options.standard, service ? { service } : undefined);

  const staticDeliveries = options.adapter !== undefined
    ? toDeliveries(options.adapter, options)
    : deliveries ?? [new ConsoleDelivery(console, { color: options.color, theme: options.theme })];

  /* "debug" is the floor, so an omitted level emits everything — what 1.0.0
     did, and what a logger with no threshold configured should keep doing. */
  const staticMinSeverity = LOG_SEVERITY[options.level ?? "debug"];
  const staticEnabled = options.enable ?? true;

  return class CustomLogger extends AbstractLogger {
    protected readonly formatter = staticFormatter;
    protected readonly deliveries = staticDeliveries;
    protected readonly enabled = staticEnabled;
    protected readonly minSeverity = staticMinSeverity;
  };
}
