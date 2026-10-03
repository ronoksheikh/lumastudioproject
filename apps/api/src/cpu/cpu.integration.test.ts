// Opt-in (LUMA_CPU_IT=1): burns every core and checks the real sampler keeps a job queued, then releases it.
import { Worker } from 'node:worker_threads';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { CpuBudget } from './budget.js';
import { CpuSampler } from './sampler.js';

describe.skipIf(!process.env.LUMA_CPU_IT)('cpu budget with real load', () => {
  it('a job stays queued while the machine is above 90% and starts when the load stops', async () => {
    const sampler = new CpuSampler();
    const budget = new CpuBudget({ budget: 0.9, maxSlots: 2, usage: () => sampler.usage, grantCooldownMs: 0 });
    sampler.start(250, () => budget.tick());
    budget.start(250);
    const burners = Array.from({ length: os.availableParallelism() * 2 }, () =>
      new Worker('const e=Date.now()+60000;while(Date.now()<e){}', { eval: true }));
    await new Promise((r) => setTimeout(r, 3500));
    expect(sampler.usage).toBeGreaterThan(0.9);
    let started = false;
    const p = budget.acquire({ label: 'render' }).then((s) => ((started = true), s));
    await new Promise((r) => setTimeout(r, 1500));
    expect(started).toBe(false);
    expect(budget.status().queued).toBe(1);
    await Promise.all(burners.map((w) => w.terminate()));
    const slot = await p;
    expect(started).toBe(true);
    slot.release();
    sampler.stop();
    budget.stop();
    console.log(`source=${sampler.name}`);
  }, 30_000);
});
