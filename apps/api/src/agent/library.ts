// Shared library: files one run downloaded or made that every other project can reuse — a font, a sound, a
// map/data json, an image, a reusable scene snippet. share_asset copies a project file in; use_asset copies one
// into another project. The list is in every system prompt, so the agent reuses instead of downloading or
// rebuilding (saves time and tokens). The agent decides what is worth sharing.
// Only basic safety: never .env or other hidden files (keys live there), and nothing over 50 MB.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { desc, eq, and } from 'drizzle-orm';
import type { DB } from '../db/index.js';
import { sharedAssets } from '../db/schema.js';
import { config } from '../config.js';
import type { ProjectRef } from '../runner/exec.js';
import { readProjectBytes, ToolError, writeProjectBytes } from '../runner/files.js';
import { newId } from '../util/id.js';

export const ASSET_KINDS = ['font', 'image', 'audio', 'data', 'snippet', 'other'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

const MAX = 50 * 1024 * 1024;
const IN_PROMPT = 60;

const libDir = () => path.join(config.dataDir, 'library');
const safe = (s: string) => s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'file';

export interface ShareInput {
  path: string;
  kind: AssetKind;
  name: string;
  description?: string;
}

export function shareAsset(db: DB, project: ProjectRef, userId: string, a: ShareInput): string {
  if (!config.sharedLibrary) throw new ToolError('The shared library is turned off on this server.');
  const norm = a.path.replace(/\\/g, '/').replace(/^\.\//, '');
  if (norm.split('/').some((seg) => seg.startsWith('.'))) throw new ToolError('Hidden files (.env, .git, …) can\'t be shared — they can hold keys.');
  const { bytes } = readProjectBytes(project, norm, MAX);
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');
  const dup = db.select().from(sharedAssets).where(and(eq(sharedAssets.sha256, sha), eq(sharedAssets.status, 'active'))).get();
  if (dup) return `Already in the shared library as ${dup.id} ("${dup.name}").`;

  const id = newId().slice(0, 8);
  const ext = path.extname(norm).toLowerCase();
  const file = `${a.kind}/${id}-${safe(path.basename(norm, ext))}${ext}`;
  const abs = path.join(libDir(), file);
  fs.mkdirSync(path.dirname(abs), { recursive: true, mode: 0o755 });
  fs.writeFileSync(abs, bytes, { mode: 0o644, flag: 'wx' });
  db.insert(sharedAssets).values({ id, kind: a.kind, name: a.name.slice(0, 80), file, sha256: sha, size: bytes.length, description: a.description?.slice(0, 300) ?? null, sourceUserId: userId }).run();
  return `Shared as ${id}. Every project can now copy it in with use_asset("${id}").`;
}

/** Copies a library item into the project at `to` (default assets/library/<file name>). */
export function useAsset(db: DB, project: ProjectRef, id: string, to?: string): string {
  if (!config.sharedLibrary) throw new ToolError('The shared library is turned off on this server.');
  const row = db.select().from(sharedAssets).where(and(eq(sharedAssets.id, id), eq(sharedAssets.status, 'active'))).get();
  if (!row) throw new ToolError(`No shared asset "${id}". The list is in your system prompt.`);
  const bytes = fs.readFileSync(path.join(libDir(), row.file));
  const dest = to?.trim() || `assets/library/${path.basename(row.file).replace(/^[^-]+-/, '')}`;
  const { rel } = writeProjectBytes(project, dest, bytes);
  db.update(sharedAssets).set({ uses: row.uses + 1 }).where(eq(sharedAssets.id, row.id)).run();
  return `Copied ${row.kind} "${row.name}" to ${rel}. Reference it with a relative URL ("${rel}").`;
}

/** The prompt section listing the library (most used first), or '' when empty. */
export function libraryForPrompt(db: DB): string {
  if (!config.sharedLibrary) return '';
  const rows = db.select().from(sharedAssets).where(eq(sharedAssets.status, 'active')).orderBy(desc(sharedAssets.uses), desc(sharedAssets.createdAt)).limit(IN_PROMPT).all();
  if (!rows.length) return '';
  return [
    '## Shared library (reuse before downloading or rebuilding: use_asset(id) copies it into this project)',
    ...rows.map((r) => `- [${r.id}] ${r.kind}: ${r.name}${r.description ? ` — ${r.description}` : ''}`),
  ].join('\n');
}

export function listAssets(db: DB) {
  return db.select().from(sharedAssets).where(eq(sharedAssets.status, 'active')).orderBy(desc(sharedAssets.createdAt)).all();
}

export function removeAsset(db: DB, id: string): boolean {
  return db.update(sharedAssets).set({ status: 'removed' }).where(eq(sharedAssets.id, id)).run().changes > 0;
}
