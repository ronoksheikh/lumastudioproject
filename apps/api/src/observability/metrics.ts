// A tiny in-process metrics registry that renders Prometheus text. Enough for: runs, tool errors,
// render durations, HTTP errors — no dependency, no cardinality surprises (labels are fixed sets).
type Labels = Record<string, string | number>;

const counters = new Map<string, { help: string; values: Map<string, number> }>();
const sums = new Map<string, { help: string; sum: number; count: number; buckets: number[]; counts: number[] }>();

const key = (l: Labels = {}) =>
  Object.entries(l)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${String(v).replace(/["\\\n]/g, '_')}"`)
    .join(',');

export function inc(name: string, labels: Labels = {}, by = 1, help = name) {
  const c = counters.get(name) ?? counters.set(name, { help, values: new Map() }).get(name)!;
  const k = key(labels);
  c.values.set(k, (c.values.get(k) ?? 0) + by);
}

/** Histogram of durations in seconds. */
export function observe(name: string, seconds: number, help = name, buckets = [30, 60, 120, 300, 600, 1200, 2400, 3600]) {
  const h = sums.get(name) ?? sums.set(name, { help, sum: 0, count: 0, buckets, counts: buckets.map(() => 0) }).get(name)!;
  h.sum += seconds;
  h.count++;
  h.buckets.forEach((b, i) => {
    if (seconds <= b) h.counts[i]!++;
  });
}

export function renderMetrics(extra: Record<string, number> = {}): string {
  const out: string[] = [];
  for (const [name, c] of counters) {
    out.push(`# HELP ${name} ${c.help}`, `# TYPE ${name} counter`);
    for (const [k, v] of c.values) out.push(`${name}${k ? `{${k}}` : ''} ${v}`);
  }
  for (const [name, h] of sums) {
    out.push(`# HELP ${name} ${h.help}`, `# TYPE ${name} histogram`);
    h.buckets.forEach((b, i) => out.push(`${name}_bucket{le="${b}"} ${h.counts[i]}`));
    out.push(`${name}_bucket{le="+Inf"} ${h.count}`, `${name}_sum ${h.sum}`, `${name}_count ${h.count}`);
  }
  for (const [name, v] of Object.entries(extra)) out.push(`# TYPE ${name} gauge`, `${name} ${v}`);
  return out.join('\n') + '\n';
}

export const resetMetrics = () => {
  counters.clear();
  sums.clear();
};
