import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { config } from '../config.js';
import { redactSecrets } from '../security/redact.js';
import { buildCommandEnv } from './env.js';
import { bwrapArgv, effectiveSandbox } from './sandbox.js';
import { OutputBuffer } from './truncate.js';

export interface ProjectRef {
  id: string;
  dir: string;
  /** unix uid/gid the project's files belong to */
  uid: number | null;
}

export interface ExecOptions {
  timeoutS?: number;
  /** extra env vars (never secrets) */
  env?: Record<string, string>;
  /** called with every output chunk (already redacted) */
  onOutput?: (stream: 'stdout' | 'stderr', text: string) => void;
  signal?: AbortSignal;
  /** values to scrub from output, e.g. the user's API keys */
  secrets?: readonly string[];
  /** resource limits */
  limits?: Partial<Limits>;
  /** working directory (absolute, inside the project); default: the project root */
  cwd?: string;
}

export interface Limits {
  /** max processes for the uid */
  nproc: number;
  /** max size of a single file written, bytes */
  fsize: number;
  /** CPU seconds per process */
  cpu: number;
}

export interface ExecResult {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  aborted: boolean;
  output: string;
  truncated: boolean;
  durationMs: number;
}

const DEFAULT_LIMITS: Limits = { nproc: 1024, fsize: 2 * 1024 ** 3, cpu: 3600 };

/** Kills everything that belongs to the project uid (background processes the command left behind). */
export function killUidProcesses(uid: number) {
  if (typeof process.getuid !== 'function' || process.getuid() !== 0) return;
  spawnSync('pkill', ['-9', '-U', String(uid)], { timeout: 3000 });
}

/**
 * Runs `bash -lc <command>` in the project folder with a clean env, resource limits, low priority and
 * (when available) a per-project uid and a bubblewrap mount namespace. Kills the whole process group
 * on timeout/abort and cleans up stragglers afterwards.
 */
export function execInProject(project: ProjectRef, command: string, opts: ExecOptions = {}): Promise<ExecResult> {
  const timeoutS = opts.timeoutS ?? config.cmdTimeoutS;
  const limits = { ...DEFAULT_LIMITS, ...opts.limits };
  const sb = effectiveSandbox();
  fs.mkdirSync(`${project.dir}/.home`, { recursive: true });
  if (sb.uid && project.uid != null) {
    try {
      fs.chownSync(`${project.dir}/.home`, project.uid, project.uid);
    } catch { /* already owned */ }
  }

  const inner = ['prlimit', `--nproc=${limits.nproc}`, `--fsize=${limits.fsize}`, `--cpu=${limits.cpu}`, '--', 'nice', '-n', '10', 'bash', '-lc', command];
  const argv = sb.bwrap ? bwrapArgv({ bwrap: sb.bwrap, projectDir: project.dir, sharedModules: config.sharedModules, extraRo: [config.templateDir], cwd: opts.cwd }, inner) : inner;
  const env = buildCommandEnv(project.dir, opts.env);
  const secrets = opts.secrets ?? [];

  return new Promise<ExecResult>((resolve) => {
    const started = Date.now();
    const buf = new OutputBuffer();
    let timedOut = false;
    let aborted = false;
    let finished = false;

    const child = spawn(argv[0]!, argv.slice(1), {
      cwd: opts.cwd ?? project.dir,
      env,
      detached: true, // own process group so we can kill the whole tree
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(sb.uid && project.uid != null ? { uid: project.uid, gid: project.uid } : {}),
    });

    const killGroup = (sig: NodeJS.Signals) => {
      try {
        if (child.pid) process.kill(-child.pid, sig);
      } catch { /* already gone */ }
    };
    const stop = (reason: 'timeout' | 'abort') => {
      if (finished) return;
      if (reason === 'timeout') timedOut = true;
      else aborted = true;
      killGroup('SIGTERM');
      setTimeout(() => {
        killGroup('SIGKILL');
        if (project.uid != null) killUidProcesses(project.uid);
      }, 2000).unref();
    };

    const timer = setTimeout(() => stop('timeout'), timeoutS * 1000);
    const onAbort = () => stop('abort');
    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener('abort', onAbort, { once: true });
    }

    const feed = (stream: 'stdout' | 'stderr') => (data: Buffer) => {
      const text = redactSecrets(data.toString('utf8'), secrets);
      buf.push(text);
      opts.onOutput?.(stream, text);
    };
    child.stdout.on('data', feed('stdout'));
    child.stderr.on('data', feed('stderr'));

    const done = (exitCode: number | null, signal: string | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      // leave nothing running behind a finished command
      killGroup('SIGKILL');
      if (project.uid != null) killUidProcesses(project.uid);
      let output = buf.toString();
      if (timedOut) output += `\n[command timed out after ${timeoutS}s and was killed]`;
      if (aborted) output += '\n[command was stopped]';
      resolve({ exitCode, signal, timedOut, aborted, output, truncated: buf.truncated, durationMs: Date.now() - started });
    };
    child.on('error', (err) => {
      buf.push(`failed to start: ${err.message}\n`);
      done(null, null);
    });
    child.on('close', (code, signal) => done(code, signal));
  });
}
