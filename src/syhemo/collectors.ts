/**
 * Where every number comes from.
 *
 * All of it is Node stdlib — perf_hooks, v8, os, process — plus two things the
 * host feeds in: `recordHttpRequest` for traffic, and the `db` callback given
 * to `Syhemo.start()`. Nothing here knows what framework is running above it.
 *
 * Two rules hold throughout, both from the Prometheus model:
 *
 *  - Values are in base units and are not rounded.
 *  - Anything typed `counter` only ever grows. Collection runs on Syhemo's own
 *    interval, so a scrape never mutates state and two scrapers never steal
 *    each other's numbers.
 */

import { monitorEventLoopDelay } from "node:perf_hooks";
import * as v8 from "v8";
import * as os from "os";
import type { HistogramBucket, Metric, SyhemoLogSource } from "./types";

const NS_PER_SECOND = 1e9;
const MS_PER_SECOND = 1e3;

// ─── Memory ──────────────────────────────────────────────────

function collectMemory(): Metric[] {
  const mem = process.memoryUsage();

  return [
    {
      name: "process_resident_memory_bytes",
      type: "gauge",
      help: "Resident set size in bytes.",
      value: mem.rss,
    },
    {
      name: "nodejs_external_memory_bytes",
      type: "gauge",
      help: "Memory used by C++ objects bound to JavaScript, in bytes.",
      value: mem.external,
    },
    {
      name: "nodejs_array_buffers_bytes",
      type: "gauge",
      help: "Memory allocated for ArrayBuffers and SharedArrayBuffers, in bytes.",
      value: mem.arrayBuffers,
    },
  ];
}

// ─── CPU ─────────────────────────────────────────────────────

let prevCpuUsage: os.CpuInfo[] | null = null;

function collectCpu(): Metric[] {
  const cpus = os.cpus();
  let usage = 0;

  if (prevCpuUsage && prevCpuUsage.length === cpus.length) {
    let totalDelta = 0;
    let idleDelta = 0;

    for (let i = 0; i < cpus.length; i++) {
      const prev = prevCpuUsage[i].times;
      const curr = cpus[i].times;
      const prevTotal = prev.user + prev.nice + prev.sys + prev.idle + prev.irq;
      const currTotal = curr.user + curr.nice + curr.sys + curr.idle + curr.irq;
      totalDelta += currTotal - prevTotal;
      idleDelta += curr.idle - prev.idle;
    }

    usage = totalDelta > 0 ? 1 - idleDelta / totalDelta : 0;
  }

  prevCpuUsage = cpus;

  return [
    {
      name: "process_cpu_usage_ratio",
      type: "gauge",
      help: "Share of CPU time spent non-idle since the previous collection, 0 to 1.",
      value: usage,
    },
    {
      name: "nodejs_cpu_count",
      type: "gauge",
      help: "Number of logical CPUs.",
      value: cpus.length,
    },
    {
      // The Prometheus idiom for metadata: a constant 1 carrying labels, so the
      // model stays out of the metric name where it would be unqueryable.
      name: "nodejs_cpu_info",
      type: "gauge",
      help: "CPU model, always 1.",
      labels: { model: cpus[0]?.model ?? "unknown" },
      value: 1,
    },
  ];
}

// ─── V8 heap ─────────────────────────────────────────────────

function collectHeap(): Metric[] {
  const stats = v8.getHeapStatistics();

  return [
    {
      name: "nodejs_heap_size_total_bytes",
      type: "gauge",
      help: "Total V8 heap size in bytes.",
      value: stats.total_heap_size,
    },
    {
      name: "nodejs_heap_size_used_bytes",
      type: "gauge",
      help: "Used V8 heap size in bytes.",
      value: stats.used_heap_size,
    },
    {
      name: "nodejs_heap_size_limit_bytes",
      type: "gauge",
      help: "Ceiling V8 will grow the heap to, in bytes.",
      value: stats.heap_size_limit,
    },
    {
      name: "nodejs_malloced_memory_bytes",
      type: "gauge",
      help: "Memory malloc'd by V8, in bytes.",
      value: stats.malloced_memory,
    },
    {
      name: "nodejs_native_contexts",
      type: "gauge",
      help: "Live top-level contexts. A number that only grows indicates a leak.",
      value: stats.number_of_native_contexts,
    },
    {
      name: "nodejs_detached_contexts",
      type: "gauge",
      help: "Contexts detached but not yet garbage collected.",
      value: stats.number_of_detached_contexts,
    },
  ];
}

// ─── Handles ─────────────────────────────────────────────────

