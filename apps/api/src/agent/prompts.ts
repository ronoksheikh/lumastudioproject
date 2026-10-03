import fs from 'node:fs';
import path from 'node:path';
import { ASPECTS, type Aspect } from '@luma/shared';
import { config } from '../config.js';

let cached: string | null = null;
const template = () => (cached ??= fs.readFileSync(path.join(config.promptsDir, 'system.md'), 'utf8'));
export const resetPromptCache = () => {
  cached = null;
};

export interface PromptVars {
  aspect: string;
  brandSummary: string;
  attachmentsSummary: string;
}

/** System prompt = packages/prompts/system.md with the project facts filled in. */
export function buildSystemPrompt(vars: PromptVars): string {
  return fillPromptVars(template(), vars);
}

/** Fills {aspect} {width} {height} {brand_summary} {attachments_summary} (also in a student's own prompt). */
export function fillPromptVars(text: string, vars: PromptVars): string {
  const size = ASPECTS[vars.aspect as Aspect] ?? ASPECTS['16:9'];
  return text
    .replaceAll('{aspect}', vars.aspect)
    .replaceAll('{width}', String(size.width))
    .replaceAll('{height}', String(size.height))
    .replaceAll('{brand_summary}', vars.brandSummary)
    .replaceAll('{attachments_summary}', vars.attachmentsSummary);
}
