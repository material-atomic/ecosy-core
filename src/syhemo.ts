import { monitorEventLoopDelay } from "node:perf_hooks";
import { Subscriber } from "./subscriber";
import { freeze } from "./utilities/freeze";
import { Logger } from "./logger";
import type { LogEntry } from "./logger";
import * as v8 from "v8";
import * as os from "os";

export interface MemorySnapshot {
  rss: number; // MB
  heapUsed: number; // MB
  heapTotal: number; // MB
  external: number; // MB
  arrayBuffers: number; // MB
}

export interface CpuSnapshot {
  model: string;
  count: number;
  usage: number; // 0-100%
}

export interface HeapSnapshot {
  totalHeapSize: number;
  usedHeapSize: number;
  heapSizeLimit: number;
  mallocedMemory: number;
  nativeContexts: number;
  detachedContexts: number;
}

export interface ModuleInfo {
  path: string;
  count: number;
}

export interface HandleSnapshot {
  timers: number;
  sockets: number;
  requests: number;
  total: number;
}

export interface EventLoopSnapshot {
  lagMs: number; // event loop lag in ms
  min: number;
  max: number;
  mean: number;
  p99: number;
}

export interface LogRateSnapshot {
  errors: number; // since last snapshot
  warns: number;
  total: number;
}

export interface HttpSnapshot {
  totalRequests: number;
  recentRequests: number; // since last snapshot
  avgLatency: number; // ms
}

export interface DbPoolSnapshot {
  connected: boolean;
}

export interface MetricSnapshot {
  timestamp: number;
  memory: MemorySnapshot;
  cpu: CpuSnapshot;
  heap: HeapSnapshot;
  handles: HandleSnapshot;
  modules: { count: number; top: ModuleInfo[] };
  eventLoop: EventLoopSnapshot;
  logRate: LogRateSnapshot;
  http: HttpSnapshot;
  dbPool: DbPoolSnapshot;
  system: {
    platform: string;
    arch: string;
    nodeVersion: string;
    totalMemory: number; // MB
    freeMemory: number; // MB
    uptime: number; // seconds
    loadAvg: number[];
  };
}

export interface SyhemoState {
  current: MetricSnapshot | null;
  snapshots: MetricSnapshot[];
  logs: LogEntry[];
  started: boolean;
}

// ─── Events ──────────────────────────────────────────────────

const syhemoEvents = freeze({
  metrics: {
    snapshot: "$syhemo:metrics:snapshot",
  },
});

type SyhemoEvents = typeof syhemoEvents;

// ─── Collectors ──────────────────────────────────────────────

const MB = 1024 * 1024;

function collectMemory(): MemorySnapshot {
  const mem = process.memoryUsage();
  return {
    rss: Math.round((mem.rss / MB) * 100) / 100,
    heapUsed: Math.round((mem.heapUsed / MB) * 100) / 100,
    heapTotal: Math.round((mem.heapTotal / MB) * 100) / 100,
    external: Math.round((mem.external / MB) * 100) / 100,
    arrayBuffers: Math.round((mem.arrayBuffers / MB) * 100) / 100,
  };
}

let prevCpuUsage: os.CpuInfo[] | null = null;

function collectCpu(): CpuSnapshot {
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

    usage = totalDelta > 0 ? Math.round((1 - idleDelta / totalDelta) * 10000) / 100 : 0;
  }

  prevCpuUsage = cpus;

  return {
    model: cpus[0]?.model ?? "unknown",
    count: cpus.length,
    usage,
  };
}

function collectHeap(): HeapSnapshot {
  const stats = v8.getHeapStatistics();
  return {
    totalHeapSize: Math.round((stats.total_heap_size / MB) * 100) / 100,
    usedHeapSize: Math.round((stats.used_heap_size / MB) * 100) / 100,
    heapSizeLimit: Math.round((stats.heap_size_limit / MB) * 100) / 100,
    mallocedMemory: Math.round((stats.malloced_memory / MB) * 100) / 100,
    nativeContexts: stats.number_of_native_contexts,
    detachedContexts: stats.number_of_detached_contexts,
  };
}

function collectHandles(): HandleSnapshot {
  // @ts-expect-error _getActiveHandles is internal Node API
  const handles: unknown[] = process._getActiveHandles?.() ?? [];
  // @ts-expect-error _getActiveRequests is internal Node API
  const requests: unknown[] = process._getActiveRequests?.() ?? [];

  let timers = 0;
  let sockets = 0;

  for (const h of handles) {
    const name = h?.constructor?.name ?? "";
    if (name === "Timeout" || name === "Timer" || name === "Immediate") timers++;
    else if (name === "Socket" || name === "TCP" || name === "TLSSocket") sockets++;
  }

  return {
    timers,
    sockets,
    requests: requests.length,
    total: handles.length + requests.length,
  };
}

