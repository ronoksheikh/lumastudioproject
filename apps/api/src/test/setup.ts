// Runs before every test file: isolated data dir + test-friendly config. Must run before ../config.ts is imported.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (!process.env.DATA_DIR) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'luma-test-data-'));
  fs.chmodSync(dir, 0o711);
  process.env.DATA_DIR = dir;
}
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL ??= 'silent';
process.env.ALLOW_PRIVATE_PROVIDER_URLS = '1'; // mock model servers listen on 127.0.0.1
process.env.MASTER_KEY ??= Buffer.alloc(32, 7).toString('base64');
process.env.SESSION_SECRET ??= 'test-session-secret-test-session-secret';
process.env.APP_ORIGIN ??= 'http://app.test';
process.env.PREVIEW_ORIGIN ??= 'http://preview.test';
