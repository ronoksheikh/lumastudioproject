import fs from 'node:fs';
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
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

export function removeUpload(db: DB, project: ProjectRef, uploadId: string): boolean {
  const row = db.select().from(uploads).where(eq(uploads.id, uploadId)).get();
  if (!row || row.projectId !== project.id) return false;
  const stem = row.path.replace(/\.[^.]+$/, '');
  const related = row.mime === 'application/pdf'
    ? db.select().from(uploads).where(eq(uploads.projectId, project.id)).all().filter((u) => u.id !== row.id && (u.path === `${stem}.txt` || u.path.startsWith(`${stem}-page`)))
    : [];
  for (const u of [row, ...related]) {
    fs.rmSync(path.join(project.dir, u.path), { force: true });
    db.delete(uploads).where(eq(uploads.id, u.id)).run();
  }
  return true;
}
