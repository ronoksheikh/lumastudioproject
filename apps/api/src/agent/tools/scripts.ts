// Runs Luma Studio's OWN pristine copies of the template scripts (config.templateDir/scripts), pointed at
// a project with --root. The project's copy of a script is never executed with secrets: a prompt-injected
// edit to it could otherwise steal the ElevenLabs key.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { config } from '../../config.js';
import { buildCommandEnv } from '../../runner/env.js';
import type { ProjectRef } from '../../runner/exec.js';
import { killUidProcesses } from '../../runner/exec.js';
import { effectiveSandbox } from '../../runner/sandbox.js';
import { OutputBuffer } from '../../runner/truncate.js';
import { redactSecrets } from '../../security/redact.js';

export interface ScriptResult {
  code: number | null;
  output: string;
  timedOut: boolean;
}

export function runPristineScript(
  project: ProjectRef,
  script: string,
  args: string[],
  opts: { stdin?: string; timeoutMs?: number; env?: Record<string, string>; signal?: AbortSignal; secrets?: string[]; onOutput?: (text: string) => void } = {},
): Promise<ScriptResult> {
  const sb = effectiveSandbox();
  const file = path.join(config.templateDir, 'scripts', script);
  const env = buildCommandEnv(project.dir, { ELEVENLABS_API_BASE: config.elevenBase, ...(opts.env ?? {}) });
  return new Promise((resolve) => {
    const buf = new OutputBuffer(60_000);
    let timedOut = false;
    const child = spawn(process.execPath, [file, ...args, '--root', project.dir, '--no-env'], {
      cwd: project.dir,
      env,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(sb.uid && project.uid != null ? { uid: project.uid, gid: project.uid } : {}),
    });
    const kill = () => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch { /* gone */ }
      if (project.uid != null) killUidProcesses(project.uid);
    };
    const timer = setTimeout(() => ((timedOut = true), kill()), opts.timeoutMs ?? 300_000);
    opts.signal?.addEventListener('abort', kill, { once: true });
    const feed = (d: Buffer) => {
      const t = redactSecrets(d.toString('utf8'), opts.secrets ?? []);
      buf.push(t);
      opts.onOutput?.(t);
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.stdin.on('error', () => {});
    child.stdin.end(opts.stdin ?? '');
    child.on('close', (code) => {
      clearTimeout(timer);
      kill();
      resolve({ code, output: buf.toString(), timedOut });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      buf.push(`failed to start: ${e.message}`);
      resolve({ code: null, output: buf.toString(), timedOut });
    });
  });
}
