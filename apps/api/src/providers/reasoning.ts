// Thinking controls per provider. Students pick a reasoning effort (none … xhigh) and/or a thinking budget in
// tokens; each provider spells that differently in its OpenAI-compatible API. Unknown providers get the common
// `reasoning_effort`. If a provider rejects the parameters, the agent loop drops them for that model (once) and
// carries on — so the setting can never break a run.
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export function reasoningParams(baseUrl: string, effort: ReasoningEffort | null, budget: number | null): Record<string, unknown> {
  if (!effort && budget == null) return {};
  let host = '';
  try {
    host = new URL(baseUrl).host.toLowerCase();
  } catch { /* keep generic */ }

  // OpenRouter: one `reasoning` object for every upstream model
  if (host.endsWith('openrouter.ai')) {
    if (effort === 'none' || budget === 0) return { reasoning: { enabled: false } };
    if (budget) return { reasoning: { max_tokens: budget } };
    return { reasoning: { effort: effort === 'xhigh' ? 'high' : effort } };
  }
  // Anthropic's OpenAI-compatible endpoint: extended thinking with a token budget
  if (host.endsWith('anthropic.com')) {
    if (effort === 'none' || budget === 0) return {};
    const tokens = budget ?? ({ minimal: 1024, low: 2048, medium: 8000, high: 16000, xhigh: 32000 } as const)[effort ?? 'medium'];
    return { thinking: { type: 'enabled', budget_tokens: Math.max(1024, tokens) } };
  }
  // Qwen (DashScope / Alibaba Cloud): on/off + budget
  if (host.includes('dashscope') || host.includes('aliyuncs')) {
    if (effort === 'none' || budget === 0) return { enable_thinking: false };
    return { enable_thinking: true, ...(budget ? { thinking_budget: budget } : {}) };
  }
  // DeepSeek: thinking on/off (the effort level itself isn't adjustable)
  if (host.endsWith('deepseek.com')) {
    return { thinking: { type: effort === 'none' || budget === 0 ? 'disabled' : 'enabled' } };
  }
  // OpenAI, Gemini's OpenAI endpoint, Groq, xAI, Together, vLLM… — the common parameter
  const out: Record<string, unknown> = {};
  if (effort) out.reasoning_effort = effort;
  return out;
}

/** Does this provider error look like it doesn't accept the thinking parameters? */
export const rejectsReasoning = (message: string) => /reasoning|thinking|effort|budget|enable_thinking|unrecognized|unknown (field|parameter)|extra (fields|inputs)/i.test(message);
