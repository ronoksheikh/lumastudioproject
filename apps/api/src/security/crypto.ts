import crypto from 'node:crypto';

const VERSION = 'v1';

/** AES-256-GCM. Output: `v1.<iv>.<tag>.<ciphertext>` (base64url). */
export function encrypt(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function decrypt(payload: string, key: Buffer): string {
  const [v, iv, tag, ct] = payload.split('.');
  if (v !== VERSION || !iv || !tag || !ct) throw new Error('unsupported secret format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}

/** `sk-…abcd` — what the UI may show after a key is saved. */
export function keyHint(secret: string): string {
  const s = secret.trim();
  if (s.length <= 8) return '…' + s.slice(-2);
  return `${s.slice(0, 3)}…${s.slice(-4)}`;
}

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Short-lived signed token binding a user to a project: `<userId>.<projectId>.<expiresAtSec>.<hmac>`. */
export function signPreviewToken(userId: string, projectId: string, ttlS: number, key: Buffer, nowMs = Date.now()): { token: string; expiresAt: number } {
  const exp = Math.floor(nowMs / 1000) + ttlS;
  const body = `${userId}.${projectId}.${exp}`;
  const mac = crypto.createHmac('sha256', key).update(`preview:${body}`).digest('base64url');
  return { token: `${Buffer.from(body).toString('base64url')}.${mac}`, expiresAt: exp * 1000 };
}

export function verifyPreviewToken(token: string, projectId: string, key: Buffer, nowMs = Date.now()): { userId: string } | null {
  const [b64, mac] = token.split('.');
  if (!b64 || !mac) return null;
  let body: string;
  try {
    body = Buffer.from(b64, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const expect = crypto.createHmac('sha256', key).update(`preview:${body}`).digest('base64url');
  if (!safeEqual(mac, expect)) return null;
  const [userId, pid, exp] = body.split('.');
  if (!userId || pid !== projectId || Number(exp) * 1000 < nowMs) return null;
  return { userId };
}
