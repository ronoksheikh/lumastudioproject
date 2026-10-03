// Persisted + live event stream for a run. Every event is stored in run_events (replay after a page
// reload via Last-Event-ID) and pushed to the SSE subscribers of that run.
import { and, asc, eq, gt } from 'drizzle-orm';
import type { EventDataMap, RunEvent, RunEventType } from '@luma/shared';
import type { DB } from '../db/index.js';
import { runEvents } from '../db/schema.js';

type Listener = (e: RunEvent) => void;

export class RunBus {
  private listeners = new Set<Listener>();
  private pending = new Map<string, { type: RunEventType; text: string; stream?: string }>();
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(private readonly db: DB, readonly runId: string) {}

  /** Persist + broadcast. Returns the stored event. */
  emit<T extends RunEventType>(type: T, data: EventDataMap[T]): RunEvent<T> {
    this.flushDeltas(); // keep ordering: pending text goes out before the next structural event
    return this.store(type, data);
  }

  private store<T extends RunEventType>(type: T, data: EventDataMap[T]): RunEvent<T> {
    const ts = Date.now();
    const row = this.db.insert(runEvents).values({ runId: this.runId, ts, type, dataJson: JSON.stringify(data) }).returning({ id: runEvents.id }).get();
    const event: RunEvent<T> = { id: row.id, runId: this.runId, ts, type, data };
    for (const l of this.listeners) {
      try {
        l(event as RunEvent);
      } catch { /* a dead subscriber must not break the run */ }
    }
    return event;
  }

  /**
   * Token-sized deltas are batched (~60 ms) so a long answer is hundreds of rows, not thousands.
   * Consecutive deltas of the same kind (and tool/stream) are concatenated.
   */
  delta(type: 'reasoning.delta' | 'message.delta' | 'tool.output.delta', data: { text: string; callId?: string; stream?: 'stdout' | 'stderr' }) {
    const key = `${type}:${data.callId ?? ''}:${data.stream ?? ''}`;
    const cur = this.pending.get(key);
    if (cur) cur.text += data.text;
    else {
      // a different kind of delta arrived: flush what we hold first so order is preserved
      if (this.pending.size) this.flushDeltas();
      this.pending.set(key, { type, text: data.text, stream: JSON.stringify({ callId: data.callId, stream: data.stream }) });
    }
    this.flushTimer ??= setTimeout(() => this.flushDeltas(), 60);
  }

  flushDeltas() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    const items = [...this.pending.values()];
    this.pending.clear();
    for (const it of items) {
      const extra = it.stream ? JSON.parse(it.stream) : {};
      if (it.type === 'tool.output.delta') this.store('tool.output.delta', { callId: extra.callId, stream: extra.stream, text: it.text });
      else this.store(it.type as 'reasoning.delta' | 'message.delta', { text: it.text });
    }
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Stored events after `afterId` (replay). */
  replay(afterId = 0): RunEvent[] {
    return loadEvents(this.db, this.runId, afterId);
  }
}

export function loadEvents(db: DB, runId: string, afterId = 0, limit = 5000): RunEvent[] {
  return db
    .select()
    .from(runEvents)
    .where(and(eq(runEvents.runId, runId), gt(runEvents.id, afterId)))
    .orderBy(asc(runEvents.id))
    .limit(limit)
    .all()
    .map((r) => ({ id: r.id, runId: r.runId, ts: r.ts, type: r.type as RunEventType, data: JSON.parse(r.dataJson) }));
}
