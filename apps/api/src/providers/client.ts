import OpenAI from 'openai';
import { assertProviderUrl, safeFetch } from './safe-fetch.js';

/** An OpenAI-compatible client for a user's own endpoint. */
export function makeClient(opts: { baseUrl: string; apiKey: string; timeoutMs?: number }) {
  assertProviderUrl(opts.baseUrl);
  return new OpenAI({
    baseURL: opts.baseUrl.replace(/\/+$/, ''),
    apiKey: opts.apiKey,
    fetch: safeFetch,
    timeout: opts.timeoutMs ?? 120_000,
    maxRetries: 0,
  });
}
