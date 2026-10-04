// Starts everything the UI needs, for real: the API (serving the built SPA + a second port for the preview
// origin), a mock OpenAI-compatible model, and a mock ElevenLabs.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockEleven, startMockLlm, type MockTurn } from '../../api/src/test/helpers';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');

export interface Stack {
  appUrl: string;
  llm: Awaited<ReturnType<typeof startMockLlm>>;
  eleven: Awaited<ReturnType<typeof startMockEleven>>;
  /** queue of scripted assistant turns (consumed by agent requests, not by connection tests) */
  turns: MockTurn[];
  dataDir: string;
  stop(): Promise<void>;
}

async function waitFor(url: string, ms = 30_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      if ((await fetch(url)).ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${url} did not come up`);
}

export async function startStack(opts: { port?: number } = {}): Promise<Stack> {
  const port = opts.port ?? 18080;
  const turns: MockTurn[] = [];
  const llm = await startMockLlm({
    reasoning: true,
    script: (body) => {
      if (body.tools?.[0]?.function?.name === 'get_time' || JSON.stringify(body.messages).includes('image_url') && !body.tools?.length) return null;
      if (!body.tools) return { content: 'SUMMARY of earlier work.' };
      return turns.shift() ?? { content: 'Done.' };
    },
  });
  const eleven = await startMockEleven('xi-e2e-key-123456');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'luma-e2e-'));
  fs.chmodSync(dataDir, 0o711);

  const env = {
    ...process.env,
    SIGNUP_ENABLED: '1', // the journey starts at /signup
    NODE_ENV: 'development',
    PORT: String(port),
    DATA_DIR: dataDir,
    APP_ORIGIN: `http://localhost:${port}`,
    PREVIEW_ORIGIN: `http://localhost:${port + 1}`,
    WEB_DIST: path.join(repo, 'apps/web/dist'),
    SHARED_MODULES: path.join(repo, 'template/node_modules'),
    CHROME_PATH: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    ALLOW_PRIVATE_PROVIDER_URLS: '1',
    ELEVENLABS_API_BASE: eleven.base,
    RATE_LIMIT_DISABLED: '1',
    LOG_LEVEL: 'warn',
  };
  const api: ChildProcess = spawn('pnpm', ['exec', 'tsx', 'src/index.ts'], { cwd: path.join(repo, 'apps/api'), env, stdio: ['ignore', 'inherit', 'inherit'] });
  await waitFor(`http://localhost:${port}/api/health`);
  return {
    appUrl: `http://localhost:${port}`,
    llm, eleven, turns, dataDir,
    async stop() {
      api.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 500));
      await llm.close();
      await eleven.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
