// CPU budget: heavy jobs (renders, preview frames, ffmpeg-heavy commands) take a slot, and a new slot
// is granted only while total CPU usage is below the budget. Everything else (chat, LLM calls, file
// edits) never waits. Waiting jobs are served FIFO and told their queue position.

export interface Slot {
  readonly label: string;
  release(): void;
}

export interface AcquireOptions {
  label?: string;
  /** called when the queue position changes (1 = next) */
  onPosition?: (position: number) => void;
  signal?: AbortSignal;
}

interface Waiter {
  label: string;
  resolve: (s: Slot) => void;
  reject: (e: Error) => void;
  onPosition?: (p: number) => void;
  lastPos: number;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export interface BudgetOptions {
  /** fraction of the CPU we may use (0.9) */
  budget: number;
  /** hard cap on concurrent heavy jobs */
  maxSlots: number;
  /** returns current usage 0..1 */
  usage: () => number;
  /** at most one new grant per this many ms, so usage can react before the next job starts */
  grantCooldownMs?: number;
  now?: () => number;
}

export class CpuBudget {
  private running = new Set<Slot>();
  private queue: Waiter[] = [];
  private lastGrant = -Infinity;
  private timer: NodeJS.Timeout | null = null;
  private readonly cooldown: number;
  private readonly now: () => number;

  constructor(private readonly opts: BudgetOptions) {
    this.cooldown = opts.grantCooldownMs ?? 1000;
    this.now = opts.now ?? (() => Date.now());
  }

  /** Re-evaluate the queue (call after each CPU sample and when a slot is released). */
  tick() {
    while (this.queue.length) {
      if (this.running.size >= this.opts.maxSlots) break;
      // grant only while the machine has headroom...
      if (this.opts.usage() >= this.opts.budget) break;
      // ...and give a freshly started job time to show up in the CPU numbers before starting another
      if (this.running.size > 0 && this.now() - this.lastGrant < this.cooldown) break;
      this.grant(this.queue.shift()!);
    }
    this.queue.forEach((w, i) => {
      const pos = i + 1;
      if (pos !== w.lastPos) {
        w.lastPos = pos;
        w.onPosition?.(pos);
      }
    });
  }

  private grant(w: Waiter) {
    this.lastGrant = this.now();
    const slot: Slot = {
      label: w.label,
      release: () => {
        if (this.running.delete(slot)) this.tick();
      },
    };
    this.running.add(slot);
    if (w.signal && w.onAbort) w.signal.removeEventListener('abort', w.onAbort);
    w.resolve(slot);
  }

  /** Wait for a slot. Rejects with AbortError if `signal` fires first. */
  acquire(opts: AcquireOptions = {}): Promise<Slot> {
    return new Promise<Slot>((resolve, reject) => {
      const w: Waiter = { label: opts.label ?? 'job', resolve, reject, onPosition: opts.onPosition, lastPos: 0, signal: opts.signal };
      if (opts.signal) {
        if (opts.signal.aborted) return reject(abortError());
        w.onAbort = () => {
          this.queue = this.queue.filter((x) => x !== w);
          reject(abortError());
          this.tick();
        };
        opts.signal.addEventListener('abort', w.onAbort, { once: true });
      }
      this.queue.push(w);
      this.tick();
    });
  }

  /** Run `fn` while holding a slot. */
  async run<T>(fn: (slot: Slot) => Promise<T>, opts: AcquireOptions = {}): Promise<T> {
    const slot = await this.acquire(opts);
    try {
      return await fn(slot);
    } finally {
      slot.release();
    }
  }

  /** How many more jobs could start right now (for choosing parallel render chunks). */
  freeSlots(): number {
    if (this.opts.usage() >= this.opts.budget) return 0;
    return Math.max(0, this.opts.maxSlots - this.running.size);
  }

  status() {
    return { usage: this.opts.usage(), budget: this.opts.budget, running: this.running.size, queued: this.queue.length, maxSlots: this.opts.maxSlots };
  }

  /** Poll the queue every second so it moves when load drops. */
  start(intervalMs = 1000) {
    this.timer = setInterval(() => this.tick(), intervalMs);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

function abortError() {
  const e = new Error('aborted');
  e.name = 'AbortError';
  return e;
}
