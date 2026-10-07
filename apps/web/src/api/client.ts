import type { RunEvent } from '@luma/shared';
import type {
  CommitDetail, CommitSummary, ProjectFile, TerminalEntry, ConversationMessage, ModelConfig, Project, RenderRecord, RunInfo, TestResult, TreeEntry, UploadRecord, User, VoicePrefs, VoiceSettings, ReasoningEffort,
} from './types';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

let csrf = '';
export const setCsrf = (t: string) => {
  csrf = t;
};

async function request<T>(method: string, url: string, body?: unknown, form?: FormData): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && csrf) headers['x-csrf-token'] = csrf;
  const res = await fetch(url, { method, headers, credentials: 'same-origin', body: form ?? (body !== undefined ? JSON.stringify(body) : undefined) });
  if (!res.ok) {
    let code = 'error';
    let message = res.statusText || 'Request failed';
    try {
      const j = await res.json();
      code = j.error?.code ?? code;
      message = j.error?.message ?? message;
    } catch { /* not json */ }
    throw new ApiError(res.status, code, message);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
const get = <T>(url: string) => request<T>('GET', url);
export interface AgentPromptSettings {
  prompt: { mode: 'append' | 'replace'; text: string } | null;
  prefs: { frameChecks: 'full' | 'light' | 'off' };
  defaultPrompt: string;
}

interface Sales { amountBdt: number; orders: number; hours: number }
export interface AdminOverview {
  now: number;
  renders: {
    running: number;
    queued: number;
    active: Array<{ id: string; status: string; pool: string; preset: string; progress: number; user: string; project: string; startedAt: number | null; createdAt: number; worker: string | null }>;
    last24h: { done: number; failed: number; freeHours: number; fastHours: number };
    totalDone: number;
    failedRecent: Array<{ id: string; user: string; project: string; error: string; at: number | null }>;
  };
  agents: { running: number; runsLast24h: number };
  cpu: { usage: number; budget: number; running: number; queued: number; maxSlots: number } | null;
  workers: Array<{ id: string; name: string; disabled: boolean; online: boolean; lastSeenAt: number | null }>;
  sales: {
    today: Sales; last7d: Sales; last30d: Sales; allTime: Sales;
    pending: number; failed: number; fastHoursOutstanding: number; paymentsEnabled: boolean; pricePerHourBdt: number;
    addonsSold: { api: number; source: number };
    recent: Array<{ id: string; user: string; item: string; hours: number; amountBdt: number; status: string; provider: string; method: string | null; invoice: string | null; trxId: string | null; createdAt: number; paidAt: number | null }>;
  };
  users: { total: number; banned: number; new7d: number; active24h: number };
  projects: { total: number };
  disk: { totalBytes: number; freeBytes: number } | null;
}
export interface AdminUser { id: string; email: string; banned: boolean; createdAt: number; projects: number; freeSecondsUsed24h: number; fastSecondsLeft: number; spentBdt: number; addons: Array<'api' | 'source'> }

export interface Addon { id: 'api' | 'source'; name: string; description: string; priceBdt: number; owned: boolean; paymentsEnabled: boolean; whatsapp?: string }
export interface ApiKeyInfo { id: string; name: string; prefix: string; createdAt: number; lastUsedAt: number | null }
export type FeedbackStatus = 'new' | 'reviewed' | 'in_progress' | 'done' | 'declined';
export interface FeedbackItem { id: string; kind: 'bug' | 'suggestion'; title: string; body: string; status: FeedbackStatus; adminNote: string | null; screenshots: string[]; createdAt: number; updatedAt: number | null; user?: string }

export interface RenderQuotas {
  freeRender: { secondsPerDay: number | null; secondsLeft: number | null };
  fastRender: { pricePerHourBdt: number; maxHours: number; secondsLeft: number; paymentsEnabled: boolean };
}

const post = <T>(url: string, body: unknown = {}) => request<T>('POST', url, body);
const patch = <T>(url: string, body: unknown) => request<T>('PATCH', url, body);
const put = <T>(url: string, body: unknown) => request<T>('PUT', url, body);
const del = <T>(url: string) => request<T>('DELETE', url);
const qs = (o: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

export const api = {
  // ---- auth ----
  me: () => get<{ user: User | null; csrfToken?: string }>('/api/auth/me'),
  authConfig: () => get<{ signupEnabled: boolean; captchaSiteKey: string | null }>('/api/auth/config'),
  signup: (email: string, password: string, captcha?: string) => post<{ user: User; csrfToken: string }>('/api/auth/signup', { email, password, captcha }),
  usage: () => get<{ usage: { diskBytes: number; diskLimitBytes: number | null } & RenderQuotas }>('/api/usage'),
  previewReport: (id: string, b: { status: 'ready' | 'error' | 'empty'; message?: string; duration?: number }) => post<{ ok: true }>(`/api/projects/${id}/preview-report`, b),
  // ---- add-ons, API keys, improvements ----
  addons: () => get<{ addons: Addon[] }>('/api/billing/addons'),
  buyAddon: (id: string, b: { phone: string; returnTo: string }) => post<{ paymentUrl: string }>(`/api/billing/addons/${id}`, b),
  apiKeys: () => get<{ hasAddon: boolean; keys: ApiKeyInfo[] }>('/api/settings/api-keys'),
  createApiKey: (name: string) => post<ApiKeyInfo & { key: string }>('/api/settings/api-keys', { name }),
  revokeApiKey: (id: string) => del<{ ok: true }>(`/api/settings/api-keys/${id}`),
  myFeedback: () => get<{ items: FeedbackItem[] }>('/api/feedback'),
  sendFeedback: (form: FormData) => request<{ item: FeedbackItem }>('POST', '/api/feedback', undefined, form),
  adminFeedback: (status?: string) => get<{ items: FeedbackItem[] }>(`/api/admin/feedback${qs({ status })}`),
  adminUpdateFeedback: (id: string, b: { status?: string; adminNote?: string | null }) => patch<{ item: FeedbackItem }>(`/api/admin/feedback/${id}`, b),
  adminGrantAddon: (id: string, addon: 'api' | 'source') => post<{ ok: true }>(`/api/admin/users/${id}/grant-addon`, { addon }),
  // ---- admin (ADMIN_EMAILS only) ----
  adminOverview: () => get<AdminOverview>('/api/admin/overview'),
  adminUsers: (q: string) => get<{ users: AdminUser[] }>(`/api/admin/users${qs({ q: q || undefined })}`),
  adminGrantHours: (id: string, hours: number) => post<{ ok: true }>(`/api/admin/users/${id}/grant-hours`, { hours }),
  adminBan: (id: string, banned: boolean) => post<{ ok: true }>(`/api/admin/users/${id}/ban`, { banned }),
  adminCheckPayment: (invoice: string) => post<{ status: string }>(`/api/admin/payments/${invoice}/check`),
  buyRenderHours: (b: { hours: number; phone: string; returnTo: string }) => post<{ paymentUrl: string; invoiceNumber: string; priceBdt: number }>('/api/billing/render-hours', b),
  login: (email: string, password: string) => post<{ user: User; csrfToken: string }>('/api/auth/login', { email, password }),
  logout: () => post<{ ok: true }>('/api/auth/logout'),
  changePassword: (currentPassword: string, newPassword: string) => post<{ ok: true }>('/api/auth/password', { currentPassword, newPassword }),

  // ---- projects ----
  projects: () => get<{ projects: Project[] }>('/api/projects'),
  project: (id: string) => get<{ project: Project }>(`/api/projects/${id}`),
  createProject: (title: string, aspect: string) => post<{ project: Project }>('/api/projects', { title, aspect }),
  renameProject: (id: string, title: string) => patch<{ project: Project }>(`/api/projects/${id}`, { title }),
  deleteProject: (id: string) => del<{ ok: true }>(`/api/projects/${id}`),
  previewToken: (id: string) => post<{ url: string; expiresAt: number }>(`/api/projects/${id}/preview-token`),
  tree: (id: string, path = '.', depth = 4) => get<{ entries: TreeEntry[] }>(`/api/projects/${id}/tree${qs({ path, depth })}`),
  file: (id: string, path: string) =>
    get<ProjectFile>(`/api/projects/${id}/file${qs({ path })}`),
  /** Bytes of a project file (previews, downloads). `v` busts the cache when the agent changed things. */
  rawUrl: (id: string, path: string, v = 0, download = false) => `/api/projects/${id}/raw${qs({ path, v: v || undefined, download: download ? '1' : undefined })}`,

  // ---- history ----
  gitLog: (id: string, limit = 50, skip = 0) => get<{ commits: CommitSummary[] }>(`/api/projects/${id}/git/log${qs({ limit, skip })}`),
  gitCommit: (id: string, sha: string) => get<{ commit: CommitDetail }>(`/api/projects/${id}/git/commits/${sha}`),
  gitRestore: (id: string, sha: string) => post<{ commit: unknown; unchanged: boolean }>(`/api/projects/${id}/git/restore`, { sha }),

  // ---- agent ----
  startRun: (id: string, message: string, attachmentIds: string[], providerId?: string, frames: number[] = []) =>
    post<{ runId: string; messageId: string }>(`/api/projects/${id}/runs`, { message, attachmentIds, providerId, ...(frames.length ? { frames } : {}) }),
  runs: (id: string) => get<{ runs: RunInfo[] }>(`/api/projects/${id}/runs`),
  activeRun: (id: string) => get<{ run: { id: string; awaitingAnswer: string | null } | null }>(`/api/projects/${id}/active-run`),
  messages: (id: string) => get<{ messages: ConversationMessage[] }>(`/api/projects/${id}/messages`),
  runEvents: (id: string, runId: string, after = 0) => get<{ run: RunInfo; events: RunEvent[] }>(`/api/projects/${id}/runs/${runId}/events.json${qs({ after })}`),
  stopRun: (id: string, runId: string) => post<{ ok: boolean }>(`/api/projects/${id}/runs/${runId}/stop`),
  answer: (id: string, runId: string, answer: string) => post<{ ok: true }>(`/api/projects/${id}/runs/${runId}/answer`, { answer }),
  terminal: (id: string) => get<{ entries: TerminalEntry[] }>(`/api/projects/${id}/terminal`),
  captureFrame: (id: string, t: number) => post<{ url: string }>(`/api/projects/${id}/capture`, { t }),

  // ---- uploads ----
  uploads: (id: string, pending = false) => get<{ uploads: Array<UploadRecord & { projectId: string }> }>(`/api/projects/${id}/uploads${pending ? '?pending=1' : ''}`),
  deleteFile: (id: string, path: string) => del<{ ok: true; path: string }>(`/api/projects/${id}/file${qs({ path })}`),
  upload: (id: string, files: File[], direct = false) => {
    const fd = new FormData();
    for (const f of files) fd.append('file', f, f.name);
    return request<{ uploads: UploadRecord[] }>('POST', `/api/projects/${id}/uploads${direct ? '?direct=1' : ''}`, undefined, fd);
  },
  deleteUpload: (id: string, uploadId: string) => del<{ ok: true }>(`/api/projects/${id}/uploads/${uploadId}`),

  // ---- renders ----
  renders: (id: string) => get<{ renders: RenderRecord[] }>(`/api/projects/${id}/renders`),

  // ---- settings ----
  models: () => get<{ models: ModelConfig[] }>('/api/settings/models'),
  addModel: (m: { name: string; baseUrl: string; apiKey: string; model: string; contextWindow?: number; reasoningEffort?: ReasoningEffort | null; thinkingBudget?: number | null }) => post<{ model: ModelConfig }>('/api/settings/models', m),
  availableModels: (b: { baseUrl: string; apiKey?: string; id?: string }) => post<{ models: Array<{ id: string; name?: string; contextWindow?: number }>; error?: string }>('/api/settings/models/available', b),
  updateModel: (id: string, m: Partial<{ name: string; baseUrl: string; apiKey: string; model: string; contextWindow: number; isDefault: boolean; reasoningEffort: ReasoningEffort | null; thinkingBudget: number | null }>) =>
    patch<{ model: ModelConfig }>(`/api/settings/models/${id}`, m),
  deleteModel: (id: string) => del<{ ok: true }>(`/api/settings/models/${id}`),
  testModel: (id: string) => post<{ result: TestResult; model: ModelConfig }>(`/api/settings/models/${id}/test`),
  testModelValues: (v: { baseUrl: string; apiKey: string; model: string }) => post<{ result: TestResult }>('/api/settings/models/test', v),
  voice: () => get<VoiceSettings>('/api/settings/voice'),
  saveVoice: (v: { apiKey?: string; prefs?: Partial<VoicePrefs> }) => put<VoiceSettings>('/api/settings/voice', v),
  deleteVoiceKey: () => del<{ ok: true }>('/api/settings/voice/key'),
  agentPrompt: () => get<AgentPromptSettings>('/api/settings/agent'),
  saveAgentPrefs: (p: { frameChecks: 'full' | 'light' | 'off' }) => put<AgentPromptSettings>('/api/settings/agent/prefs', p),
  saveAgentPrompt: (p: { mode: 'append' | 'replace'; text: string } | null) => put<AgentPromptSettings>('/api/settings/agent', p),
  testVoice: () => post<{ ok: boolean; error?: string; tier?: string | null; charactersUsed?: number | null; characterLimit?: number | null; note?: string }>('/api/settings/voice/test'),
};

/** Opens the live event stream of a run; resumes from `after` and reconnects with Last-Event-ID semantics. */
export function openRunStream(projectId: string, runId: string, after: number, onEvent: (e: RunEvent) => void, onDone: () => void): () => void {
  let last = after;
  let closed = false;
  let es: EventSource | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const connect = () => {
    es = new EventSource(`/api/projects/${projectId}/runs/${runId}/events?after=${last}`);
    es.onmessage = () => {}; // typed events below
    const types = [
      'run.started', 'reasoning.delta', 'message.delta', 'plan.updated', 'tool.call', 'tool.output.delta', 'tool.result', 'file.changed', 'voice.ready',
      'preview.frames', 'render.queued', 'render.progress', 'render.done', 'ask_user', 'billing.offer', 'git.commit', 'run.error', 'run.finished',
    ];
    for (const t of types) {
      es.addEventListener(t, (m) => {
        const e = JSON.parse((m as MessageEvent).data) as RunEvent;
        if (e.id <= last) return;
        last = e.id;
        onEvent(e);
        if (e.type === 'run.finished') {
          closed = true;
          es?.close();
          onDone();
        }
      });
    }
    es.onerror = () => {
      es?.close();
      if (!closed) retry = setTimeout(connect, 1500); // resume from the last event we saw
    };
  };
  connect();
  return () => {
    closed = true;
    clearTimeout(retry);
    es?.close();
  };
}
