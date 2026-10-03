import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../config.js';
import { initProjectDir, projectRef } from '../projects/dirs.js';
import { redactSecrets } from '../security/redact.js';
import { execInProject, type ProjectRef } from './exec.js';
import { deleteProjectFile, editProjectFile, listProjectFiles, readProjectFile, ToolError, writeProjectFile } from './files.js';
import { PathError, resolveInProject } from './paths.js';
import { effectiveSandbox, resetSandboxCaps } from './sandbox.js';
import { OutputBuffer, truncateMiddle } from './truncate.js';

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
let base: string;
let A: ProjectRef;
let B: ProjectRef;

beforeAll(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'luma-runner-'));
  fs.chmodSync(base, 0o711); // project uids must be able to traverse down to their own folder
  fs.mkdirSync(path.join(base, 'projects'), { recursive: true });
  A = projectRef('aaaaaaaa11111111', isRoot ? config.projectUidBase + 1 : null, path.join(base, 'projects'));
  B = projectRef('bbbbbbbb22222222', isRoot ? config.projectUidBase + 2 : null, path.join(base, 'projects'));
  initProjectDir(A, { title: 'A' });
  initProjectDir(B, { title: 'B' });
}, 60_000);

afterAll(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

describe('project creation', () => {
  it('creates an empty project from the scaffold, makes the first commit and keeps the folder private', () => {
    expect(fs.existsSync(path.join(A.dir, '.gitignore'))).toBe(true);
    expect(fs.existsSync(path.join(A.dir, 'public/js'))).toBe(false); // the engine is not copied
    expect(fs.existsSync(path.join(A.dir, 'node_modules'))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(A.dir, 'project.json'), 'utf8')).title).toBe('A');
    expect(fs.statSync(A.dir).mode & 0o777).toBe(0o700);
    expect(fs.existsSync(path.join(A.dir, '.git'))).toBe(true);
  });
});

describe('path confinement', () => {
  it('accepts normal paths and rejects escapes', () => {
    expect(resolveInProject(A.dir, 'public/css/scenes.css')).toBe(path.join(fs.realpathSync(A.dir), 'public/css/scenes.css'));
    expect(resolveInProject(A.dir, 'new/dir/file.txt')).toContain('new/dir/file.txt');
    expect(() => resolveInProject(A.dir, '../x')).toThrow(PathError);
    expect(() => resolveInProject(A.dir, '/etc/passwd')).toThrow(PathError);
    expect(() => resolveInProject(A.dir, 'a/../../x')).toThrow(PathError);
    expect(() => resolveInProject(A.dir, 'a\0b')).toThrow(PathError);
  });

  it('rejects symlinks that point outside the project', () => {
    const link = path.join(A.dir, 'evil');
    fs.symlinkSync('/etc', link);
    expect(() => resolveInProject(A.dir, 'evil/passwd')).toThrow(/symlink/);
    expect(() => resolveInProject(A.dir, 'evil')).toThrow(/symlink/);
    expect(() => readProjectFile(A, 'evil/passwd')).toThrow(ToolError);
    expect(() => writeProjectFile(A, 'evil/x.txt', 'hi')).toThrow(ToolError);
    fs.rmSync(link);
    // a link that stays inside is fine
    fs.symlinkSync('public', path.join(A.dir, 'inside'));
    expect(resolveInProject(A.dir, 'inside/index.html')).toContain('public/index.html');
    fs.rmSync(path.join(A.dir, 'inside'));
  });
});

