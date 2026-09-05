/**
 * Syhemo: in-process runtime monitoring.
 *
 * Node-only, and not re-exported from the package index — reach it by
 * subpath: `import { Syhemo } from "@ecosy/core/syhemo"`.
 *
 * Metrics follow the Prometheus model, so exposing them is a two-line route
 * with no client library involved:
 *
 * ```ts
 * export function GET() {
 *   return new Response(monitor.metrics(), {
 *     headers: { "Content-Type": CONTENT_TYPE },
 *   });
 * }
 * ```
 *
 * Collection runs on this class's own timer, never on a scrape, which is what
 * makes that route safe to call from more than one scraper: reading never
 * mutates a counter.
 */

import { Subscriber } from "../subscriber";
import { freeze } from "../utilities/freeze";
import { BufferedLogger } from "./logger";
import { collectMetrics, setDbChecker } from "./collectors";
import { render } from "./exposition";
import type {
  Metric, MetricsSnapshot, SyhemoDeps, SyhemoLogger, SyhemoLogSource, SyhemoOptions, SyhemoState,
} from "./types";

export * from "./types";
export { recordHttpRequest } from "./collectors";
export { render, CONTENT_TYPE } from "./exposition";

const syhemoEvents = freeze({
  metrics: {
    snapshot: "syhemo:metrics:snapshot",
  },
} as const);

type SyhemoEvents = typeof syhemoEvents;

const MAX_SNAPSHOTS = 60;

export class Syhemo extends Subscriber<SyhemoState, SyhemoEvents> {
  private timer: ReturnType<typeof setInterval> | null = null;

  private readonly logger: SyhemoLogger;
  private readonly source: SyhemoLogSource;

  constructor(deps: SyhemoDeps = {}) {
    super({ current: null, snapshots: [], logs: [], started: false }, syhemoEvents);

    // The built-in stack is a default, not a decision: pass either port to
    // replace it. They are separate because a logging library supplies the
    // sink and rarely the source.
    this.logger = deps.logger ?? new BufferedLogger("Syhemo");
    // The buffer and counters behind BufferedLogger are static and shared via
    // globalThis, so the class object itself is the source.
    this.source = deps.source ?? BufferedLogger;
  }

  start(options: SyhemoOptions = {}) {
    if (this.getState().started) return;

    const { interval = 5000, db } = options;

    if (db) setDbChecker(db);

    this.setState({ started: true });
    this.collect();

    this.timer = setInterval(() => this.collect(), interval);
    this.logger.log(`Started (interval: ${interval}ms)`);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.setState({ started: false });
    this.logger.log("Stopped");
  }

  /** The most recent collection, or an empty list before the first one. */
  getMetrics(): Metric[] {
    return this.getState().current?.metrics ?? [];
  }

  /**
   * The most recent collection in Prometheus text exposition format.
   *
   * Serve it with `CONTENT_TYPE`. Returns an empty string before the first
   * collection, which a scraper reads as "no metrics" rather than an error.
   */
  metrics(): string {
    return render(this.getMetrics());
  }

  private collect() {
    try {
      const snapshot: MetricsSnapshot = {
        timestamp: Date.now(),
        metrics: collectMetrics(this.source),
      };

      const prev = this.getState().snapshots;
      const snapshots =
        prev.length >= MAX_SNAPSHOTS ? [...prev.slice(1), snapshot] : [...prev, snapshot];

      this.setState({ current: snapshot, snapshots, logs: this.source.getLogs() });
      this.dispatch(syhemoEvents.metrics.snapshot, snapshot);
    } catch (e) {
      this.logger.error(`Collection failed: ${e}`);
    }
  }
}
