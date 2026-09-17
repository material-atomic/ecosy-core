import type { ILogFormatter, LogLevel } from "../types";
import { getHostname, parseArgs } from "../utils";

/**
 * Formats log messages into the W3C Extended Log Format.
 * Often used for web access logs (IIS, AWS ELB, etc.).
 */
export class W3cFormatter implements ILogFormatter {
  format(level: LogLevel, args: any[]) {
    const { summary } = parseArgs(args);
    const date = new Date();
    const dateStr = date.toISOString().split('T')[0];
    const timeStr = date.toTimeString().split(' ')[0];
    return `${dateStr} ${timeStr} ${level.toUpperCase()} ${getHostname()} - - ${JSON.stringify(summary)}`;
  }
}