describe('file tools', () => {
  it('writes, edits (unique match), reads with line numbers, lists, deletes', () => {
    const w = writeProjectFile(A, 'notes/a.txt', 'one\ntwo\nthree\n');
    expect(w).toMatchObject({ path: 'notes/a.txt', change: 'created', additions: 3, deletions: 0 });
    const r = readProjectFile(A, 'notes/a.txt');
    expect(r.kind === 'text' && r.text).toContain('     2\ttwo');
    const e = editProjectFile(A, 'notes/a.txt', 'two', '2');
    expect(e).toMatchObject({ change: 'modified', additions: 1, deletions: 1 });
    expect(e.diff).toContain('-two');
    expect(() => editProjectFile(A, 'notes/a.txt', 'nope', 'x')).toThrow(/not found/);
    writeProjectFile(A, 'notes/b.txt', 'x x x');
    expect(() => editProjectFile(A, 'notes/b.txt', 'x', 'y')).toThrow(/matches 3 places/);
    expect(editProjectFile(A, 'notes/b.txt', 'x', 'y', true).additions).toBe(1);
    expect(fs.readFileSync(path.join(A.dir, 'notes/b.txt'), 'utf8')).toBe('y y y');
    const list = listProjectFiles(A, '.', 2).map((x) => x.path);
    expect(list).toContain('notes/a.txt');
    expect(list.some((p) => p === '.git' || p.startsWith('.git/') || p.includes('node_modules'))).toBe(false);
    deleteProjectFile(A, 'notes');
    expect(fs.existsSync(path.join(A.dir, 'notes'))).toBe(false);
  });

  it('returns images as base64 parts and flags binary files', () => {
    fs.writeFileSync(path.join(A.dir, 'p.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
    fs.writeFileSync(path.join(A.dir, 'blob.bin'), Buffer.from([1, 2, 0, 3]));
    expect(readProjectFile(A, 'p.png')).toMatchObject({ kind: 'image', mime: 'image/png' });
    expect(readProjectFile(A, 'blob.bin')).toMatchObject({ kind: 'binary' });
  });

  it('files written by the api are owned by the project uid', () => {
    if (!isRoot) return;
    writeProjectFile(A, 'owned/file.txt', 'x');
    expect(fs.statSync(path.join(A.dir, 'owned/file.txt')).uid).toBe(A.uid);
    expect(fs.statSync(path.join(A.dir, 'owned')).uid).toBe(A.uid);
  });
});

describe('output helpers', () => {
  it('truncates the middle and keeps head and tail', () => {
    const t = truncateMiddle('a'.repeat(100) + 'b'.repeat(100), 100);
    expect(t.truncated).toBe(true);
    expect(t.text.startsWith('a')).toBe(true);
    expect(t.text.endsWith('b')).toBe(true);
    const b = new OutputBuffer(100);
    for (let i = 0; i < 50; i++) b.push('0123456789');
    expect(b.toString().length).toBeLessThan(200);
    expect(b.truncated).toBe(true);
  });
  it('redacts secrets', () => {
    const out = redactSecrets('key=sk-abcdefghijklmnopqrstuv and mine hunter2secret', ['hunter2secret']);
    expect(out).not.toContain('abcdefghijkl');
    expect(out).not.toContain('hunter2secret');
  });
});

describe('exec', () => {
  it('runs in the project folder with a clean environment (no app secrets)', async () => {
    process.env.MASTER_KEY = 'super-secret-master-key';
    process.env.SESSION_SECRET = 'super-secret-session';
    const r = await execInProject(A, 'pwd; env; echo "exit-marker"');
    delete process.env.MASTER_KEY;
    delete process.env.SESSION_SECRET;
    expect(r.exitCode).toBe(0);
    expect(r.output).toContain(fs.realpathSync(A.dir));
    expect(r.output).toContain(`HOME=${A.dir}/.home`);
    expect(r.output).not.toContain('super-secret');
    expect(r.output).not.toContain('DATABASE');
    expect(r.output).toContain(`NODE_PATH=${config.sharedModules}`);
  });

  it('streams output and reports exit codes', async () => {
    const chunks: string[] = [];
    const r = await execInProject(A, 'echo out; echo err 1>&2; exit 3', { onOutput: (s, t) => chunks.push(`${s}:${t.trim()}`) });
    expect(r.exitCode).toBe(3);
    expect(chunks).toContain('stdout:out');
    expect(chunks).toContain('stderr:err');
  });

  it('kills a command that loops forever at its timeout, including its children', async () => {
    const t0 = Date.now();
    const r = await execInProject(A, 'sleep 300 & while true; do :; done', { timeoutS: 1 });
    expect(r.timedOut).toBe(true);
    expect(Date.now() - t0).toBeLessThan(8000);
    expect(r.output).toContain('timed out');
    // nothing left behind
    const left = await execInProject(A, 'pgrep -f "[s]leep 300" || echo none');
    expect(left.output).toContain('none');
  }, 20_000);

  it('stops on abort', async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 300);
    const r = await execInProject(A, 'sleep 60', { signal: ac.signal });
    expect(r.aborted).toBe(true);
  }, 20_000);

  it('a command finishing (or being stopped) never kills another command of the same project', async () => {
    // e.g. a render or a frame capture running while the agent's shell command ends or is stopped
    const long = execInProject(A, 'sleep 4; echo survived', { timeoutS: 30 });
    await new Promise((r) => setTimeout(r, 300));
    await execInProject(A, 'echo quick');
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 200);
    await execInProject(A, 'sleep 60', { signal: ac.signal });
    const after = execInProject(A, 'sleep 3; echo also-survived', { timeoutS: 30 }); // starts right after a stop
    expect((await long).output).toContain('survived');
    expect((await after).output).toContain('also-survived');
  }, 30_000);

  it('scrubs known secrets from output', async () => {
    const r = await execInProject(A, 'echo my-llm-key-123456', { secrets: ['my-llm-key-123456'] });
    expect(r.output).not.toContain('my-llm-key');
  });

  it('can run node with the shared base packages when they exist', async () => {
    if (!fs.existsSync(path.join(config.sharedModules, 'gsap'))) return;
    const r = await execInProject(A, "node -e \"console.log(typeof require('gsap').gsap)\"");
    expect(r.output).toContain('object');
  });
});

