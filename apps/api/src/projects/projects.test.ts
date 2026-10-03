import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { projects, runs } from '../db/schema.js';
import { writeProjectFile } from '../runner/files.js';
import { Client, makeTestApp } from '../test/helpers.js';
import { commitAll } from './git.js';
import { toRef } from './service.js';
import { eq } from 'drizzle-orm';

let t: Awaited<ReturnType<typeof makeTestApp>>;
let ada: Client;
let bob: Client;
let projectId: string;

beforeAll(async () => {
  t = await makeTestApp();
  ada = new Client(t.app);
  bob = new Client(t.app);
  await ada.signup('ada@example.com');
  await bob.signup('bob@example.com');
}, 30_000);
afterAll(async () => {
  await t.app.close();
});

const ref = () => toRef(t.db.select().from(projects).where(eq(projects.id, projectId)).get()!);

describe('projects', () => {
  it('creates an EMPTY project with its own folder, uid and first commit', async () => {
    const r = await ada.post('/api/projects', { title: 'My first ad', aspect: '9:16' });
    expect(r.status).toBe(201);
    projectId = r.json.project.id;
    expect(r.json.project).toMatchObject({ title: 'My first ad', aspect: '9:16' });
    const row = t.db.select().from(projects).where(eq(projects.id, projectId)).get()!;
    expect(row.uid).toBeGreaterThanOrEqual(100000);
    const dir = ref().dir;
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'))).toMatchObject({ title: 'My first ad', aspect: '9:16' });
    // only the project's own files: no demo scenes, examples, script, audio, docs or engine copies
    const files = (fs.readdirSync(dir, { recursive: true }) as string[]).filter((f) => !/^(\.git|\.home|\.luma)(\/|$)/.test(f) && fs.statSync(path.join(dir, f)).isFile()).sort();
    expect(files).toEqual(['.gitignore', 'brand.json', 'package.json', 'project.json', 'public/css/scenes.css']);
    for (const demo of ['LUMA.md', 'examples', 'script.json', 'public/js', 'public/audio', 'public/index.html', 'scripts']) expect(fs.existsSync(path.join(dir, demo))).toBe(false);
    const log = await ada.get(`/api/projects/${projectId}/git/log`);
    expect(log.json.commits).toHaveLength(1);
    expect(log.json.commits[0].message).toBe('Create empty project');
    const got = await ada.get(`/api/projects/${projectId}`);
    expect(got.json.project.content).toEqual({ scenes: false, script: false, voice: false });
  });

  it('gives every project a different uid', async () => {
    const r2 = await ada.post('/api/projects', { title: 'Second', aspect: '16:9' });
    const uids = t.db.select({ uid: projects.uid }).from(projects).all().map((x) => x.uid);
    expect(new Set(uids).size).toBe(uids.length);
    expect(r2.status).toBe(201);
  });

  it('validates input', async () => {
    expect((await ada.post('/api/projects', { title: '' })).status).toBe(400);
    expect((await ada.post('/api/projects', { title: 'x', aspect: '4:3' })).status).toBe(400);
  });

  it('lists only my projects and hides other people’s with a 404', async () => {
    const mine = await ada.get('/api/projects');
    expect(mine.json.projects.map((p: any) => p.title)).toContain('My first ad');
    expect((await bob.get('/api/projects')).json.projects).toHaveLength(0);
    for (const url of [`/api/projects/${projectId}`, `/api/projects/${projectId}/tree`, `/api/projects/${projectId}/git/log`]) {
      expect((await bob.get(url)).status).toBe(404);
    }
    expect((await bob.patch(`/api/projects/${projectId}`, { title: 'hacked' })).status).toBe(404);
    expect((await bob.del(`/api/projects/${projectId}`)).status).toBe(404);
    expect((await bob.post(`/api/projects/${projectId}/preview-token`)).status).toBe(404);
  });

  it('renames a project', async () => {
    const r = await ada.patch(`/api/projects/${projectId}`, { title: 'Renamed' });
    expect(r.json.project.title).toBe('Renamed');
  });

  it('browses files read-only and refuses paths outside the project', async () => {
    const tree = await ada.get(`/api/projects/${projectId}/tree`, { depth: '3' });
    const paths = tree.json.entries.map((e: any) => e.path);
    expect(paths).toContain('project.json');
    expect(paths).toContain('public/css/scenes.css');
    const file = await ada.get(`/api/projects/${projectId}/file`, { path: 'project.json' });
    expect(file.json.kind).toBe('text');
    expect(JSON.parse(file.json.content).aspect).toBe('9:16');
    expect((await ada.get(`/api/projects/${projectId}/file`, { path: '../../etc/passwd' })).status).toBe(400);
    expect((await ada.get(`/api/projects/${projectId}/file`, { path: '/etc/passwd' })).status).toBe(400);
  });
});

