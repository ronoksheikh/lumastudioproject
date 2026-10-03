// Redact secrets before text reaches the model, the UI or the logs.

const PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g, // OpenAI / OpenRouter style
  /\bsk_[A-Za-z0-9]{20,}\b/g, // ElevenLabs style
  /\bxi-api-key\s*[:=]\s*\S+/gi,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bghp_[A-Za-z0-9]{30,}\b/g,
];

/** Replaces every known secret value and every secret-looking token with `***`. */
export function redactSecrets(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length >= 6) out = out.split(s).join('***');
  }
  for (const re of PATTERNS) out = out.replace(re, '***');
  return out;
}
