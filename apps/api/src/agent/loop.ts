// The agent loop: stream a completion, run the tool calls it asks for, feed the results back, repeat
// until the model answers without tools, the student presses Stop, or a limit is hit.
import fs from 'node:fs';
import OpenAI from 'openai';
import { toolDefinitions, type StopReason } from '@luma/shared';
import type BetterSqlite3 from 'better-sqlite3';
import { config } from '../config.js';
import type { CpuBudget } from '../cpu/budget.js';
import type { DB } from '../db/index.js';
import { commitAll } from '../projects/git.js';
import { makeClient } from '../providers/client.js';
import type { ProjectRef } from '../runner/exec.js';
import { redactSecrets } from '../security/redact.js';
import { truncateMiddle } from '../runner/truncate.js';
import { compactIfNeeded } from './compact.js';
import { ConvoStore, type ChatMessage, type StoredMessage } from './convo.js';
import type { RunBus } from './events.js';
import { attachmentsSummary, brandSummary, projectFacts } from './facts.js';
import { forgetRun, lessonsForPrompt } from './lessons.js';
import { buildSystemPrompt, fillPromptVars } from './prompts.js';
import { describeOverrides, getVoicePrefs, getAgentPrompt } from '../settings/service.js';
import { collectTurn, type AssistantTurn } from './stream.js';
import { inc } from '../observability/metrics.js';
import { runTool, type ImagePart, type RenderService } from './tools/index.js';

export interface AgentDeps {
  db: DB;
  sqlite: BetterSqlite3.Database;
  cpu?: CpuBudget;
  render?: RenderService;
  /** backoff between retries of a failed model call (tests shrink this) */
  retryDelaysMs?: number[];
}

export interface RunInput {
  runId: string;
  projectId: string;
  userId: string;
  project: ProjectRef;
  aspect: string;
  provider: { baseUrl: string; apiKey: string; model: string; contextWindow: number; supportsVision: boolean };
  /** the already persisted user message; `parts` is what the model sees (may include images) */
  userMessage: { rowid: number; text: string; parts: OpenAI.Chat.Completions.ChatCompletionContentPart[] | null };
  elevenKey: () => string | null;
  secrets: string[];
  signal: AbortSignal;
  bus: RunBus;
  askUser: (question: string, options: string[]) => Promise<string>;
  maxSteps?: number;
}

export interface RunOutcome {
  stopReason: StopReason;
  usage: { input: number; output: number };
  finalText: string;
}

type Flags = { noStreamOptions?: boolean; noMaxTokens?: boolean };
const providerFlags = new Map<string, Flags>();

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true });
  });

function isRetryable(e: unknown): boolean {
  if (e instanceof OpenAI.APIUserAbortError) return false;
  if (e instanceof OpenAI.APIError && typeof e.status === 'number') return [408, 409, 425, 429, 500, 502, 503, 504, 520, 521, 522, 524, 529].includes(e.status);
  if (e instanceof OpenAI.APIConnectionError) return true;
  return /terminated|ECONNRESET|ETIMEDOUT|socket hang up|fetch failed|stream.*(ended|closed)|UND_ERR/i.test((e as Error).message ?? '');
}

function friendlyError(e: unknown, secrets: string[]): string {
  if (e instanceof OpenAI.APIError) {
    if (e.status === 401 || e.status === 403) return 'The model provider rejected your API key (401/403). Check the key in Settings → Models.';
    if (e.status === 402) return 'The model provider says your account is out of credit (402). Top it up or pick another model.';
    if (e.status === 404) return 'The model provider could not find that model or URL (404). Check Settings → Models.';
    if (e.status === 429) return 'The model provider is rate limiting you (429). Wait a bit, then ask me to continue.';
    if (e.status === 400 && /context|token.*(limit|exceed)|too long|maximum/i.test(e.message)) return 'The conversation no longer fits the model’s context window. Start a fresh request or pick a model with a longer context.';
    return redactSecrets(`The model provider returned an error${e.status ? ` (${e.status})` : ''}: ${e.message}`, secrets).slice(0, 500);
  }
  return redactSecrets(`Could not reach the model provider: ${(e as Error).message}`, secrets).slice(0, 500);
}

const shorten = (s: string, n: number) => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? one.slice(0, n - 1) + '…' : one;
};

