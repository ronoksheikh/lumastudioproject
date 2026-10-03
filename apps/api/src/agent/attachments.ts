import fs from 'node:fs';
import path from 'node:path';
import type OpenAI from 'openai';
import { and, eq, inArray } from 'drizzle-orm';
import type { DB } from '../db/index.js';
import { uploads } from '../db/schema.js';
import type { ProjectRef } from '../runner/exec.js';

type Part = OpenAI.Chat.Completions.ChatCompletionContentPart;

export interface UserContent {
  /** persisted form: text only */
  text: string;
  /** what the model sees this turn (null when there is nothing but text) */
  parts: Part[] | null;
  attachmentIds: string[];
}

const MAX_INLINE_IMAGE = 3 * 1024 * 1024;
const imagePart = (file: string, mime: string): Part | null => {
  try {
    const size = fs.statSync(file).size;
    if (size > MAX_INLINE_IMAGE) return null;
    return { type: 'image_url', image_url: { url: `data:${mime};base64,${fs.readFileSync(file).toString('base64')}` } };
  } catch {
    return null;
  }
};

/** Turns the student's text + attached files into the user message: text, extracted PDF text, images (vision models). */
export function buildUserContent(db: DB, project: ProjectRef, text: string, attachmentIds: string[], supportsVision: boolean): UserContent {
  const rows = attachmentIds.length
    ? db.select().from(uploads).where(and(eq(uploads.projectId, project.id), inArray(uploads.id, attachmentIds))).all()
    : [];
  if (!rows.length) return { text, parts: null, attachmentIds: [] };

  const notes: string[] = [];
  const extra: Part[] = [];
  for (const u of rows) {
    const abs = path.join(project.dir, u.path);
    if (u.mime === 'image/svg+xml') {
      let body = '';
      try {
        body = fs.statSync(abs).size <= 20_000 ? fs.readFileSync(abs, 'utf8') : '';
      } catch { /* ignore */ }
      notes.push(`- ${u.path} (SVG logo/graphic)${body ? `\n\`\`\`svg\n${body}\n\`\`\`` : ' — large; read it with read_file if needed'}`);
    } else if (u.mime.startsWith('image/')) {
      const part = supportsVision ? imagePart(abs, u.mime) : null;
      notes.push(`- ${u.path} (${u.mime}${part ? ', shown below' : supportsVision ? ', too large to show inline' : ', this model cannot view images'})`);
      if (part) extra.push({ type: 'text', text: `(${u.path})` }, part);
    } else if (u.mime === 'application/pdf') {
      const stem = u.path.replace(/\.pdf$/, '');
      let body = '';
      try {
        body = fs.readFileSync(path.join(project.dir, `${stem}.txt`), 'utf8').slice(0, 20_000);
      } catch { /* no text layer */ }
      const pages = rows.filter((r) => r.path.startsWith(`${stem}-page`)).map((r) => r.path).sort().slice(0, 4);
      notes.push(`- ${u.path} (PDF; extracted text in ${stem}.txt, page images in ${stem}-page-N.png)${body ? `\n--- extracted text (first 20k chars) ---\n${body}\n--- end ---` : ' — no extractable text (scanned?)'}`);
      if (supportsVision) {
        for (const p of pages) {
          const part = imagePart(path.join(project.dir, p), 'image/png');
          if (part) extra.push({ type: 'text', text: `(${p})` }, part);
        }
      }
    }
    // derived files (txt/png from a PDF) are covered by their PDF
  }
  const standalone = rows.filter((u) => !/-page-\d+\.png$/.test(u.path) && u.mime !== 'text/plain');
  const noteText = `${text}\n\nAttached files (already in the project folder):\n${notes.join('\n')}`;
  const storedNote = `${text}\n\nAttached files: ${standalone.map((u) => u.path).join(', ')}`;
  return {
    text: storedNote,
    parts: extra.length ? [{ type: 'text', text: noteText }, ...extra] : [{ type: 'text', text: noteText }],
    attachmentIds: rows.map((r) => r.id),
  };
}