function collectHandles(): Metric[] {
  // @ts-expect-error _getActiveHandles is internal Node API
  const handles: unknown[] = process._getActiveHandles?.() ?? [];
  // @ts-expect-error _getActiveRequests is internal Node API
  const requests: unknown[] = process._getActiveRequests?.() ?? [];

  let timers = 0;
  let sockets = 0;

  for (const handle of handles) {
    const name = (handle as { constructor?: { name?: string } })?.constructor?.name ?? "";
    if (name === "Timeout" || name === "Timer" || name === "Immediate") timers++;
    else if (name === "Socket" || name === "TCP" || name === "TLSSocket") sockets++;
  }

  const other = handles.length - timers - sockets;

  // One name, three series. Splitting by label rather than by name is what lets
  // a query sum them or break them down without knowing the categories.
  return [
    { name: "nodejs_active_handles", type: "gauge", help: "Active libuv handles by kind.", labels: { kind: "timer" }, value: timers },
    { name: "nodejs_active_handles", type: "gauge", help: "Active libuv handles by kind.", labels: { kind: "socket" }, value: sockets },
    { name: "nodejs_active_handles", type: "gauge", help: "Active libuv handles by kind.", labels: { kind: "other" }, value: other },
    {
      name: "nodejs_active_requests_total",
      type: "gauge",
      help: "Active libuv requests.",
      value: requests.length,
    },
  ];
}

// ─── Module cache ────────────────────────────────────────────

const TOP_MODULE_GROUPS = 20;

function collectModules(): Metric[] {
  try {
    // Avoid `require.cache` keyword entirely — Turbopack panics on CjsRequireCacheAccess
    const cache: Record<string, unknown> =
      eval("typeof require !== 'undefined' && require.cache") || {};
    const keys = Object.keys(cache);

    const groups = new Map<string, number>();
    for (const key of keys) {
      const match = key.match(/node_modules\/([^/]+)/);
      const group = match ? `node_modules/${match[1]}` : key.replace(process.cwd(), ".");
      groups.set(group, (groups.get(group) ?? 0) + 1);
    }

    // Capped: a label whose value set grows without bound is how a Prometheus
    // server runs out of memory.
    const top = Array.from(groups.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_MODULE_GROUPS);

    return [
      {
        name: "nodejs_module_cache_entries",
        type: "gauge",
        help: "Entries in the CommonJS module cache.",
        value: keys.length,
      },
      ...top.map(
        ([group, count]): Metric => ({
          name: "nodejs_module_cache_entries_by_group",
          type: "gauge",
          help: `Module cache entries per group, top ${TOP_MODULE_GROUPS}.`,
          labels: { group },
          value: count,
        }),
      ),
    ];
  } catch {
    return [
      {
        name: "nodejs_module_cache_entries",
        type: "gauge",
        help: "Entries in the CommonJS module cache.",
        value: 0,
      },
    ];
  }
}

// ─── Event loop ──────────────────────────────────────────────

const histogram = monitorEventLoopDelay({ resolution: 10 });
histogram.enable();

/**
 * Lag statistics for the interval that just ended.
 *
 * Gauges, not a histogram: the underlying recorder is reset each collection so
 * the numbers describe the last interval rather than all of history, and a
 * value that goes down is a gauge by definition. The reset is safe because it
 * runs on Syhemo's timer, never on a scrape.
 */
function collectEventLoop(): Metric[] {
  // An interval with no samples — which the first collection always is, since
  // it runs the moment start() is called — leaves `mean` as NaN and `min` as
  // int64 max. Both are syntactically valid Prometheus and both are garbage:
  // NaN breaks alert expressions silently, and a 9.2e18 minimum poisons any
  // graph it lands in.
  const empty = histogram.count === 0;
  const toSeconds = (ns: number) => (empty || !Number.isFinite(ns) ? 0 : ns / NS_PER_SECOND);

  const metrics: Metric[] = [
    { name: "nodejs_eventloop_lag_mean_seconds", type: "gauge", help: "Mean event loop lag over the last interval.", value: toSeconds(histogram.mean) },
    { name: "nodejs_eventloop_lag_min_seconds", type: "gauge", help: "Minimum event loop lag over the last interval.", value: toSeconds(histogram.min) },
    { name: "nodejs_eventloop_lag_max_seconds", type: "gauge", help: "Maximum event loop lag over the last interval.", value: toSeconds(histogram.max) },
    { name: "nodejs_eventloop_lag_p99_seconds", type: "gauge", help: "99th percentile event loop lag over the last interval.", value: toSeconds(histogram.percentile(99)) },
  ];

  histogram.reset();
  return metrics;
}

