// Shared library: files one run downloaded or made that other projects can reuse — an open-licence font, a
// sound, a map/data json, an icon set, a reusable scene snippet. share_asset copies a project file in (server
// side, checked); use_asset copies one into another project. The index is listed in every system prompt, so
// the agent reuses instead of re-downloading or rebuilding (saves time and tokens).
//
// Guards (the library crosses between students): student uploads, .env and hidden files are refused; only known
// extensions per kind; ≤ 20 MB; text files that contain anything secret-looking are refused; a licence and a
// description are required; identical files (sha256) are stored once. SHARED_LIBRARY=review keeps new items
// pending until `admin asset-approve`; off disables. Files live in DATA_DIR/library/<kind>/ (0644, root-owned).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { DB } from '../db/index.js';
import { sharedAssets } from '../db/schema.js';
import { config } from '../config.js';
import type { ProjectRef } from '../runner/exec.js';
import { readProjectBytes, ToolError, writeProjectBytes } from '../runner/files.js';
import { redactSecrets } from '../security/redact.js';
import { newId } from '../util/id.js';

export const ASSET_KINDS = ['font', 'image', 'audio', 'data', 'snippet'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

const EXT: Record<AssetKind, string[]> = {
  font: ['.woff2', '.woff', '.ttf', '.otf'],
  image: ['.svg', '.png', '.jpg', '.jpeg', '.webp'],
  audio: ['.mp3', '.wav', '.ogg', '.m4a'],
  data: ['.json', '.geojson', '.csv', '.txt'],
  snippet: ['.js', '.css', '.md'],
};
const TEXT = new Set(['.svg', '.json', '.geojson', '.csv', '.txt', '.js', '.css', '.md']);
const MAX = 20 * 1024 * 1024;
const IN_PROMPT = 50;

const libDir = () => path.join(config.dataDir, 'library');
const safe = (s: string) => s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'file';

export interface ShareInput {
  path: string;
  kind: AssetKind;
  name: string;
  description: string;
  license: string;
  source_url?: string;
}

export function shareAsset(db: DB, project: ProjectRef, userId: string, a: ShareInput, secrets: readonly string[] = []): string {
  if (config.sharedLibrary === 'off') throw new ToolError('The shared library is turned off on this server.');
  const norm = a.path.replace(/\\/g, '/').replace(/^\.\//, '');
  if (/^assets\/uploads\//.test(norm)) throw new ToolError('Student uploads are private to their project and are never shared.');
  if (norm.split('/').some((seg) => seg.startsWith('.'))) throw new ToolError('Hidden files (.env, .luma, .git…) are never shared.');
  const ext = path.extname(norm).toLowerCase();
  if (!EXT[a.kind].includes(ext)) throw new ToolError(`A ${a.kind} must be one of ${EXT[a.kind].join(' ')}`);
  const { bytes } = readProjectBytes(project, norm, MAX);
  if (TEXT.has(ext)) {
    const text = bytes.toString('utf8');
    if (redactSecrets(text, secrets) !== text || /[\w.+-]+@[\w-]+\.[\w.-]{2,}/.test(text)) throw new ToolError('This file contains a key, token or e-mail address — it cannot be shared.');
  }
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');
  const dup = db.select().from(sharedAssets).where(and(eq(sharedAssets.sha256, sha), inArray(sharedAssets.status, ['active', 'pending']))).get();
  if (dup) return `Already in the shared library as ${dup.id} (${dup.kind} "${dup.name}"). Nothing to add.`;

  const id = newId().slice(0, 8);
  const status = config.sharedLibrary === 'review' ? 'pending' : 'active';
  const file = `${a.kind}/${id}-${safe(path.basename(norm, ext))}${ext}`;
  const abs = path.join(libDir(), file);
  fs.mkdirSync(path.dirname(abs), { recursive: true, mode: 0o755 });
  fs.writeFileSync(abs, bytes, { mode: 0o644, flag: 'wx' });
  db.insert(sharedAssets).values({
    id, kind: a.kind, name: a.name.slice(0, 80), file, sha256: sha, size: bytes.length,
    description: redactSecrets(a.description, secrets).slice(0, 300), license: a.license.slice(0, 80),
    sourceUrl: a.source_url?.slice(0, 500) ?? null, status, sourceUserId: userId,
  }).run();
  return status === 'active'
    ? `Shared as ${id}. Every project can now copy it in with use_asset("${id}").`
    : `Saved as ${id} for review — usable once an operator approves it.`;
}

/** Copies a library item into the project at `to` (default assets/library/<file name>). */
export function useAsset(db: DB, project: ProjectRef, id: string, to?: string): string {
  if (config.sharedLibrary === 'off') throw new ToolError('The shared library is turned off on this server.');
  const row = db.select().from(sharedAssets).where(and(eq(sharedAssets.id, id), eq(sharedAssets.status, 'active'))).get();
  if (!row) throw new ToolError(`No shared asset "${id}". The list is in your system prompt.`);
  const bytes = fs.readFileSync(path.join(libDir(), row.file));
  const dest = to?.trim() || `assets/library/${path.basename(row.file).replace(/^[^-]+-/, '')}`;
  const { rel } = writeProjectBytes(project, dest, bytes);
  db.update(sharedAssets).set({ uses: row.uses + 1 }).where(eq(sharedAssets.id, row.id)).run();
  return `Copied ${row.kind} "${row.name}" to ${rel} (licence: ${row.license}). Reference it with a relative URL, e.g. "${rel}".`;
}

/** The prompt section listing the library (most used first), or '' when empty. */
export function libraryForPrompt(db: DB): string {
  if (config.sharedLibrary === 'off') return '';
  const rows = db.select().from(sharedAssets).where(eq(sharedAssets.status, 'active')).orderBy(desc(sharedAssets.uses), desc(sharedAssets.createdAt)).limit(IN_PROMPT).all();
  if (!rows.length) return '';
  return [
    '## Shared library (reuse before downloading or rebuilding: use_asset(id) copies it into this project)',
    ...rows.map((r) => `- [${r.id}] ${r.kind}: ${r.name} — ${r.description} (${r.license})`),
  ].join('\n');
}

export function listAssets(db: DB, status?: string) {
  const q = db.select().from(sharedAssets);
  return (status ? q.where(eq(sharedAssets.status, status)) : q).orderBy(desc(sharedAssets.createdAt)).all();
}

export function setAssetStatus(db: DB, id: string, status: 'active' | 'archived'): boolean {
  return db.update(sharedAssets).set({ status }).where(eq(sharedAssets.id, id)).run().changes > 0;
}
