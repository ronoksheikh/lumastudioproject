import OpenAI from 'openai';
import { redactSecrets } from '../security/redact.js';
import { makeClient } from './client.js';

export interface TestResult {
  /** usable by Luma: reachable AND supports tool calling */
  ok: boolean;
  reachable: boolean;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsReasoningStream: boolean;
  latencyMs: number;
  error?: string;
  notes: string[];
}

// 1x1 red PNG
const RED_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const REASONING_KEYS = ['reasoning', 'reasoning_content', 'reasoning_details'] as const;

function describeError(err: unknown, apiKey: string): string {
  if (err instanceof OpenAI.APIError) {
    if (err.status === 401 || err.status === 403) return 'The provider rejected the API key (401/403). Check the key and the base URL.';
    if (err.status === 404) return 'The provider answered 404 — check the base URL (usually ends in /v1) and the model name.';
    if (err.status === 429) return 'The provider is rate limiting this key (429). Wait a moment and test again.';
    return redactSecrets(`Provider error ${err.status ?? ''}: ${err.message}`, [apiKey]).slice(0, 400);
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/EBLOCKED|private address/i.test(msg)) return 'That address is not reachable from the server (private or local).';
  if (/ENOTFOUND|EAI_AGAIN/i.test(msg)) return 'Could not find that host — check the base URL.';
  if (/ECONNREFUSED|ECONNRESET|fetch failed|terminated/i.test(msg)) return 'Could not connect to the provider — check the base URL.';
  if (/abort|timed? ?out/i.test(msg)) return 'The provider took too long to answer.';
  return redactSecrets(msg, [apiKey]).slice(0, 400);
}

/**
 * Connection test: (1) a tiny STREAMING completion with a dummy tool to detect tool-call support (and
 * whether reasoning deltas stream), (2) an image message to detect vision.
 */
export async function testProvider(cfg: { baseUrl: string; apiKey: string; model: string }): Promise<TestResult> {
  const t0 = Date.now();
  const res: TestResult = { ok: false, reachable: false, supportsTools: false, supportsVision: false, supportsReasoningStream: false, latencyMs: 0, notes: [] };
  let client: OpenAI;
  try {
    client = makeClient({ ...cfg, timeoutMs: 45_000 });
  } catch (e) {
    return { ...res, error: (e as Error).message };
  }

  // 1) tools + reasoning stream
  try {
    const stream = await client.chat.completions.create({
      model: cfg.model,
      stream: true,
      max_tokens: 300,
      tool_choice: 'auto',
      tools: [{ type: 'function', function: { name: 'get_time', description: 'Returns the current time.', parameters: { type: 'object', properties: {}, required: [] } } }],
      messages: [{ role: 'user', content: 'Call the get_time tool now. Do not answer in text.' }],
    });
    res.reachable = true;
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta as Record<string, unknown> | undefined;
      if (!delta) continue;
      if (Array.isArray(delta.tool_calls) && delta.tool_calls.length) res.supportsTools = true;
      if (REASONING_KEYS.some((k) => typeof delta[k] === 'string' ? (delta[k] as string).length > 0 : Array.isArray(delta[k]) && (delta[k] as unknown[]).length > 0)) res.supportsReasoningStream = true;
    }
    if (!res.supportsTools) res.notes.push('The model did not call the test tool. Luma needs a model with reliable tool calling.');
  } catch (e) {
    const msg = describeError(e, cfg.apiKey);
    if (e instanceof OpenAI.APIError && e.status === 400 && /tool/i.test(e.message)) {
      res.reachable = true;
      res.error = 'This model/provider does not support tool calling, which Luma needs.';
    } else res.error = msg;
    res.latencyMs = Date.now() - t0;
    return res;
  }

  // 2) vision
  try {
    // the provider accepted an image message without error -> it can see (we don't grade the answer)
    await client.chat.completions.create({
      model: cfg.model,
      max_tokens: 30,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'What colour is this image? Answer with one word.' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${RED_PNG}` } }] }],
    });
    res.supportsVision = true;
  } catch {
    res.supportsVision = false;
  }

  res.latencyMs = Date.now() - t0;
  res.ok = res.reachable && res.supportsTools;
  if (!res.ok && !res.error) res.error = 'The model answered, but it does not call tools reliably — pick a model with tool calling.';
  return res;
}
