// Shapes returned by the Luma Studio API (see apps/api/src/**/routes.ts).
import type { Aspect } from '@luma/shared';

export interface User {
  id: string;
  email: string;
}

export interface Project {
  id: string;
  title: string;
  aspect: Aspect;
  status: string;
  createdAt: number;
  updatedAt: number;
  /** the latest render's contact sheet (list only), shown as the card thumbnail */
  thumbnailUrl?: string | null;
  /** what the project holds so far (GET /projects/:id only); new projects are empty */
  content?: { scenes: boolean; script: boolean; voice: boolean };
}

export interface ModelConfig {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  apiKeyHint: string;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsReasoningStream: boolean;
  contextWindow: number;
  isDefault: boolean;
}

export interface TestResult {
  ok: boolean;
  reachable: boolean;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsReasoningStream: boolean;
  latencyMs: number;
  error?: string;
  notes: string[];
}

/** Optional overrides from Settings → Voice; null = Luma chooses. */
export interface VoicePrefs {
  voiceId: string | null;
  modelId: string | null;
  languageCode: string | null;
  speed: number | null;
  tempo: number | null;
  stability: number | null;
  similarityBoost: number | null;
  style: number | null;
}
export interface VoiceSettings {
  hasKey: boolean;
  keyHint: string;
  prefs: VoicePrefs;
}

export interface ProjectFile {
  path: string;
  kind: 'text' | 'svg' | 'image' | 'audio' | 'video' | 'pdf' | 'binary';
  mime?: string;
  content?: string;
  truncated?: boolean;
  bytes?: number;
  totalLines?: number;
}

export interface TreeEntry {
  path: string;
  type: 'file' | 'dir';
  size?: number;
}

export interface CommitSummary {
  sha: string;
  message: string;
  time: number;
  files: number;
  additions: number;
  deletions: number;
}
export interface CommitDetail extends CommitSummary {
  changes: Array<{ path: string; status: string; additions: number; deletions: number }>;
  diff: string;
  diffTruncated: boolean;
}

export interface UploadRecord {
  id: string;
  path: string;
  mime: string;
  size: number;
  derived?: Array<{ id: string; path: string; mime: string; size: number }>;
}

export interface RunInfo {
  id: string;
  projectId: string;
  messageId: string | null;
  status: 'running' | 'finished' | 'stopped' | 'error';
  startedAt: number;
  finishedAt: number | null;
  usage: { input: number; output: number } | null;
}

export interface ConversationMessage {
  id: string;
  text: string;
  createdAt: number;
  attachmentIds: string[];
  runId: string | null;
  runStatus: string | null;
}

export interface RenderRecord {
  id: string;
  preset: 'draft' | 'final';
  createdAt: number;
  duration: number | null;
  size: number | null;
  url: string;
  contactSheetUrl: string | null;
}

export interface TerminalEntry {
  runId: string;
  callId: string;
  name: string;
  args: unknown;
  output: string;
  ok: boolean | null;
  summary: string | null;
  ts: number;
}
