// "Which models does this key have?" — the provider's OpenAI-compatible GET /models, so the student can pick one
// instead of typing an id. Not every provider has it; then the student types the model id themselves.
import OpenAI from 'openai';
import { redactSecrets } from '../security/redact.js';
import { makeClient } from './client.js';

export interface AvailableModel {
  id: string;
  name?: string;
  contextWindow?: number;
}

export async function listAvailableModels(baseUrl: string, apiKey: string): Promise<{ models: AvailableModel[]; error?: string }> {
  try {
    const client = makeClient({ baseUrl, apiKey, timeoutMs: 20_000 });
    const out: AvailableModel[] = [];
    for await (const m of client.models.list()) {
      const x = m as unknown as { id: string; name?: string; context_length?: number; context_window?: number };
      out.push({ id: x.id, ...(x.name ? { name: x.name } : {}), ...(x.context_length || x.context_window ? { contextWindow: x.context_length ?? x.context_window } : {}) });
      if (out.length >= 1000) break;
    }
    out.sort((a, b) => a.id.localeCompare(b.id));
    return { models: out };
  } catch (e) {
    if (e instanceof OpenAI.APIError && (e.status === 401 || e.status === 403)) return { models: [], error: 'The provider rejected the API key.' };
    if (e instanceof OpenAI.APIError && e.status === 404) return { models: [], error: 'This provider does not list its models — type the model id.' };
    return { models: [], error: redactSecrets(`Could not load the model list: ${(e as Error).message}`, [apiKey]).slice(0, 300) };
  }
}
