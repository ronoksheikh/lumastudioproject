// Live event protocol (plan.md Appendix C). Persisted in run_events and streamed over SSE.

export interface PlanItem {
  text: string;
  status: 'todo' | 'doing' | 'done';
}

export interface EventDataMap {
  'run.started': { model: string; userMessageId: string };
  'reasoning.delta': { text: string };
  'message.delta': { text: string };
  'plan.updated': { items: PlanItem[] };
  'tool.call': { callId: string; name: string; args: unknown };
  'tool.output.delta': { callId: string; stream: 'stdout' | 'stderr'; text: string };
  'tool.result': { callId: string; ok: boolean; summary: string; truncated: boolean };
  'file.changed': { path: string; change: 'created' | 'modified' | 'deleted'; additions: number; deletions: number; diff?: string };
  'voice.ready': { duration: number; segments: Array<{ id: string; start: number; end: number }>; audioUrl: string; placeholder?: boolean };
  'preview.frames': { frames: Array<{ t: number; url: string }>; issues: string[] };
  'render.queued': { jobId: string; position: number };
  'render.progress': { jobId: string; frame: number; total: number; eta?: number; position?: number };
  'render.done': { jobId: string; url: string; contactSheetUrl?: string; durationS?: number };
  ask_user: { question: string; options: string[] };
  'git.commit': { sha: string; message: string; files: string[] };
  'run.error': { message: string; retryable: boolean };
  'run.finished': { usage: { input: number; output: number }; stopReason: StopReason };
}

export type RunEventType = keyof EventDataMap;

export type StopReason = 'completed' | 'stopped' | 'max_steps' | 'max_tokens' | 'error';

export type RunEvent<T extends RunEventType = RunEventType> = {
  id: number;
  runId: string;
  ts: number;
  type: T;
  data: EventDataMap[T];
};

/** Events after which the stream is over. */
export const TERMINAL_EVENTS: readonly RunEventType[] = ['run.finished'];