function collectModules(): { count: number; top: ModuleInfo[] } {
  try {
    // Avoid `require.cache` keyword entirely — Turbopack panics on CjsRequireCacheAccess
    const cache: Record<string, unknown> =
      eval("typeof require !== 'undefined' && require.cache") || {};
    const keys = Object.keys(cache);
    const count = keys.length;

    const groups = new Map<string, number>();
    for (const key of keys) {
      const match = key.match(/node_modules\/([^/]+)/);
      const group = match ? `node_modules/${match[1]}` : key.replace(process.cwd(), ".");
      groups.set(group, (groups.get(group) ?? 0) + 1);
    }

    const top = Array.from(groups.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([path, count]) => ({ path, count }));

    return { count, top };
  } catch {
    return { count: 0, top: [] };
  }
}

// Initialize once
const histogram = monitorEventLoopDelay({ resolution: 10 });
histogram.enable();

function collectEventLoop(): EventLoopSnapshot {
  const result: EventLoopSnapshot = {
    lagMs: Math.round((histogram.mean / 1e6) * 100) / 100, // nanosecond -> ms
    min: Math.round((histogram.min / 1e6) * 100) / 100,
    max: Math.round((histogram.max / 1e6) * 100) / 100,
    mean: Math.round((histogram.mean / 1e6) * 100) / 100,
    p99: Math.round((histogram.percentile(99) / 1e6) * 100) / 100,
  };

  histogram.reset(); // Reset for the next 5-second cycle
  return result;
}

// ─── HTTP Request Stats ──────────────────────────────────────

let httpTotalRequests = 0;
let httpRecentRequests = 0;
let httpLatencySum = 0;
let httpLatencySamples = 0;

export function recordHttpRequest(latencyMs: number) {
  httpTotalRequests++;
  httpRecentRequests++;
  httpLatencySum += latencyMs;
  httpLatencySamples++;
}

function collectHttp(): HttpSnapshot {
  const avgLatency =
    httpLatencySamples > 0 ? Math.round((httpLatencySum / httpLatencySamples) * 100) / 100 : 0;

  const result: HttpSnapshot = {
    totalRequests: httpTotalRequests,
    recentRequests: httpRecentRequests,
    avgLatency,
  };

  // Reset interval counters
  httpRecentRequests = 0;
  httpLatencySum = 0;
  httpLatencySamples = 0;

  return result;
}

// ─── DB Pool ─────────────────────────────────────────────────

let dbChecker: (() => boolean) | null = null;

function collectDbPool(): DbPoolSnapshot {
  return {
    connected: dbChecker ? dbChecker() : false,
  };
}

// ─── Full Snapshot ───────────────────────────────────────────

function collectSnapshot(): MetricSnapshot {
  return {
    timestamp: Date.now(),
    memory: collectMemory(),
    cpu: collectCpu(),
    heap: collectHeap(),
    handles: collectHandles(),
    modules: collectModules(),
    eventLoop: collectEventLoop(),
    logRate: Logger.drainCounts(),
    http: collectHttp(),
    dbPool: collectDbPool(),
    system: {
      platform: os.platform(),
      arch: os.arch(),
      nodeVersion: process.version,
      totalMemory: Math.round(os.totalmem() / MB),
      freeMemory: Math.round(os.freemem() / MB),
      uptime: Math.round(process.uptime()),
      loadAvg: os.loadavg().map((v) => Math.round(v * 100) / 100),
    },
  };
}

// ─── Syhemo Class ────────────────────────────────────────────

export interface SyhemoOptions {
  interval?: number;
  db?: () => boolean;
}

const MAX_SNAPSHOTS = 60;

export class Syhemo extends Subscriber<SyhemoState, SyhemoEvents> {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly logger = new Logger("Syhemo");

  constructor() {
    super({ current: null, snapshots: [], logs: [], started: false }, syhemoEvents);
  }

  start(options: SyhemoOptions = {}) {
    if (this.getState().started) return;

    const { interval = 5000, db } = options;

    if (db) dbChecker = db;

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

  private collect() {
    try {
      const snapshot = collectSnapshot();
      const prev = this.getState().snapshots;
      const snapshots =
        prev.length >= MAX_SNAPSHOTS ? [...prev.slice(1), snapshot] : [...prev, snapshot];

      // Get latest logs from Logger buffer
      const logs = Logger.getLogs();

      this.setState({ current: snapshot, snapshots, logs });
      this.dispatch(syhemoEvents.metrics.snapshot, snapshot);
      this.logger.log(`Snapshot completed (count: ${snapshots.length})`);
    } catch (e) {
      this.logger.error(`Collection failed: ${e}`);
    }
  }
}
