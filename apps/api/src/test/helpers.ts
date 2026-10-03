import { execFileSync } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { RunRegistry } from '../agent/registry.js';
import { buildApp } from '../app.js';
import { createDb, runMigrations } from '../db/index.js';

export async function makeTestApp(opts: { agent?: boolean } = {}) {
  const { db, sqlite } = createDb(':memory:');
  runMigrations(db);
  const agent = opts.agent ? new RunRegistry({ db, sqlite, retryDelaysMs: [10, 10, 10] }, sqlite) : undefined;
  const app = await buildApp({ db, sqlite, agent });
  await app.ready();
  return { app, db, sqlite, agent };
}

/** A tiny cookie-jar client around app.inject that remembers the session and CSRF token. */
export class Client {
  cookie = '';
  csrf = '';
  constructor(readonly app: FastifyInstance) {}

  async request(method: string, url: string, opts: { body?: unknown; headers?: Record<string, string>; payload?: Buffer | string; query?: Record<string, string> } = {}) {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (this.cookie) headers.cookie = this.cookie;
    if (this.csrf && method !== 'GET') headers['x-csrf-token'] = this.csrf;
    const res = await this.app.inject({ method: method as 'GET', url, headers, payload: (opts.body ?? opts.payload) as never, query: opts.query });
    const set = res.headers['set-cookie'];
    for (const c of Array.isArray(set) ? set : set ? [set] : []) {
      const [pair] = c.split(';');
      if (pair!.endsWith('=')) this.cookie = '';
      else this.cookie = pair!;
    }
    let json: any;
    try {
      json = res.json();
    } catch { /* not json */ }
    return { status: res.statusCode, json, body: res.body, headers: res.headers, raw: res };
  }
  get = (url: string, query?: Record<string, string>) => this.request('GET', url, { query });
  post = (url: string, body?: unknown) => this.request('POST', url, { body: body ?? {} });
  patch = (url: string, body?: unknown) => this.request('PATCH', url, { body: body ?? {} });
  put = (url: string, body?: unknown) => this.request('PUT', url, { body: body ?? {} });
  del = (url: string) => this.request('DELETE', url);

  async signup(email: string, password = 'correct horse battery') {
    const r = await this.post('/api/auth/signup', { email, password });
    if (r.status === 201) this.csrf = r.json.csrfToken;
    return r;
  }
  async login(email: string, password = 'correct horse battery') {
    const r = await this.post('/api/auth/login', { email, password });
    if (r.status === 200) this.csrf = r.json.csrfToken;
    return r;
  }
}

// ---------------------------------------------------------------------------
// Mock OpenAI-compatible server (chat.completions with SSE streaming, tools, vision, reasoning)
// ---------------------------------------------------------------------------

export type MockTurn = { content?: string; reasoning?: string; toolCalls?: Array<{ name: string; args: unknown; rawArgs?: string; id?: string }>; status?: number; message?: string };

export interface MockLlmOptions {
  tools?: boolean; // false -> 400 "tools are not supported"
  vision?: boolean; // false -> 400 on image content
  reasoning?: boolean; // stream reasoning_content deltas
  apiKey?: string; // required bearer key
  /** custom behaviour per request: return the assistant turn to stream */
  script?: (body: any, n: number) => MockTurn | null;
}

export async function startMockLlm(opts: MockLlmOptions = {}) {
  const o = { tools: true, vision: true, reasoning: false, apiKey: 'sk-test-key-123456', ...opts };
  const requests: any[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (req.headers.authorization !== `Bearer ${o.apiKey}`) {
        res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'Incorrect API key provided', type: 'invalid_request_error' } }));
        return;
      }
      if (!req.url?.endsWith('/chat/completions')) return void res.writeHead(404).end('{}');
      const body = JSON.parse(raw);
      requests.push(body);
      const hasImage = JSON.stringify(body.messages).includes('image_url');
      if (body.tools && !o.tools) return void res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'tools are not supported by this model' } }));
      if (hasImage && !o.vision) return void res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'image input is not supported' } }));

      const scripted = o.script?.(body, requests.length);
      if (scripted?.status) return void res.writeHead(scripted.status, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: scripted.message ?? 'scripted failure' } }));
      const turn: MockTurn = scripted ?? (body.tools ? { content: undefined, toolCalls: [{ name: body.tools[0].function.name, args: {} }], reasoning: o.reasoning ? 'thinking about it…' : undefined } : { content: 'red', reasoning: o.reasoning ? 'looking…' : undefined });

      if (!body.stream) {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
          id: 'cmpl-1', object: 'chat.completion', model: body.model,
          choices: [{ index: 0, finish_reason: turn.toolCalls?.length ? 'tool_calls' : 'stop', message: { role: 'assistant', content: turn.content ?? null, tool_calls: turn.toolCalls?.map((t, i) => ({ id: t.id ?? `call_${requests.length}_${i}`, type: 'function', function: { name: t.name, arguments: t.rawArgs ?? JSON.stringify(t.args) } })) } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const send = (delta: object, finish: string | null = null, extra: object = {}) =>
        res.write(`data: ${JSON.stringify({ id: 'cmpl-1', object: 'chat.completion.chunk', model: body.model, choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`);
      send({ role: 'assistant', content: '' });
      if (turn.reasoning) for (const part of turn.reasoning.match(/.{1,6}/g) ?? []) send({ reasoning_content: part });
      if (turn.content) for (const part of turn.content.match(/.{1,5}/gs) ?? []) send({ content: part });
      turn.toolCalls?.forEach((t, i) => {
        const args = t.rawArgs ?? JSON.stringify(t.args);
        send({ tool_calls: [{ index: i, id: t.id ?? `call_${requests.length}_${i}`, type: 'function', function: { name: t.name, arguments: '' } }] });
        for (const part of args.match(/.{1,7}/gs) ?? ['']) send({ tool_calls: [{ index: i, function: { arguments: part } }] });
      });
      send({}, turn.toolCalls?.length ? 'tool_calls' : 'stop', { usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 } });
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}/v1`, apiKey: o.apiKey, requests, close: () => new Promise<void>((r) => server.close(() => r())) };
}

/** Mock of ElevenLabs GET /v1/user */
export async function startMockEleven(validKey = 'xi-valid-key-123') {
  const calls: Array<{ url: string; text?: string }> = [];
  const server = http.createServer((req, res) => {
    if (req.headers['xi-api-key'] !== validKey) return void res.writeHead(401, { 'content-type': 'application/json' }).end('{"detail":"invalid"}');
    if (req.url === '/v1/user') {
      return void res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ subscription: { tier: 'creator', character_count: 100, character_limit: 100000 } }));
    }
    if (req.url?.includes('/with-timestamps')) {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const j = JSON.parse(raw);
        calls.push({ url: req.url!, text: j.text });
        const chars = [...(j.text as string)];
        const audio = execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', String(chars.length * 0.05), '-c:a', 'libmp3lame', '-b:a', '64k', '-f', 'mp3', '-'], { maxBuffer: 1 << 24 });
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
          audio_base64: audio.toString('base64'),
          alignment: { characters: chars, character_start_times_seconds: chars.map((_, i) => i * 0.05), character_end_times_seconds: chars.map((_, i) => (i + 1) * 0.05) },
        }));
      });
      return;
    }
    res.writeHead(404).end('{}');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, calls, close: () => new Promise<void>((r) => server.close(() => r())) };
}
