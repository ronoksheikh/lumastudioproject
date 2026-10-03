// Live state of agent runs in the browser: one TurnState per run, kept in sync from the database
// (replay) and the SSE stream (live). Components read it; the Project page drives it.
import type { PlanItem, RunEvent } from '@luma/shared';
import { create } from 'zustand';
import { api, openRunStream } from '../api/client';
import { emptyTurn, reduceAll, reduceEvent, type TurnState } from '../lib/reduce';

interface LiveState {
  turns: Record<string, TurnState>;
  /** runs per project, oldest first */
  order: Record<string, string[]>;
  /** the run currently streaming for a project */
  active: Record<string, string | null>;
  /** bumped whenever something happened that should refresh the preview/files/history */
  tick: Record<string, number>;
  /** project-level error messages (e.g. failed to start) */
  error: Record<string, string | null>;

  loadProject(projectId: string): Promise<void>;
  start(projectId: string, message: string, attachmentIds: string[], providerId?: string, frames?: number[]): Promise<string>;
  stop(projectId: string): Promise<void>;
  answer(projectId: string, runId: string, answer: string): Promise<void>;
  reset(projectId: string): void;
}

const streams = new Map<string, () => void>(); // projectId -> close()

export const useLive = create<LiveState>((set, get) => {
  const apply = (projectId: string, runId: string, e: RunEvent) => {
    set((s) => {
      const turn = reduceEvent(s.turns[runId] ?? emptyTurn(runId), e);
      const bump = e.type === 'file.changed' || e.type === 'voice.ready' || e.type === 'run.finished' || e.type === 'git.commit';
      return {
        turns: { ...s.turns, [runId]: turn },
        tick: bump ? { ...s.tick, [projectId]: (s.tick[projectId] ?? 0) + 1 } : s.tick,
      };
    });
  };

  const follow = (projectId: string, runId: string, after: number) => {
    streams.get(projectId)?.();
    set((s) => ({ active: { ...s.active, [projectId]: runId } }));
    const close = openRunStream(
      projectId,
      runId,
      after,
      (e) => apply(projectId, runId, e),
      () => {
        streams.delete(projectId);
        set((s) => ({ active: { ...s.active, [projectId]: null } }));
      },
    );
    streams.set(projectId, close);
  };

  return {
    turns: {},
    order: {},
    active: {},
    tick: {},
    error: {},

    async loadProject(projectId) {
      const { runs } = await api.runs(projectId);
      const ordered = [...runs].sort((a, b) => a.startedAt - b.startedAt);
      set((s) => ({ order: { ...s.order, [projectId]: ordered.map((r) => r.id) } }));
      const loaded = await Promise.all(
        ordered.map(async (r) => {
          const have = get().turns[r.id];
          if (have && r.status !== 'running') return null; // finished runs never change
          const { events } = await api.runEvents(projectId, r.id, 0);
          return { run: r, turn: reduceAll(r.id, events) };
        }),
      );
      set((s) => {
        const turns = { ...s.turns };
        for (const l of loaded) if (l) turns[l.run.id] = l.turn;
        return { turns };
      });
      const running = ordered.find((r) => r.status === 'running');
      if (running && !streams.has(projectId)) follow(projectId, running.id, get().turns[running.id]?.lastEventId ?? 0);
    },

    async start(projectId, message, attachmentIds, providerId, frames = []) {
      set((s) => ({ error: { ...s.error, [projectId]: null } }));
      const { runId } = await api.startRun(projectId, message, attachmentIds, providerId, frames);
      set((s) => ({
        turns: { ...s.turns, [runId]: emptyTurn(runId) },
        order: { ...s.order, [projectId]: [...(s.order[projectId] ?? []), runId] },
      }));
      follow(projectId, runId, 0);
      return runId;
    },

    async stop(projectId) {
      const runId = get().active[projectId];
      if (runId) await api.stopRun(projectId, runId);
    },

    async answer(projectId, runId, answer) {
      await api.answer(projectId, runId, answer);
    },

    reset(projectId) {
      streams.get(projectId)?.();
      streams.delete(projectId);
      set((s) => {
        const runIds = new Set(s.order[projectId] ?? []);
        const turns = Object.fromEntries(Object.entries(s.turns).filter(([id]) => !runIds.has(id)));
        return { turns, order: { ...s.order, [projectId]: [] }, active: { ...s.active, [projectId]: null } };
      });
    },
  };
});

/** The newest plan published in this project (pinned above the chat). */
export function currentPlan(state: LiveState, projectId: string): PlanItem[] | null {
  const ids = state.order[projectId] ?? [];
  for (let i = ids.length - 1; i >= 0; i--) {
    const p = state.turns[ids[i]!]?.plan;
    if (p) return p;
  }
  return null;
}
