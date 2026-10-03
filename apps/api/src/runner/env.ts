import path from 'node:path';
import { config } from '../config.js';
import { nodeInstallDir } from './sandbox.js';

/**
 * The ONLY environment agent commands get. Built from scratch — never from process.env — so app
 * secrets (MASTER_KEY, SESSION_SECRET, API keys, DB path…) cannot leak into a student's shell.
 */
export function buildCommandEnv(projectDir: string, extra: Record<string, string> = {}): Record<string, string> {
  const home = path.join(projectDir, '.home');
  const node = nodeInstallDir();
  const env: Record<string, string> = {
    PATH: `${node ? `${node}/bin:` : ''}/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`,
    HOME: home,
    USER: 'luma',
    LOGNAME: 'luma',
    SHELL: '/bin/bash',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    TERM: 'dumb',
    TMPDIR: '/tmp',
    NODE_PATH: config.sharedModules,
    // npm: scripts off by default, per-project cache (a cache shared between students could be poisoned)
    npm_config_cache: path.join(home, '.npm'),
    npm_config_ignore_scripts: 'true',
    npm_config_update_notifier: 'false',
    npm_config_fund: 'false',
    npm_config_audit: 'false',
    // git identity for commits made by the agent
    GIT_AUTHOR_NAME: 'Luma',
    GIT_AUTHOR_EMAIL: 'luma@lumademy.local',
    GIT_COMMITTER_NAME: 'Luma',
    GIT_COMMITTER_EMAIL: 'luma@lumademy.local',
    GIT_TERMINAL_PROMPT: '0',
  };
  if (config.chromePath) env.CHROME_PATH = config.chromePath;
  return { ...env, ...extra };
}
