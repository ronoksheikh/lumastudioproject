import type { CpuBudget } from '../../cpu/budget.js';
import type { DB } from '../../db/index.js';
import type { ProjectRef } from '../../runner/exec.js';
import type { RunBus } from '../events.js';

export interface ImagePart {
  mime: string;
  base64: string;
  label: string;
}

export interface ToolResult {
  ok: boolean;
  /** what the model reads */
  content: string;
  /** one line for the UI card */
  summary: string;
  truncated?: boolean;
  /** images the model should look at (delivered in a follow-up user message for vision models) */
  images?: ImagePart[];
}

export interface RenderService {
  render(args: { projectId: string; userId: string; runId: string; preset: 'draft' | 'final'; signal: AbortSignal; bus: RunBus }): Promise<ToolResult>;
}

export interface ToolContext {
  db: DB;
  runId: string;
  projectId: string;
  userId: string;
  project: ProjectRef;
  bus: RunBus;
  signal: AbortSignal;
  callId: string;
  /** values to scrub from anything the model or the UI sees */
  secrets: string[];
  supportsVision: boolean;
  cpu?: CpuBudget;
  render?: RenderService;
  elevenKey: () => string | null;
  askUser: (question: string, options: string[]) => Promise<string>;
  /** compact_context: fold older messages into the project memory before the next model call */
  requestCompaction?: (keep?: string) => void;
}

export const ok = (content: string, summary = content.split('\n')[0]!.slice(0, 160), extra: Partial<ToolResult> = {}): ToolResult => ({ ok: true, content, summary, ...extra });
export const fail = (message: string): ToolResult => ({ ok: false, content: `Error: ${message}`, summary: message.split('\n')[0]!.slice(0, 160) });
