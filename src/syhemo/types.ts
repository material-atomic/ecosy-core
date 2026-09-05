/**
 * Every shape Syhemo produces or consumes.
 *
 * The metric model below follows Prometheus, so a project that wants a
 * `/metrics` endpoint only has to return what Syhemo already produces — no
 * client library, no registry, no push gateway. That constrains three things
 * which are easy to get wrong and expensive to fix later:
 *
 *  - **Base units.** Bytes, seconds, and ratios between 0 and 1. Never MB, ms
 *    or percentages: a query that has to know which unit a metric used is a
 *    query that will eventually be wrong.
 *  - **Counters are monotonic.** `counter` *means* never-decreasing; a scraper
 *    computes rates from the difference between two scrapes. A value that
 *    resets itself is a gauge wearing a counter's name, and the dashboards it
 *    produces look plausible while being wrong.
 *  - **Full precision.** Values are not rounded here. Rounding is a display
 *    decision, and doing it at the source cannot be undone.
 */

import type { LogEntry, LogLevel } from "./logger";

// Re-exported so an implementation of the ports below does not have to reach
// into the built-in stack for the shapes it must produce.
export type { LogEntry, LogLevel };

// ─── Metric model ────────────────────────────────────────────

/**
 * `counter` only ever grows. `gauge` moves in both directions. `histogram`
 * carries cumulative buckets plus a sum and a count.
 *
 * Summaries are deliberately absent: their quantiles cannot be aggregated
 * across instances, which is the whole reason histograms exist.
 */
export type MetricType = "counter" | "gauge" | "histogram";

export type MetricLabels = Record<string, string>;

/** One cumulative bucket: how many observations were `<= le`. */
export interface HistogramBucket {
  /** Upper bound, inclusive. `Infinity` renders as `+Inf`. */
  le: number;
  count: number;
}

interface MetricBase {
  /** `<namespace>_<subsystem>_<name>_<unit>`, e.g. `process_resident_memory_bytes`. */
  name: string;
  help: string;
  labels?: MetricLabels;
}

export interface ScalarMetric extends MetricBase {
  type: "counter" | "gauge";
  value: number;
}

export interface HistogramMetric extends MetricBase {
  type: "histogram";
  /** Cumulative: each bucket counts everything at or below its bound. */
  buckets: HistogramBucket[];
  sum: number;
  count: number;
}

export type Metric = ScalarMetric | HistogramMetric;

/** One collection pass. */
export interface MetricsSnapshot {
  /** Unix milliseconds. */
  timestamp: number;
  metrics: Metric[];
}

// ─── State ───────────────────────────────────────────────────

export interface SyhemoState {
  current: MetricsSnapshot | null;
  snapshots: MetricsSnapshot[];
  logs: LogEntry[];
  started: boolean;
}

// ─── Logging ports ───────────────────────────────────────────

/** Monotonic log totals since the process started. */
export interface LogCounts {
  errors: number;
  warns: number;
  total: number;
}

/**
 * Where Syhemo writes its own diagnostics.
 *
 * Structurally an `ILogger`, so `@ecosy/logger` — or a bare `console` — is
 * already one. Declared here rather than imported because it is the port the
 * monitor needs, which is what keeps this package free of any dependency on a
 * logging library.
 */
export interface SyhemoLogger {
  log(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * Where Syhemo reads log activity from.
 *
 * A logging library does not normally provide this — writing logs and being
 * able to count them are different jobs — which is why it is a separate port.
 * `BufferedLogger` implements both; pairing `@ecosy/logger` with monitoring
 * means giving it a delivery that fills something shaped like this.
 */
export interface SyhemoLogSource {
  /** Recent entries. Non-destructive. */
  getLogs(): LogEntry[];
  /**
   * Running totals since the process started.
   *
   * Must be monotonic and non-destructive: these become counters, and a
   * counter that resets when it is read cannot be shared by two consumers and
   * cannot produce a correct rate.
   */
  counts(): LogCounts;
}

export interface SyhemoOptions {
  interval?: number;
  db?: () => boolean;
}

export interface SyhemoDeps {
  /** Defaults to the built-in `BufferedLogger`. */
  logger?: SyhemoLogger;
  /** Defaults to the built-in buffer behind `BufferedLogger`. */
  source?: SyhemoLogSource;
}
