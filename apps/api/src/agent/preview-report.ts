// What the student's browser says about the live preview (the Preview tab reports it to the server), so the
// agent can see "The video can't be played yet: …" instead of guessing. Kept in memory (latest per project).
export interface PreviewReport {
  at: number;
  status: 'ready' | 'error' | 'empty';
  message?: string;
  duration?: number;
}

const reports = new Map<string, PreviewReport>();

export const setPreviewReport = (projectId: string, r: Omit<PreviewReport, 'at'>) => reports.set(projectId, { ...r, at: Date.now() });
export const getPreviewReport = (projectId: string) => reports.get(projectId) ?? null;

/** One line for the system prompt when the student's preview is broken. */
export function previewReportLine(projectId: string): string | null {
  const r = reports.get(projectId);
  if (!r || r.status !== 'error') return null;
  const mins = Math.round((Date.now() - r.at) / 60000);
  return `The student's Preview tab is showing an ERROR (${mins <= 0 ? 'just now' : `${mins} min ago`}): ${(r.message ?? '').slice(0, 800)}\nCall check_preview to see the full details and fix it.`;
}