// ─── HTTP ────────────────────────────────────────────────────

/** Seconds. The Prometheus client default, which keeps dashboards portable. */
const LATENCY_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

let httpTotal = 0;
let httpDurationSum = 0;
// Cumulative and never reset: a histogram whose buckets drop cannot produce a
// rate, and a rate is the only thing anyone asks a latency histogram for.
const httpBuckets = new Array<number>(LATENCY_BUCKETS.length + 1).fill(0);

/**
 * Records one finished request.
 *
 * @param latencyMs Duration in milliseconds — converted to seconds here, since
 *                  callers time requests in ms and Prometheus wants seconds.
 */
export function recordHttpRequest(latencyMs: number) {
  const seconds = latencyMs / MS_PER_SECOND;

  httpTotal++;
  httpDurationSum += seconds;

  for (let i = 0; i < LATENCY_BUCKETS.length; i++) {
    if (seconds <= LATENCY_BUCKETS[i]) httpBuckets[i]++;
  }
  httpBuckets[LATENCY_BUCKETS.length]++; // +Inf
}

function collectHttp(): Metric[] {
  const buckets: HistogramBucket[] = LATENCY_BUCKETS.map((le, i) => ({ le, count: httpBuckets[i] }));
  buckets.push({ le: Infinity, count: httpBuckets[LATENCY_BUCKETS.length] });

  return [
    {
      name: "http_requests_total",
      type: "counter",
      help: "Requests recorded since the process started.",
      value: httpTotal,
    },
    {
      name: "http_request_duration_seconds",
      type: "histogram",
      help: "Request duration in seconds.",
      buckets,
      sum: httpDurationSum,
      count: httpTotal,
    },
  ];
}

// ─── DB pool ─────────────────────────────────────────────────

let dbChecker: (() => boolean) | null = null;

/** Registers the connectivity probe `Syhemo.start({ db })` was given. */
export function setDbChecker(fn: (() => boolean) | null) {
  dbChecker = fn;
}

function collectDbPool(): Metric[] {
  return [
    {
      name: "db_pool_connected",
      type: "gauge",
      help: "1 when the database pool reports a connection, 0 otherwise.",
      value: dbChecker && dbChecker() ? 1 : 0,
    },
  ];
}

// ─── Logs ────────────────────────────────────────────────────

function collectLogs(source: SyhemoLogSource): Metric[] {
  const counts = source.counts();
  const help = "Log entries written since the process started, by level.";

  // `total` is what the source counted overall, so "other" is everything that
  // was neither an error nor a warning. Emitting `total` as its own series
  // instead would double-count under any `sum()`.
  return [
    { name: "nodejs_log_entries_total", type: "counter", help, labels: { level: "error" }, value: counts.errors },
    { name: "nodejs_log_entries_total", type: "counter", help, labels: { level: "warn" }, value: counts.warns },
    { name: "nodejs_log_entries_total", type: "counter", help, labels: { level: "other" }, value: Math.max(0, counts.total - counts.errors - counts.warns) },
  ];
}

// ─── System ──────────────────────────────────────────────────

function collectSystem(): Metric[] {
  const [one, five, fifteen] = os.loadavg();
  const help = "System load average.";

  return [
    {
      name: "nodejs_version_info",
      type: "gauge",
      help: "Node.js version and platform, always 1.",
      labels: { version: process.version, platform: os.platform(), arch: os.arch() },
      value: 1,
    },
    { name: "system_memory_total_bytes", type: "gauge", help: "Total system memory in bytes.", value: os.totalmem() },
    { name: "system_memory_free_bytes", type: "gauge", help: "Free system memory in bytes.", value: os.freemem() },
    { name: "process_uptime_seconds", type: "gauge", help: "Seconds since the process started.", value: process.uptime() },
    { name: "system_load_average", type: "gauge", help, labels: { period: "1m" }, value: one },
    { name: "system_load_average", type: "gauge", help, labels: { period: "5m" }, value: five },
    { name: "system_load_average", type: "gauge", help, labels: { period: "15m" }, value: fifteen },
  ];
}

// ─── Everything ──────────────────────────────────────────────

export function collectMetrics(source: SyhemoLogSource): Metric[] {
  return [
    ...collectMemory(),
    ...collectCpu(),
    ...collectHeap(),
    ...collectHandles(),
    ...collectModules(),
    ...collectEventLoop(),
    ...collectHttp(),
    ...collectDbPool(),
    ...collectLogs(source),
    ...collectSystem(),
  ];
}