export async function runAgent(deps: AgentDeps, input: RunInput): Promise<RunOutcome> {
  const { db, sqlite } = deps;
  const { bus, signal, project } = input;
  const store = new ConvoStore(sqlite, input.projectId);
  const client = makeClient({ baseUrl: input.provider.baseUrl, apiKey: input.provider.apiKey });
  const flagKey = `${input.provider.baseUrl}|${input.provider.model}`;
  const flags: Flags = providerFlags.get(flagKey) ?? {};
  providerFlags.set(flagKey, flags);

  const usage = { input: 0, output: 0 };
  let memory = store.memory();
  let rows: StoredMessage[] = store.load(memory?.uptoRowid ?? 0);
  /** in-memory-only versions of messages (real image parts); persisted rows hold text-only stand-ins */
  const live = new Map<number, ChatMessage>();
  if (input.userMessage.parts) live.set(input.userMessage.rowid, { role: 'user', content: input.userMessage.parts });

  const systemFor = (mem: string | null): ChatMessage => {
    const custom = getAgentPrompt(db, input.userId);
    const vars = { aspect: input.aspect, brandSummary: brandSummary(project), attachmentsSummary: attachmentsSummary(db, input.projectId) };
    const luma = buildSystemPrompt(vars);
    const base = !custom
      ? luma
      : custom.mode === 'replace'
        ? `${fillPromptVars(custom.text, vars)}\n\n(You work inside Luma Studio. Your tools are listed in the tool definitions; read_guide gives the engine docs and API.)`
        : `${luma}\n\n## The student's own instructions (from Settings → Agent; follow them unless they break the engine contract)\n${custom.text}`;
    const overrides = describeOverrides(getVoicePrefs(db, input.userId));
    const voiceLine = `\nVoice settings from the student: ${overrides ? `${overrides} (these override your choice automatically)` : 'none — you choose the voice and model (list_voices)'}. ElevenLabs key: ${input.elevenKey() ? 'saved' : 'NOT saved — use generate_voice placeholder:true and tell the student to add it in Settings → Voice'}.`;
    const lessons = lessonsForPrompt(db);
    return { role: 'system', content: `${base}${lessons ? `\n\n${lessons}` : ''}\n\n## Current project state\n${projectFacts(db, project)}${voiceLine}${mem ? `\n\n## Project memory (summary of earlier work)\n${mem}` : ''}` };
  };
  let system = systemFor(memory?.summary ?? null);
  const messages = () => [system, ...rows.map((r) => live.get(r.rowid) ?? r.msg)];

  const tools = toolDefinitions();
  const maxSteps = input.maxSteps ?? config.agentMaxSteps;
  const delays = deps.retryDelaysMs ?? [1000, 4000, 12000];
  let stopReason: StopReason = 'completed';
  let finalText = '';
  let nudges = 0;
  let forceCompact: { keep?: string } | null = null;

  const persist = (msg: ChatMessage, stored: ChatMessage = msg, internal = false): StoredMessage => {
    const row = store.add(stored, null, internal);
    rows.push(row);
    if (stored !== msg) live.set(row.rowid, msg);
    return row;
  };

  try {
    for (let step = 1; step <= maxSteps; step++) {
      if (signal.aborted) {
        stopReason = 'stopped';
        break;
      }

      // ---- keep the context inside the model's window ----
      const compacted = await compactIfNeeded(system, rows, memory?.summary ?? null, { client, model: input.provider.model, contextWindow: input.provider.contextWindow, store, project, signal, ...(forceCompact ? { force: forceCompact } : {}) });
      forceCompact = null;
      if (compacted) {
        rows = compacted.rows;
        memory = { summary: compacted.memory, uptoRowid: 0 };
        system = systemFor(compacted.memory);
        const plan = readPlan(project);
        if (plan.length) bus.emit('plan.updated', { items: plan }); // keep the pinned plan after a context reset
      }

      // ---- one model call (with retries) ----
      let turn: AssistantTurn | null = null;
      for (let attempt = 0; ; attempt++) {
        try {
          const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
            model: input.provider.model,
            messages: messages(),
            tools: tools as OpenAI.Chat.Completions.ChatCompletionTool[],
            tool_choice: 'auto',
            stream: true,
            ...(flags.noStreamOptions ? {} : { stream_options: { include_usage: true } }),
            ...(flags.noMaxTokens ? {} : { max_tokens: Math.min(32000, Math.max(4096, Math.floor(input.provider.contextWindow * 0.15))) }),
          };
          const stream = await client.chat.completions.create(params, { signal });
          turn = await collectTurn(
            stream,
            { onContent: (text) => bus.delta('message.delta', { text }), onReasoning: (text) => bus.delta('reasoning.delta', { text }) },
            signal,
          );
          break;
        } catch (e) {
          if (signal.aborted) break;
          if (e instanceof OpenAI.APIError && e.status === 400) {
            if (/stream_options/i.test(e.message) && !flags.noStreamOptions) {
              flags.noStreamOptions = true;
              continue;
            }
            if (/max_(completion_)?tokens/i.test(e.message) && !flags.noMaxTokens) {
              flags.noMaxTokens = true;
              continue;
            }
          }
          if (isRetryable(e) && attempt < delays.length) {
            bus.flushDeltas();
            bus.emit('run.error', { message: `The model connection hiccuped — retrying (${attempt + 1}/${delays.length})…`, retryable: true });
            await sleep(delays[attempt]!, signal);
            continue;
          }
          bus.flushDeltas();
          bus.emit('run.error', { message: friendlyError(e, input.secrets), retryable: isRetryable(e) });
          stopReason = 'error';
          return finish();
        }
      }
      bus.flushDeltas();
      if (signal.aborted || !turn) {
        if (turn && (turn.content || turn.toolCalls.length)) persistTurn(turn);
        stopReason = 'stopped';
        break;
      }

      usage.input += turn.usage?.input ?? 0;
      usage.output += turn.usage?.output ?? Math.ceil((turn.content.length + turn.reasoning.length) / 3.2);
      persistTurn(turn);
      if (turn.content) finalText = turn.content;

      // ---- no tool calls: the model is done (or needs a nudge) ----
      if (!turn.toolCalls.length) {
        if (!turn.content.trim() && nudges < 2) {
          nudges++;
          persist({ role: 'user', content: 'Your last reply was empty. Continue: call a tool, or give your final answer.' }, undefined, true);
          continue;
        }
        stopReason = 'completed';
        break;
      }

      // ---- run the tools, one at a time ----
      const images: ImagePart[] = [];
      for (const call of turn.toolCalls) {
        if (signal.aborted) {
          persist({ role: 'tool', tool_call_id: call.id, content: 'Stopped by the student before this tool ran.' });
          continue;
        }
        bus.emit('tool.call', { callId: call.id, name: call.name, args: safeJson(redactSecrets(call.arguments, input.secrets)) });
        const { result } = await runTool(call.name, call.arguments, {
          db,
          runId: input.runId,
          projectId: input.projectId,
          userId: input.userId,
          project,
          bus,
          signal,
          callId: call.id,
          secrets: input.secrets,
          supportsVision: input.provider.supportsVision,
          cpu: deps.cpu,
          render: deps.render,
          elevenKey: input.elevenKey,
          askUser: input.askUser,
          requestCompaction: (keep) => { forceCompact = { keep }; },
        });
        bus.flushDeltas();
        inc('luma_tool_calls_total', { tool: call.name, ok: result.ok ? 'true' : 'false' }, 1, 'Agent tool calls');
        const content = truncateMiddle(redactSecrets(result.content, input.secrets), 30_000);
        bus.emit('tool.result', { callId: call.id, ok: result.ok, summary: redactSecrets(result.summary, input.secrets), truncated: !!result.truncated || content.truncated });
        persist({ role: 'tool', tool_call_id: call.id, content: content.text });
        if (result.images) images.push(...result.images);
      }

      // images can't travel inside tool messages: deliver them as a user message (vision models only)
      if (images.length && input.provider.supportsVision && !signal.aborted) {
        for (const [rowid, m] of live) if (rowid !== input.userMessage.rowid && (m as { role: string }).role === 'user') live.delete(rowid); // older screenshots are stale
        const parts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [{ type: 'text', text: 'Images from the tool results above:' }];
        for (const img of images) {
          parts.push({ type: 'text', text: `(${img.label})` }, { type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.base64}` } });
        }
        persist({ role: 'user', content: parts }, { role: 'user', content: `[Images from the tool results: ${images.map((i) => i.label).join(', ')}]` }, true);
      }

      if (usage.output > config.agentMaxOutputTokens) {
        stopReason = 'max_tokens';
        break;
      }
      if (step === maxSteps) stopReason = 'max_steps';
    }
  } catch (e) {
    if (signal.aborted) stopReason = 'stopped';
    else {
      bus.flushDeltas();
      bus.emit('run.error', { message: friendlyError(e, input.secrets), retryable: false });
      stopReason = 'error';
    }
  }
  return finish();

  // ---------------------------------------------------------------------------

  function persistTurn(turn: AssistantTurn): StoredMessage {
    const msg: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = { role: 'assistant', content: turn.content || null };
    if (turn.toolCalls.length) {
      msg.tool_calls = turn.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments || '{}' } }));
    }
    return persist(msg);
  }

  function finish(): RunOutcome {
    forgetRun(input.runId);
    bus.flushDeltas();
    // every tool call must have an answer, or the next request to the provider would be rejected
    closeDanglingToolCalls();
    try {
      const msg = shorten(finalText || input.userMessage.text, 72);
      const c = commitAll(project, msg || 'Luma turn');
      if (c) bus.emit('git.commit', { sha: c.sha, message: c.message, files: c.files });
    } catch (e) {
      bus.emit('run.error', { message: `Could not save a history snapshot: ${(e as Error).message}`, retryable: false });
    }
    return { stopReason, usage, finalText };
  }

  function closeDanglingToolCalls() {
    const answered = new Set(rows.filter((r) => (r.msg as { role: string }).role === 'tool').map((r) => (r.msg as { tool_call_id: string }).tool_call_id));
    for (const r of [...rows]) {
      const m = r.msg as { role: string; tool_calls?: Array<{ id: string }> };
      if (m.role !== 'assistant') continue;
      for (const c of m.tool_calls ?? []) {
        if (!answered.has(c.id)) {
          persist({ role: 'tool', tool_call_id: c.id, content: 'Stopped by the student before this tool ran.' });
          answered.add(c.id);
        }
      }
    }
  }
}

function safeJson(s: string): unknown {
  try {
    return s.trim() ? JSON.parse(s) : {};
  } catch {
    return { _raw: s.slice(0, 2000) };
  }
}

function readPlan(project: ProjectRef): Array<{ text: string; status: 'todo' | 'doing' | 'done' }> {
  try {
    return JSON.parse(fs.readFileSync(`${project.dir}/.luma/plan.json`, 'utf8'));
  } catch {
    return [];
  }
}
