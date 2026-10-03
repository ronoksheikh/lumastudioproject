import { describe, expect, it, vi } from 'vitest';
import { CpuBudget } from './budget.js';
import { CpuSampler, type CpuSource } from './sampler.js';

describe('CpuSampler', () => {
  it('turns cumulative cpu time into a usage fraction of the available cpus', () => {
    let usageUs = 0;
    let now = 0;
    const src: CpuSource = { name: 'fake', read: () => ({ usageUs, cpus: 4 }) };
    const s = new CpuSampler(src, () => now, 1);
    s.sample();
    now += 1000; // 1 s
    usageUs += 3_600_000; // 3.6 cpu-seconds of 4 available -> 0.9
    expect(s.sample()).toBeCloseTo(0.9, 2);
    now += 1000;
    usageUs += 400_000;
    expect(s.sample()).toBeCloseTo(0.1, 2);
  });

  it('averages over a short window so one spike does not stall the queue', () => {
    let usageUs = 0;
    let now = 0;
    const s = new CpuSampler({ name: 'fake', read: () => ({ usageUs, cpus: 1 }) }, () => now, 3);
    s.sample();
    for (const frac of [0.1, 0.1, 1]) {
      now += 1000;
      usageUs += frac * 1_000_000;
      s.sample();
    }
    expect(s.usage).toBeCloseTo(0.4, 2);
  });
});

describe('CpuBudget', () => {
  const make = (initial: number, over: Partial<ConstructorParameters<typeof CpuBudget>[0]> = {}) => {
    const state = { usage: initial, now: 0 };
    const budget = new CpuBudget({ budget: 0.9, maxSlots: 2, usage: () => state.usage, grantCooldownMs: 1000, now: () => state.now, ...over });
    return { state, budget };
  };

  it('starts a job immediately on an idle machine', async () => {
    const { budget } = make(0.1);
    const slot = await budget.acquire({ label: 'render' });
    expect(budget.status().running).toBe(1);
    slot.release();
    expect(budget.status().running).toBe(0);
  });

  it('keeps a job queued while usage is above the budget and starts it when load drops', async () => {
    const { budget, state } = make(0.97);
    const positions: number[] = [];
    let started = false;
    const p = budget.acquire({ onPosition: (n) => positions.push(n) }).then((s) => ((started = true), s));
    await Promise.resolve();
    expect(started).toBe(false);
    expect(budget.status()).toMatchObject({ running: 0, queued: 1 });
    state.usage = 0.5;
    budget.tick();
    const slot = await p;
    expect(started).toBe(true);
    expect(positions).toEqual([1]);
    slot.release();
  });

  it('serves the queue FIFO, respects maxSlots and the grant cooldown', async () => {
    const { budget, state } = make(0.2);
    const order: string[] = [];
    const a = budget.acquire({ label: 'a' }).then((s) => (order.push('a'), s));
    const b = budget.acquire({ label: 'b' }).then((s) => (order.push('b'), s));
    const c = budget.acquire({ label: 'c' }).then((s) => (order.push('c'), s));
    const sa = await a;
    await Promise.resolve();
    expect(order).toEqual(['a']); // b waits for the cooldown
    state.now = 1500;
    budget.tick();
    const sb = await b;
    expect(order).toEqual(['a', 'b']);
    state.now = 3000;
    budget.tick();
    await Promise.resolve();
    expect(order).toEqual(['a', 'b']); // maxSlots = 2
    sa.release();
    const sc = await c;
    expect(order).toEqual(['a', 'b', 'c']);
    sb.release();
    sc.release();
  });

  it('reports queue positions and supports abort', async () => {
    const { budget } = make(0.99);
    const ac = new AbortController();
    const pos: number[] = [];
    const first = budget.acquire({ onPosition: (n) => pos.push(n), signal: ac.signal });
    const second = budget.acquire({});
    second.catch(() => {});
    ac.abort();
    await expect(first).rejects.toThrow('aborted');
    expect(budget.status().queued).toBe(1);
  });

  it('run() releases the slot even when the job throws', async () => {
    const { budget } = make(0.1);
    await expect(budget.run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(budget.status().running).toBe(0);
  });

  it('freeSlots is 0 while the machine is over budget', () => {
    const { budget, state } = make(0.95);
    expect(budget.freeSlots()).toBe(0);
    state.usage = 0.3;
    expect(budget.freeSlots()).toBe(2);
  });

  it('moves the queue on its own timer when load drops', async () => {
    vi.useFakeTimers();
    try {
      const { budget, state } = make(0.95);
      budget.start(100);
      const p = budget.acquire({});
      state.usage = 0.2;
      await vi.advanceTimersByTimeAsync(150);
      await expect(p).resolves.toBeTruthy();
      budget.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
