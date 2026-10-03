import { config } from '../config.js';
import { logger } from '../logger.js';
import { CpuBudget } from './budget.js';
import { CpuSampler } from './sampler.js';

export * from './budget.js';
export * from './sampler.js';

/** Process-wide sampler + budget. Heavy jobs call `cpuBudget.run(...)`. */
export function createCpuBudget() {
  const sampler = new CpuSampler();
  const budget = new CpuBudget({ budget: config.cpuBudget, maxSlots: config.maxRenderWorkers, usage: () => sampler.usage });
  sampler.start(1000, () => budget.tick());
  budget.start();
  logger.info({ source: sampler.name, budget: config.cpuBudget, maxSlots: config.maxRenderWorkers }, 'cpu budget started');
  return {
    sampler,
    budget,
    stop() {
      sampler.stop();
      budget.stop();
    },
  };
}
