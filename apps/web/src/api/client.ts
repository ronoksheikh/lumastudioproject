import type { RunEvent } from '@luma/shared';
import type {
  CommitDetail, CommitSummary, ProjectFile, TerminalEntry, ConversationMessage, ModelConfig, Project, RenderRecord, RunInfo, TestResult, TreeEntry, UploadRecord, User, VoicePrefs, VoiceSettings,
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
  usage: () => get<{ usage: { diskBytes: number; diskLimitBytes: number | null; renderSecondsToday: number; renderSecondsLimit: number | null } }>('/api/usage'),
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
  upload: (id: string, files: File[]) => {
    const fd = new FormData();
    for (const f of files) fd.append('file', f, f.name);
    return request<{ uploads: UploadRecord[] }>('POST', `/api/projects/${id}/uploads`, undefined, fd);
  },
  deleteUpload: (id: string, uploadId: string) => del<{ ok: true }>(`/api/projects/${id}/uploads/${uploadId}`),

  // ---- renders ----
  renders: (id: string) => get<{ renders: RenderRecord[] }>(`/api/projects/${id}/renders`),

  // ---- settings ----
  models: () => get<{ models: ModelConfig[] }>('/api/settings/models'),
  addModel: (m: { name: string; baseUrl: string; apiKey: string; model: string; contextWindow?: number }) => post<{ model: ModelConfig }>('/api/settings/models', m),
  updateModel: (id: string, m: Partial<{ name: string; baseUrl: string; apiKey: string; model: string; contextWindow: number; isDefault: boolean }>) =>
    patch<{ model: ModelConfig }>(`/api/settings/models/${id}`, m),
  deleteModel: (id: string) => del<{ ok: true }>(`/api/settings/models/${id}`),
  testModel: (id: string) => post<{ result: TestResult; model: ModelConfig }>(`/api/settings/models/${id}/test`),
  testModelValues: (v: { baseUrl: string; apiKey: string; model: string }) => post<{ result: TestResult }>('/api/settings/models/test', v),
  voice: () => get<VoiceSettings>('/api/settings/voice'),
  saveVoice: (v: { apiKey?: string; prefs?: Partial<VoicePrefs> }) => put<VoiceSettings>('/api/settings/voice', v),
  deleteVoiceKey: () => del<{ ok: true }>('/api/settings/voice/key'),
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
      'preview.frames', 'render.queued', 'render.progress', 'render.done', 'ask_user', 'git.commit', 'run.error', 'run.finished',
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