describe('history', () => {
  let c1: string;
  let c2: string;

  it('lists commits with stats and shows a diff', async () => {
    writeProjectFile(ref(), 'notes.txt', 'first\n');
    c1 = commitAll(ref(), 'Add notes')!.sha;
    writeProjectFile(ref(), 'notes.txt', 'first\nsecond\n');
    writeProjectFile(ref(), 'extra.txt', 'extra\n');
    c2 = commitAll(ref(), 'Change notes, add extra')!.sha;
    const log = (await ada.get(`/api/projects/${projectId}/git/log`)).json.commits;
    expect(log.map((c: any) => c.message).slice(0, 2)).toEqual(['Change notes, add extra', 'Add notes']);
    expect(log[0]).toMatchObject({ files: 2, additions: 2, deletions: 0 });
    const show = (await ada.get(`/api/projects/${projectId}/git/commits/${c2}`)).json.commit;
    expect(show.changes.map((c: any) => `${c.status}:${c.path}`).sort()).toEqual(['A:extra.txt', 'M:notes.txt']);
    expect(show.diff).toContain('+second');
    const at = (await ada.get(`/api/projects/${projectId}/git/commits/${c1}/file`, { path: 'notes.txt' })).json;
    expect(at.content).toBe('first\n');
    expect((await ada.get(`/api/projects/${projectId}/git/commits/zzzz`)).status).toBe(400);
    expect((await ada.get(`/api/projects/${projectId}/git/commits/${c1}/file`, { path: '../x' })).status).toBe(400);
  });

  it('restore = a new commit with the old tree (history is never rewritten)', async () => {
    const before = (await ada.get(`/api/projects/${projectId}/git/log`)).json.commits.length;
    const r = await ada.post(`/api/projects/${projectId}/git/restore`, { sha: c1 });
    expect(r.status).toBe(200);
    expect(r.json.commit.message).toMatch(/^Restore to /);
    const dir = ref().dir;
    expect(fs.readFileSync(path.join(dir, 'notes.txt'), 'utf8')).toBe('first\n');
    expect(fs.existsSync(path.join(dir, 'extra.txt'))).toBe(false);
    const after = (await ada.get(`/api/projects/${projectId}/git/log`)).json.commits;
    expect(after.length).toBe(before + 1);
    expect(after.map((c: any) => c.sha)).toContain(c2); // old history intact
    // restoring the state we are already in is a no-op
    const again = await ada.post(`/api/projects/${projectId}/git/restore`, { sha: c1 });
    expect(again.json.unchanged).toBe(true);
  });

  it('refuses restore and delete while an agent run is active', async () => {
    t.db.insert(runs).values({ id: 'run1', projectId, status: 'running' }).run();
    expect((await ada.post(`/api/projects/${projectId}/git/restore`, { sha: c2 })).status).toBe(409);
    expect((await ada.del(`/api/projects/${projectId}`)).status).toBe(409);
    t.db.update(runs).set({ status: 'finished' }).where(eq(runs.id, 'run1')).run();
  });

  it('soft-deletes: gone from the list, folder kept for the purge job', async () => {
    const dir = ref().dir;
    expect((await ada.del(`/api/projects/${projectId}`)).status).toBe(200);
    expect((await ada.get('/api/projects')).json.projects.map((p: any) => p.id)).not.toContain(projectId);
    expect((await ada.get(`/api/projects/${projectId}`)).status).toBe(404);
    expect(fs.existsSync(dir)).toBe(true);
  });
});
