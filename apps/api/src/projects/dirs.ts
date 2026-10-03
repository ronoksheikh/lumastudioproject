import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { config } from '../config.js';
import type { DB } from '../db/index.js';
import { projects } from '../db/schema.js';
import { buildCommandEnv } from '../runner/env.js';
import type { ProjectRef } from '../runner/exec.js';
import { effectiveSandbox } from '../runner/sandbox.js';

export const newProjectId = () => randomUUID().replace(/-/g, '').slice(0, 16); // hex: safe in paths, urls and bwrap args

export function projectDir(id: string, base = config.projectsDir): string {
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) throw new Error(`invalid project id: ${id}`);
  return path.join(base, id);
}

/** Next free unix uid for a project (monotonic, never reused so a deleted project's files stay unreadable to others). */
export function allocateUid(db: DB): number {
  const row = db.select({ max: sql<number | null>`max(${projects.uid})` }).from(projects).get();
  return Math.max(config.projectUidBase, (row?.max ?? config.projectUidBase - 1) + 1);
}

export function projectRef(id: string, uid: number | null, base = config.projectsDir): ProjectRef {
  return { id, dir: projectDir(id, base), uid };
}

/** Run a command as the project's own user (git etc.). Never inherits the api's environment. */
export function runAsProject(project: ProjectRef, file: string, args: string[], opts: { input?: string; timeoutMs?: number } = {}) {
  const sb = effectiveSandbox();
  return spawnSync(file, args, {
    cwd: project.dir,
    env: buildCommandEnv(project.dir),
    encoding: 'utf8',
    input: opts.input,
    timeout: opts.timeoutMs ?? 60_000,
    maxBuffer: 64 * 1024 * 1024,
    ...(sb.uid && project.uid != null ? { uid: project.uid, gid: project.uid } : {}),
  });
}

export function git(project: ProjectRef, args: string[], opts?: { input?: string; timeoutMs?: number }) {
  return runAsProject(project, 'git', args, opts);
}

/** The student's saved voice defaults (Settings → Voice), written into the new project's script.json. */
export interface VoiceDefaults {
  voiceId: string;
  modelId: string;
  languageCode: string | null;
  speed: number;
  tempo: number;
  stability: number;
  similarityBoost: number;
  style: number;
}

export function applyVoiceDefaults(scriptFile: string, v: VoiceDefaults) {
  const script = JSON.parse(fs.readFileSync(scriptFile, 'utf8'));
  const voice = script.voice ?? {};
  script.voice = {
    ...voice,
    model_id: v.modelId,
    voice_id: v.voiceId,
    ...(v.languageCode ? { language_code: v.languageCode } : {}),
    voice_settings: { ...(voice.voice_settings ?? {}), stability: v.stability, similarity_boost: v.similarityBoost, style: v.style, speed: v.speed },
    tempo: v.tempo,
  };
  fs.writeFileSync(scriptFile, JSON.stringify(script, null, 2) + '\n');
}

const COPY_SKIP = new Set(['node_modules', 'export', 'test', '.git', '.home']);

/**
 * Creates the project folder from the Luma template: copy → own it → `git init` → first commit.
 * The folder is 0700 and owned by the project's uid, so other students' commands cannot read it.
 */
export function initProjectDir(project: ProjectRef, opts: { title?: string; aspect?: string; templateDir?: string; voice?: VoiceDefaults } = {}) {
  const templateDir = opts.templateDir ?? config.templateDir;
  if (!fs.existsSync(path.join(templateDir, 'project.json'))) throw new Error(`Luma template not found at ${templateDir}`);
  if (fs.existsSync(project.dir)) throw new Error(`project folder already exists: ${project.dir}`);
  fs.mkdirSync(path.dirname(project.dir), { recursive: true });
  // /data/projects itself must be traversable (not listable) so each uid can reach its own folder
  try {
    fs.chmodSync(path.dirname(project.dir), 0o711);
  } catch { /* not ours to chmod in dev */ }

  fs.cpSync(templateDir, project.dir, {
    recursive: true,
    filter: (src) => !COPY_SKIP.has(path.basename(src)) || src === templateDir,
  });
  if (opts.title || opts.aspect) {
    const file = path.join(project.dir, 'project.json');
    const pj = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (opts.title) pj.title = opts.title;
    if (opts.aspect) pj.aspect = opts.aspect;
    fs.writeFileSync(file, JSON.stringify(pj, null, 2) + '\n');
  }
  if (opts.voice) applyVoiceDefaults(path.join(project.dir, 'script.json'), opts.voice);
  fs.mkdirSync(path.join(project.dir, '.home'), { recursive: true });
  fs.mkdirSync(path.join(project.dir, '.luma'), { recursive: true });
  fs.mkdirSync(path.join(project.dir, 'assets/uploads'), { recursive: true });
  chownTree(project);
  fs.chmodSync(project.dir, 0o700);

  const run = (args: string[]) => {
    const r = git(project, args);
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.error?.message}`);
    return r.stdout.trim();
  };
  run(['init', '-q', '-b', 'main']);
  run(['config', 'user.name', 'Luma']);
  run(['config', 'user.email', 'luma@lumademy.local']);
  run(['config', 'core.fileMode', 'false']);
  run(['add', '-A']);
  run(['commit', '-q', '-m', 'Create project from Luma template']);
  return run(['rev-parse', 'HEAD']);
}

/** chown -R to the project uid (no-op unless the api runs as root). */
export function chownTree(project: ProjectRef) {
  const sb = effectiveSandbox();
  if (!sb.uid || project.uid == null) return;
  const walk = (p: string) => {
    fs.lchownSync(p, project.uid!, project.uid!);
    if (fs.lstatSync(p).isDirectory()) for (const n of fs.readdirSync(p)) walk(path.join(p, n));
  };
  walk(project.dir);
}
