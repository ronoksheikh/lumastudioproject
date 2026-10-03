import fs from 'node:fs';
import path from 'node:path';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { DB } from '../db/index.js';
import { uploads } from '../db/schema.js';
import { runAsProject } from '../projects/dirs.js';
import type { ProjectRef } from '../runner/exec.js';
import { newId } from '../util/id.js';
import type { Sniffed } from './sniff.js';

export const UPLOAD_DIR = 'assets/uploads';
const MAX_PDF_PAGES = 8;

export function projectUploadBytes(db: DB, projectId: string): number {
  return db.select({ n: sql<number>`coalesce(sum(${uploads.size}), 0)` }).from(uploads).where(eq(uploads.projectId, projectId)).get()?.n ?? 0;
}

function chownToProject(project: ProjectRef, file: string) {
  if (project.uid == null || typeof process.getuid !== 'function' || process.getuid() !== 0) return;
  fs.chownSync(file, project.uid, project.uid);
}

function uniqueName(dir: string, name: string): string {
  if (!fs.existsSync(path.join(dir, name))) return name;
  const ext = path.extname(name);
  const stem = name.slice(0, -ext.length || undefined);
  for (let i = 2; i < 1000; i++) {
    const n = `${stem}-${i}${ext}`;
    if (!fs.existsSync(path.join(dir, n))) return n;
  }
  throw new Error('too many files with this name');
}

export interface SavedUpload {
  id: string;
  path: string;
  mime: string;
  size: number;
  derived: Array<{ id: string; path: string; mime: string; size: number }>;
}

function record(db: DB, projectId: string, rel: string, mime: string, size: number) {
  const id = newId();
  db.insert(uploads).values({ id, projectId, path: rel, mime, size }).run();
  return { id, path: rel, mime, size };
}

/** Writes the upload into the project and, for PDFs, extracts text and page images (as the project's own uid). */
export function saveUpload(db: DB, project: ProjectRef, buf: Buffer, type: Sniffed, name: string): SavedUpload {
  const dir = path.join(project.dir, UPLOAD_DIR);
  fs.mkdirSync(dir, { recursive: true });
  chownToProject(project, dir);
  const fileName = uniqueName(dir, name);
  const abs = path.join(dir, fileName);
  fs.writeFileSync(abs, buf, { mode: 0o644, flag: 'wx' });
  chownToProject(project, abs);
  const main = record(db, project.id, `${UPLOAD_DIR}/${fileName}`, type.mime, buf.length);
  const derived: SavedUpload['derived'] = [];

  if (type.ext === 'pdf') {
    const stem = fileName.replace(/\.pdf$/, '');
    const txt = path.join(dir, `${stem}.txt`);
    const t = runAsProject(project, 'pdftotext', ['-layout', '-enc', 'UTF-8', abs, txt], { timeoutMs: 60_000 });
    if (t.status === 0 && fs.existsSync(txt)) {
      chownToProject(project, txt);
      derived.push(record(db, project.id, `${UPLOAD_DIR}/${stem}.txt`, 'text/plain', fs.statSync(txt).size));
    }
    const prefix = path.join(dir, `${stem}-page`);
    const p = runAsProject(project, 'pdftoppm', ['-png', '-r', '80', '-f', '1', '-l', String(MAX_PDF_PAGES), abs, prefix], { timeoutMs: 120_000 });
    if (p.status === 0) {
      for (const f of fs.readdirSync(dir).filter((n) => n.startsWith(`${stem}-page`) && n.endsWith('.png')).sort()) {
        chownToProject(project, path.join(dir, f));
        derived.push(record(db, project.id, `${UPLOAD_DIR}/${f}`, 'image/png', fs.statSync(path.join(dir, f)).size));
      }
    }
  }
  return { ...main, derived };
}

/**
 * Removes an upload (and its derived PDF files) from disk and the database. `onlyPending`: refuse when it was
 * already sent with a message ('sent') — the composer's X must never delete a file the agent may be using.
 */
export function removeUpload(db: DB, project: ProjectRef, uploadId: string, opts: { onlyPending?: boolean } = {}): boolean | 'sent' {
  const row = db.select().from(uploads).where(eq(uploads.id, uploadId)).get();
  if (!row || row.projectId !== project.id) return false;
  if (opts.onlyPending && row.sentAt != null) return 'sent';
  const related = derivedOf(db.select().from(uploads).where(eq(uploads.projectId, project.id)).all(), row);
  for (const u of [row, ...related]) {
    fs.rmSync(path.join(project.dir, u.path), { force: true });
    db.delete(uploads).where(eq(uploads.id, u.id)).run();
  }
  return true;
}

type UploadRow = typeof uploads.$inferSelect;

/** Files made from a PDF upload (extracted text, page images) belong to it and are not shown on their own. */
export function derivedOf(all: UploadRow[], main: UploadRow): UploadRow[] {
  if (main.mime !== 'application/pdf') return [];
  const stem = main.path.replace(/\.pdf$/, '');
  return all.filter((u) => u.id !== main.id && (u.path === `${stem}.txt` || /^-page-\d+\.png$/.test(u.path.slice(stem.length)) && u.path.startsWith(stem)));
}

/** The uploads a student attached themselves (not the derived PDF text/pages). */
export function mainUploads(all: UploadRow[]): UploadRow[] {
  const derived = new Set(all.flatMap((u) => derivedOf(all, u).map((d) => d.id)));
  return all.filter((u) => !derived.has(u.id));
}

/** Uploaded but not sent with a message yet: what the composer shows as pending chips (also after a reload). */
export function pendingUploads(db: DB, projectId: string): UploadRow[] {
  const all = db.select().from(uploads).where(eq(uploads.projectId, projectId)).all();
  return mainUploads(all).filter((u) => u.sentAt == null);
}

/** Marks attachments (and their derived files) as sent: the composer can no longer delete them. */
export function markSent(db: DB, projectId: string, ids: string[]) {
  if (!ids.length) return;
  const all = db.select().from(uploads).where(eq(uploads.projectId, projectId)).all();
  const chosen = all.filter((u) => ids.includes(u.id));
  const withDerived = [...new Set([...chosen, ...chosen.flatMap((u) => derivedOf(all, u))].map((u) => u.id))];
  db.update(uploads).set({ sentAt: Date.now() }).where(and(eq(uploads.projectId, projectId), inArray(uploads.id, withDerived), isNull(uploads.sentAt))).run();
}
