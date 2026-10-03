// Error tracking without an SDK: posts unhandled errors to a Sentry-compatible store endpoint
// (Sentry, self-hosted GlitchTip). Set ERROR_TRACKING_DSN. Never throws and never blocks a request.
import os from 'node:os';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { redactSecrets } from '../security/redact.js';

interface Dsn {
  url: string;
  key: string;
}

function parseDsn(dsn: string | undefined): Dsn | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const project = u.pathname.split('/').filter(Boolean).pop();
    if (!u.username || !project) return null;
    const prefix = u.pathname.split('/').filter(Boolean).slice(0, -1).join('/');
    return { url: `${u.protocol}//${u.host}${prefix ? `/${prefix}` : ''}/api/${project}/store/`, key: u.username };
  } catch {
    return null;
  }
}

export async function reportError(err: unknown, context: Record<string, string | number | undefined> = {}, dsn = config.errorTrackingDsn): Promise<boolean> {
  const target = parseDsn(dsn);
  if (!target) return false;
  const e = err instanceof Error ? err : new Error(String(err));
  const event = {
    event_id: crypto.randomUUID().replace(/-/g, ''),
    timestamp: new Date().toISOString(),
    platform: 'node',
    level: 'error',
    server_name: os.hostname(),
    environment: config.env,
    message: redactSecrets(e.message, []),
    exception: { values: [{ type: e.name, value: redactSecrets(e.message, []), stacktrace: { frames: (e.stack ?? '').split('\n').slice(1, 15).map((l) => ({ filename: redactSecrets(l.trim(), []) })).reverse() } }] },
    tags: Object.fromEntries(Object.entries(context).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])),
  };
  try {
    const res = await fetch(target.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sentry-auth': `Sentry sentry_version=7, sentry_client=luma-studio/1.0, sentry_key=${target.key}` },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch (sendErr) {
    logger.warn({ err: sendErr }, 'could not send error report');
    return false;
  }
}

let installed = false;
export function installProcessHandlers() {
  if (installed) return;
  installed = true;
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaught exception');
    void reportError(err, { kind: 'uncaughtException' }).finally(() => process.exit(1));
  });
  process.on('unhandledRejection', (err) => {
    logger.error({ err }, 'unhandled rejection');
    void reportError(err, { kind: 'unhandledRejection' });
  });
}
