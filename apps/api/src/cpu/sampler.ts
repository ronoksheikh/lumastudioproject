// Measures how busy the machine (or this container's CPU quota) is, as a fraction 0..1.
import fs from 'node:fs';
import os from 'node:os';

/** Returns cumulative CPU time consumed (µs) and the number of CPUs available to us. */
export interface CpuSource {
  name: string;
  read(): { usageUs: number; cpus: number };
}

const num = (s: string | undefined) => (s === undefined ? NaN : Number(s));

function cgroupV2(): CpuSource | null {
  try {
    const stat = fs.readFileSync('/sys/fs/cgroup/cpu.stat', 'utf8');
    if (!/usage_usec/.test(stat)) return null;
    return {
      name: 'cgroup-v2',
      read() {
        const usage = num(/usage_usec\s+(\d+)/.exec(fs.readFileSync('/sys/fs/cgroup/cpu.stat', 'utf8'))?.[1]);
        let cpus = os.availableParallelism();
        try {
          const [quota, period] = fs.readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim().split(/\s+/);
          if (quota && quota !== 'max') cpus = Math.min(cpus, Number(quota) / Number(period));
        } catch { /* no limit */ }
        return { usageUs: usage, cpus };
      },
    };
  } catch {
    return null;
  }
}

function cgroupV1(): CpuSource | null {
  const usageFile = ['/sys/fs/cgroup/cpuacct/cpuacct.usage', '/sys/fs/cgroup/cpu,cpuacct/cpuacct.usage'].find((f) => fs.existsSync(f));
  if (!usageFile) return null;
  const dir = usageFile.replace(/\/cpuacct\.usage$/, '');
  try {
    Number(fs.readFileSync(usageFile, 'utf8'));
  } catch {
    return null;
  }
  return {
    name: 'cgroup-v1',
    read() {
      const usage = Number(fs.readFileSync(usageFile, 'utf8')) / 1000; // ns -> µs
      let cpus = os.availableParallelism();
      try {
        const quota = Number(fs.readFileSync(`${dir}/cpu.cfs_quota_us`, 'utf8'));
        const period = Number(fs.readFileSync(`${dir}/cpu.cfs_period_us`, 'utf8'));
        if (quota > 0 && period > 0) cpus = Math.min(cpus, quota / period);
      } catch { /* no limit */ }
      return { usageUs: usage, cpus };
    },
  };
}

function procStat(): CpuSource {
  return {
    name: 'proc-stat',
    read() {
      const line = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0]!;
      const f = line.trim().split(/\s+/).slice(1).map(Number);
      // user nice system idle iowait irq softirq steal …
      const busy = (f[0] ?? 0) + (f[1] ?? 0) + (f[2] ?? 0) + (f[5] ?? 0) + (f[6] ?? 0) + (f[7] ?? 0);
      const ticksPerSec = 100; // USER_HZ
      return { usageUs: (busy / ticksPerSec) * 1e6, cpus: os.availableParallelism() };
    },
  };
}

/** Best available source: cgroup v2 → cgroup v1 → /proc/stat. */
export function detectCpuSource(): CpuSource {
  return cgroupV2() ?? cgroupV1() ?? procStat();
}

/**
 * Samples a CpuSource on a timer. `usage` is the fraction of available CPU used over the last few
 * seconds (a short moving average so one spike doesn't stall the queue).
 */
export class CpuSampler {
  private last: { usageUs: number; at: number } | null = null;
  private window: number[] = [];
  private timer: NodeJS.Timeout | null = null;
  private current = 0;

  constructor(
    private readonly source: CpuSource = detectCpuSource(),
    private readonly now: () => number = () => performance.now(),
    private readonly windowSize = 3,
  ) {}

  get name() {
    return this.source.name;
  }

  /** Take one sample (call periodically). */
  sample(): number {
    const { usageUs, cpus } = this.source.read();
    const at = this.now();
    if (this.last) {
      const dtUs = (at - this.last.at) * 1000;
      if (dtUs > 0) {
        const frac = Math.min(1, Math.max(0, (usageUs - this.last.usageUs) / (dtUs * cpus)));
        this.window.push(frac);
        if (this.window.length > this.windowSize) this.window.shift();
        this.current = this.window.reduce((a, b) => a + b, 0) / this.window.length;
      }
    }
    this.last = { usageUs, at };
    return this.current;
  }

  get usage() {
    return this.current;
  }

  start(intervalMs = 1000, onSample?: (usage: number) => void) {
    this.sample();
    this.timer = setInterval(() => onSample?.(this.sample()), intervalMs);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
