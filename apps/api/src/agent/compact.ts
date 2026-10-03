// Context management: when the conversation nears the model's window, fold the oldest part into a
// "project memory" summary (kept in the DB and in .luma/memory.md) and keep the recent messages verbatim.
import fs from 'node:fs';
import path from 'node:path';
import type OpenAI from 'openai';
import type { ProjectRef } from '../runner/exec.js';
import { estimateTokens, type ChatMessage, type ConvoStore, type StoredMessage } from './convo.js';

export const COMPACT_AT = 0.7; // fraction of the context window
const KEEP_RECENT = 10; // messages kept verbatim at minimum

const text = (m: ChatMessage): string => {
  const c = (m as { content?: unknown }).content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((p) => (p && typeof p === 'object' && 'text' in p ? String((p as { text: unknown }).text) : '[image]')).join(' ');
  return '';
};

/** Index (into `rows`) of the first message to keep verbatim — never splits an assistant/tool pair. */
export function chooseCut(rows: StoredMessage[], keepRecent = KEEP_RECENT): number {
  let cut = Math.max(0, rows.length - keepRecent);
  // always keep from a 'user' message (or an assistant message whose tool results follow it)
  while (cut > 0 && (rows[cut]!.msg as { role: string }).role !== 'user') cut--;
  return cut;
}

function renderForSummary(rows: StoredMessage[]): string {
  return rows
    .map(({ msg }) => {
      const role = (msg as { role: string }).role;
      if (role === 'assistant') {
        const calls = ((msg as { tool_calls?: Array<{ function: { name: string; arguments: string } }> }).tool_calls ?? []).map((c) => `${c.function.name}(${c.function.arguments.slice(0, 300)})`);
        return `ASSISTANT: ${text(msg).slice(0, 1500)}${calls.length ? `\n  tool calls: ${calls.join('; ')}` : ''}`;
      }
      if (role === 'tool') return `TOOL RESULT: ${text(msg).slice(0, 500)}`;
      return `${role.toUpperCase()}: ${text(msg).slice(0, 2500)}`;
    })
    .join('\n');
}

const SUMMARY_PROMPT = `You are compacting the working memory of a motion-graphics agent. Write a faithful summary of the work below
so the agent can continue without the original messages. Include: what the student asked for and their preferences/decisions;
the script segments (ids + purpose); which files exist and what each scene does; what was verified or is still broken;
the voice state (generated? placeholder?); render state; open TODOs. Keep exact file paths, segment ids, numbers and names.
Use short bullet points, at most 700 words. No preamble.`;

export interface CompactDeps {
  client: OpenAI;
  model: string;
  contextWindow: number;
  store: ConvoStore;
  project: ProjectRef;
  signal?: AbortSignal;
}

/**
 * If the history is too big, summarise the oldest part. Returns the new (summary, remaining rows) or null
 * when nothing needed to change.
 */
export async function compactIfNeeded(
  system: ChatMessage,
  rows: StoredMessage[],
  memory: string | null,
  deps: CompactDeps,
): Promise<{ memory: string; rows: StoredMessage[] } | null> {
  const tokens = estimateTokens([system, ...rows.map((r) => r.msg)]) + (memory ? Math.ceil(memory.length / 3.2) : 0);
  if (tokens < deps.contextWindow * COMPACT_AT) return null;
  const cut = chooseCut(rows);
  if (cut <= 0) return null; // nothing old enough to fold away
  const old = rows.slice(0, cut);
  const keep = rows.slice(cut);

  let summary: string;
  try {
    const res = await deps.client.chat.completions.create(
      {
        model: deps.model,
        max_tokens: 1800,
        messages: [
          { role: 'system', content: SUMMARY_PROMPT },
          { role: 'user', content: `${memory ? `Previous memory:\n${memory}\n\n` : ''}Messages to fold in:\n${renderForSummary(old)}`.slice(0, Math.floor(deps.contextWindow * 3.2 * 0.6)) },
        ],
      },
      { signal: deps.signal },
    );
    summary = res.choices[0]?.message?.content?.trim() ?? '';
  } catch {
    summary = '';
  }
  if (!summary) {
    // the model could not summarise: keep a mechanical digest instead of failing the run
    summary = `${memory ? memory + '\n\n' : ''}(older messages were trimmed)\n${renderForSummary(old).slice(-6000)}`;
  }
  const upto = old.at(-1)!.rowid;
  deps.store.saveMemory(summary, upto);
  try {
    const dir = path.join(deps.project.dir, '.luma');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'memory.md'), `# Project memory\n\n${summary}\n`);
    if (typeof process.getuid === 'function' && process.getuid() === 0 && deps.project.uid != null) {
      fs.chownSync(dir, deps.project.uid, deps.project.uid);
      fs.chownSync(path.join(dir, 'memory.md'), deps.project.uid, deps.project.uid);
    }
  } catch { /* the DB copy is authoritative */ }
  return { memory: summary, rows: keep };
}