describe.skipIf(!isRoot)('isolation between projects (per-project uid)', () => {
  it('two projects run commands at the same time without seeing each other', async () => {
    fs.writeFileSync(path.join(A.dir, 'secret-a.txt'), 'AAA-SECRET');
    fs.chownSync(path.join(A.dir, 'secret-a.txt'), A.uid!, A.uid!);
    fs.writeFileSync(path.join(B.dir, 'secret-b.txt'), 'BBB-SECRET');
    fs.chownSync(path.join(B.dir, 'secret-b.txt'), B.uid!, B.uid!);
    const [ra, rb] = await Promise.all([
      execInProject(A, `cat secret-a.txt; cat ${B.dir}/secret-b.txt 2>&1; ls ${path.dirname(B.dir)} 2>&1; sleep 0.3; id -u`),
      execInProject(B, `cat secret-b.txt; cat ${A.dir}/secret-a.txt 2>&1; ls ${path.dirname(A.dir)} 2>&1; sleep 0.3; id -u`),
    ]);
    expect(ra.output).toContain('AAA-SECRET');
    expect(ra.output).not.toContain('BBB-SECRET');
    expect(rb.output).toContain('BBB-SECRET');
    expect(rb.output).not.toContain('AAA-SECRET');
    expect(ra.output).toMatch(/Permission denied|No such file/);
    expect(ra.output.trim().endsWith(String(A.uid))).toBe(true);
    expect(rb.output.trim().endsWith(String(B.uid))).toBe(true);
  }, 30_000);

  it('cannot read the app database or secrets', async () => {
    const db = path.join(base, 'luma.db');
    fs.writeFileSync(db, 'sqlite-data');
    fs.chmodSync(db, 0o600);
    const r = await execInProject(A, `cat ${db} 2>&1; cat /root/.bashrc 2>&1 | head -1`);
    expect(r.output).not.toContain('sqlite-data');
    expect(r.output).toMatch(/Permission denied|No such file/);
  });

  it('uses bubblewrap when it is available: only the project dir is visible', async () => {
    resetSandboxCaps();
    const sb = effectiveSandbox();
    if (!sb.bwrap) return;
    const r = await execInProject(A, `ls ${path.dirname(A.dir)}; ls /home 2>&1 | head -2; echo done`);
    // the sibling project does not even exist in A's view
    expect(r.output).not.toContain(path.basename(B.dir));
    expect(r.output).toContain('done');
  });
});
