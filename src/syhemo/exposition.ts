import type { HistogramMetric, Metric, MetricLabels, ScalarMetric } from "./types";

/**
 * Renders metrics as the Prometheus text exposition format.
 *
 * Serve the result verbatim with `CONTENT_TYPE`; nothing else is required to
 * be scrapeable.
 */

/** What a `/metrics` response must declare. */
export const CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

/**
 * Label values are the only free text in the format, so they are the only
 * place a stray quote or newline can break a scrape.
 */
function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function renderLabels(labels: MetricLabels | undefined, extra?: MetricLabels): string {
  const merged = { ...labels, ...extra };
  const keys = Object.keys(merged);
  if (keys.length === 0) return "";

  const pairs = keys.map((key) => `${key}="${escapeLabelValue(merged[key])}"`);
  return `{${pairs.join(",")}}`;
}

/**
 * Prometheus writes positive infinity as `+Inf`, and rejects `1e+21`-style
 * output that `String(number)` produces for very large values.
 */
function renderValue(value: number): string {
  if (value === Infinity) return "+Inf";
  if (value === -Infinity) return "-Inf";
  if (Number.isNaN(value)) return "NaN";
  return String(value);
}

function renderScalar(metric: ScalarMetric): string[] {
  return [`${metric.name}${renderLabels(metric.labels)} ${renderValue(metric.value)}`];
}

function renderHistogram(metric: HistogramMetric): string[] {
  const lines = metric.buckets.map(
    (bucket) =>
      `${metric.name}_bucket${renderLabels(metric.labels, { le: renderValue(bucket.le) })} ` +
      `${renderValue(bucket.count)}`,
  );

  lines.push(`${metric.name}_sum${renderLabels(metric.labels)} ${renderValue(metric.sum)}`);
  lines.push(`${metric.name}_count${renderLabels(metric.labels)} ${renderValue(metric.count)}`);

  return lines;
}

/**
 * `# HELP` and `# TYPE` are declared once per metric name, even when several
 * series share it under different labels — repeating them makes the scrape
 * fail with a duplicate-metadata error.
 */
export function render(metrics: Metric[]): string {
  const lines: string[] = [];
  const declared = new Set<string>();

  for (const metric of metrics) {
    if (!declared.has(metric.name)) {
      declared.add(metric.name);
      lines.push(`# HELP ${metric.name} ${metric.help.replace(/\n/g, " ")}`);
      lines.push(`# TYPE ${metric.name} ${metric.type}`);
    }

    lines.push(...(metric.type === "histogram" ? renderHistogram(metric) : renderScalar(metric)));
  }

  // The format requires a trailing newline; a scrape of a body without one is
  // rejected as truncated.
  return lines.length ? `${lines.join("\n")}\n` : "";
}
