import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { logger } from '../logger.js';

export type SandboxMode = 'uid' | 'bwrap' | 'none';

export interface SandboxCaps {
  /** can we switch to a per-project uid (needs root)? */
  canSwitchUid: boolean;
  /** is bubblewrap installed and usable (user namespaces allowed)? */
  bwrap: string | null;
}

let caps: SandboxCaps | null = null;

/** Detects what isolation is available. Cached; call resetSandboxCaps() in tests. */
export function detectSandbox(): SandboxCaps {
  if (caps) return caps;
  const canSwitchUid = typeof process.getuid === 'function' && process.getuid() === 0;
  let bwrap: string | null = null;
  for (const p of ['/usr/bin/bwrap', '/usr/local/bin/bwrap']) {
    if (!fs.existsSync(p)) continue;
    // probe as the unprivileged project uid we will really use (bwrap needs unprivileged user namespaces there)
    const as = canSwitchUid ? { uid: config.projectUidBase, gid: config.projectUidBase } : {};
    const probe = spawnSync(p, ['--ro-bind', '/', '/', '--unshare-pid', '--dev', '/dev', '--proc', '/proc', 'true'], { timeout: 5000, ...as });
    if (probe.status === 0) bwrap = p;
    else logger.warn({ stderr: probe.stderr?.toString().slice(0, 200) }, 'bubblewrap is installed but not usable here');
    break;
  }
  caps = { canSwitchUid, bwrap };
  return caps;
}
export const resetSandboxCaps = () => {
  caps = null;
};

/** Which mechanisms apply for the configured SANDBOX mode. */
export function effectiveSandbox(): { uid: boolean; bwrap: string | null; description: string } {
  const c = detectSandbox();
  const want = config.sandbox;
  const uid = want !== 'none' && want !== 'bwrap' && c.canSwitchUid;
  const bwrap = want === 'none' || want === 'uid' ? null : c.bwrap;
  const parts = [uid ? 'per-project uid' : null, bwrap ? 'bubblewrap' : null].filter(Boolean);
  return { uid, bwrap, description: parts.length ? parts.join(' + ') : 'none (commands run as the api user)' };
}

/** Node's own install dir when it lives outside /usr (e.g. /opt/node22 in dev); commands need `node` too. */
export function nodeInstallDir(): string | null {
  const bin = path.dirname(process.execPath);
  if (bin.startsWith('/usr/') || bin === '/bin' || bin === '/usr/bin') return null;
  return path.dirname(bin);
}

/** Directory holding the Chromium install (CHROME_PATH may be a symlink into e.g. /ms-playwright/…). */
export function chromeInstallDir(): string | null {
  if (!config.chromePath) return null;
  try {
    return path.dirname(fs.realpathSync(config.chromePath));
  } catch {
    return null;
  }
}

/** Directories made visible read-only inside bubblewrap (only those that exist). */
const RO_DIRS = ['/usr', '/bin', '/sbin', '/lib', '/lib64', '/etc/ssl', '/etc/ca-certificates', '/etc/fonts', '/usr/share/fonts'];
const RO_FILES = ['/etc/resolv.conf', '/etc/hosts', '/etc/nsswitch.conf', '/etc/ld.so.cache', '/etc/passwd', '/etc/group', '/etc/localtime', '/etc/alternatives'];

/** Wraps `bash -lc <cmd>` so the command only sees system tools, the shared packages and its own project dir. */
export function bwrapArgv(opts: { bwrap: string; projectDir: string; sharedModules: string; extraRo?: string[]; cwd?: string }, inner: string[]): string[] {
  const a: string[] = [opts.bwrap, '--die-with-parent', '--unshare-pid', '--unshare-ipc', '--unshare-uts', '--unshare-cgroup-try', '--new-session'];
  for (const d of RO_DIRS) if (fs.existsSync(d)) a.push('--ro-bind', d, d);
  for (const f of RO_FILES) if (fs.existsSync(f)) a.push('--ro-bind', f, f);
  const node = nodeInstallDir();
  const chrome = chromeInstallDir();
  for (const d of [...(opts.extraRo ?? []), ...(node ? [node] : []), ...(chrome ? [chrome] : [])]) if (fs.existsSync(d)) a.push('--ro-bind', d, d);
  if (fs.existsSync(opts.sharedModules)) a.push('--ro-bind', opts.sharedModules, opts.sharedModules);
  a.push('--dev', '/dev', '--proc', '/proc', '--tmpfs', '/tmp');
  a.push('--bind', opts.projectDir, opts.projectDir, '--chdir', opts.cwd ?? opts.projectDir);
  a.push('--', ...inner);
  return a;
}
