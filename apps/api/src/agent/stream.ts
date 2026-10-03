// Turns a streamed chat completion into one assistant turn: text, reasoning and assembled tool calls.
import type OpenAI from 'openai';

export interface ToolCallPart {
  id: string;
  name: string;
  /** raw JSON text exactly as the model streamed it */
  arguments: string;
}

export interface AssistantTurn {
  content: string;
  reasoning: string;
  toolCalls: ToolCallPart[];
  finishReason: string | null;
  usage: { input: number; output: number } | null;
}

export interface StreamHandlers {
  onContent?: (text: string) => void;
  onReasoning?: (text: string) => void;
}

const REASONING_FIELDS = ['reasoning_content', 'reasoning'] as const;

/** Text of a reasoning delta from any of the shapes providers use (DeepSeek, OpenRouter, vLLM…). */
function reasoningText(delta: Record<string, unknown>): string {
  for (const f of REASONING_FIELDS) if (typeof delta[f] === 'string' && delta[f]) return delta[f] as string;
  const details = delta.reasoning_details;
  if (Array.isArray(details)) {
    return details.map((d) => (d && typeof d === 'object' ? ((d as Record<string, unknown>).text ?? (d as Record<string, unknown>).summary ?? '') : '')).filter((x) => typeof x === 'string').join('');
  }
  return '';
}

export async function collectTurn(stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>, h: StreamHandlers = {}, signal?: AbortSignal): Promise<AssistantTurn> {
  const turn: AssistantTurn = { content: '', reasoning: '', toolCalls: [], finishReason: null, usage: null };
  const calls = new Map<number, ToolCallPart>();
  for await (const chunk of stream) {
    if (signal?.aborted) break;
    if (chunk.usage) turn.usage = { input: chunk.usage.prompt_tokens ?? 0, output: chunk.usage.completion_tokens ?? 0 };
    const choice = chunk.choices?.[0];
    if (!choice) continue;
    const delta = (choice.delta ?? {}) as Record<string, unknown>;
    if (typeof delta.content === 'string' && delta.content) {
      turn.content += delta.content;
      h.onContent?.(delta.content);
    }
    const r = reasoningText(delta);
    if (r) {
      turn.reasoning += r;
      h.onReasoning?.(r);
    }
    for (const tc of (delta.tool_calls as OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta.ToolCall[] | undefined) ?? []) {
      // some providers omit `index` on single calls; some repeat the id on every chunk
      const idx = tc.index ?? (tc.id && [...calls.values()].findIndex((c) => c.id === tc.id) >= 0 ? [...calls.values()].findIndex((c) => c.id === tc.id) : calls.size);
      let cur = calls.get(idx);
      if (!cur) {
        cur = { id: tc.id ?? `call_${idx}_${Math.random().toString(36).slice(2, 8)}`, name: '', arguments: '' };
        calls.set(idx, cur);
      }
      if (tc.id && !cur.id) cur.id = tc.id;
      if (tc.function?.name) cur.name += tc.function.name;
      if (tc.function?.arguments) cur.arguments += tc.function.arguments;
    }
    if (choice.finish_reason) turn.finishReason = choice.finish_reason;
  }
  turn.toolCalls = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c);
  return turn;
}
