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

export interface VoicePrefs {
  voiceId: string;
  modelId: string;
  languageCode: string | null;
  speed: number;
  tempo: number;
  stability: number;
  similarityBoost: number;
  style: number;
}
export interface VoiceSettings {
  hasKey: boolean;
  keyHint: string;
  prefs: VoicePrefs;
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
