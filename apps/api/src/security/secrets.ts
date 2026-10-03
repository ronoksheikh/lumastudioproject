import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { logger } from '../logger.js';

export interface Secrets {
  /** 32 bytes — AES-256-GCM key for secrets at rest */
  masterKey: Buffer;
  /** 32 bytes — HMAC key for signed tokens (derived from SESSION_SECRET) */
  signingKey: Buffer;
}

let cached: Secrets | null = null;

/**
 * MASTER_KEY (32 bytes, base64) and SESSION_SECRET come from the environment. In production a missing
 * value is fatal; in development they are generated once and kept in DATA_DIR/.dev-secrets.json.
 */
export function loadSecrets(): Secrets {
  if (cached) return cached;
  let master = config.masterKey;
  let session = config.sessionSecret;
  if (!master || !session) {
    if (config.isProd) throw new Error('MASTER_KEY and SESSION_SECRET must be set in production (openssl rand -base64 32)');
    const file = path.join(config.dataDir, '.dev-secrets.json');
    let saved: { masterKey?: string; sessionSecret?: string } = {};
    try {
      saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch { /* first run */ }
    master ||= saved.masterKey ?? crypto.randomBytes(32).toString('base64');
    session ||= saved.sessionSecret ?? crypto.randomBytes(32).toString('base64');
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ masterKey: master, sessionSecret: session }), { mode: 0o600 });
    logger.warn('generated development secrets in DATA_DIR/.dev-secrets.json — set MASTER_KEY and SESSION_SECRET for real deployments');
  }
  const masterKey = Buffer.from(master, 'base64');
  if (masterKey.length !== 32) throw new Error('MASTER_KEY must be 32 bytes, base64 encoded (openssl rand -base64 32)');
  const signingKey = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(session), Buffer.alloc(0), 'luma-signing-v1', 32));
  cached = { masterKey, signingKey };
  return cached;
}

export const resetSecretsCache = () => {
  cached = null;
};
