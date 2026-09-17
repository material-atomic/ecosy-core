import type { ILogFormatter, LogLevel } from "../types";
import { getHostname } from "../utils";

/**
 * Formats log messages into a structured JSON string.
 * Includes level, timestamp, host, and raw data.
 */
export class JsonFormatter implements ILogFormatter {
  format(level: LogLevel, args: any[]) {
    return JSON.stringify({ level, timestamp: Date.now(), host: getHostname(), data: args });
  }
}
