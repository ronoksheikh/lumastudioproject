// The model-facing conversation, persisted in `messages` (one OpenAI-format message per row).
// UI history is rebuilt from run_events; this table is what we replay to the model.
import type BetterSqlite3 from 'better-sqlite3';
import type OpenAI from 'openai';
import { newId } from '../util/id.js';

export type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export interface StoredMessage {
  rowid: number;
  id: string;
  msg: ChatMessage;
  createdAt: number;
}

export class ConvoStore {
  constructor(private readonly sqlite: BetterSqlite3.Database, private readonly projectId: string) {}

  /** `stored` = what is persisted (images replaced by text); the in-memory message may carry the real image parts. */
  add(stored: ChatMessage, attachmentsJson: string | null = null, internal = false): StoredMessage {
    const id = newId();
    // `internal` marks messages the agent loop wrote itself (image hand-overs, nudges): the model sees them, the chat UI does not
    const role = internal ? 'internal' : (stored as { role: string }).role;
    const info = this.sqlite
      .prepare('insert into messages (id, project_id, role, content_json, attachments_json, created_at) values (?, ?, ?, ?, ?, ?)')
      .run(id, this.projectId, role, JSON.stringify(stored), attachmentsJson, Date.now());
    return { rowid: Number(info.lastInsertRowid), id, msg: stored, createdAt: Date.now() };
  }

  /** Messages after `uptoRowid`, oldest first. */
  load(uptoRowid = 0): StoredMessage[] {
    const rows = this.sqlite
      .prepare('select rowid as rowid, id, content_json as c, created_at as t from messages where project_id = ? and rowid > ? order by rowid')
      .all(this.projectId, uptoRowid) as Array<{ rowid: number; id: string; c: string; t: number }>;
    return rows.map((r) => ({ rowid: r.rowid, id: r.id, msg: JSON.parse(r.c) as ChatMessage, createdAt: r.t }));
  }

  memory(): { summary: string; uptoRowid: number } | null {
    const r = this.sqlite.prepare('select summary, upto_rowid as u from memories where project_id = ?').get(this.projectId) as { summary: string; u: number } | undefined;
    return r ? { summary: r.summary, uptoRowid: r.u } : null;
  }

  saveMemory(summary: string, uptoRowid: number) {
    this.sqlite
      .prepare('insert into memories (project_id, summary, upto_rowid, updated_at) values (?, ?, ?, ?) on conflict(project_id) do update set summary = excluded.summary, upto_rowid = excluded.upto_rowid, updated_at = excluded.updated_at')
      .run(this.projectId, summary, uptoRowid, Date.now());
  }
}

/** Cheap token estimate (no tokenizer dependency): ~3.2 chars per token, images ≈ 1,200 tokens. */
export function estimateTokens(messages: ChatMessage[]): number {
  let chars = 0;
  let images = 0;
  const walk = (v: unknown) => {
    if (typeof v === 'string') chars += v.length;
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (o.type === 'image_url') {
        images++;
        return;
      }
      for (const x of Object.values(o)) walk(x);
    }
  };
  walk(messages);
  return Math.ceil(chars / 3.2) + images * 1200;
}
