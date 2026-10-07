export interface Sniffed {
  mime: string;
  ext: string;
}

const TEXT_TYPES: Record<string, string> = { md: 'text/markdown', markdown: 'text/markdown', txt: 'text/plain', json: 'application/json', csv: 'text/csv' };

/** Plain UTF-8 text (no NUL bytes, decodes cleanly) — scripts, briefs, data. Only with a text file extension. */
function sniffText(buf: Buffer, filename?: string): Sniffed | null {
  const ext = filename?.toLowerCase().match(/\.([a-z]+)$/)?.[1];
  if (!ext || !TEXT_TYPES[ext]) return null;
  const head = buf.subarray(0, 64 * 1024);
  if (head.includes(0)) return null;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(head.length < buf.length ? head.subarray(0, head.length - 4) : head);
  } catch {
    return null;
  }
  return { mime: TEXT_TYPES[ext]!, ext: ext === 'markdown' ? 'md' : ext };
}

/** Decide the type from the bytes, never from the client's filename or Content-Type (text files also need a text extension). */
export function sniffUpload(buf: Buffer, filename?: string): Sniffed | null {
  // audio: music, a recorded voice, a sound effect
  if (buf.length >= 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WAVE') return { mime: 'audio/wav', ext: 'wav' };
  if (buf.length >= 4 && buf.subarray(0, 4).toString() === 'OggS') return { mime: 'audio/ogg', ext: 'ogg' };
  if (buf.length >= 3 && buf.subarray(0, 3).toString() === 'ID3') return { mime: 'audio/mpeg', ext: 'mp3' };
  if (buf.length >= 2 && buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0 && buf[1] !== 0xff) return { mime: 'audio/mpeg', ext: 'mp3' };
  if (buf.length >= 12 && buf.subarray(4, 8).toString() === 'ftyp' && /^(M4A |M4B )/.test(buf.subarray(8, 12).toString())) return { mime: 'audio/mp4', ext: 'm4a' };
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return { mime: 'image/png', ext: 'png' };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.length >= 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (buf.length >= 5 && buf.subarray(0, 1024).toString('latin1').includes('%PDF-')) return { mime: 'application/pdf', ext: 'pdf' };
  const head = buf.subarray(0, 4096).toString('utf8').trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return { mime: 'image/svg+xml', ext: 'svg' };
  return sniffText(buf, filename);
}

/** A safe file name: base name only, [A-Za-z0-9._-], at most 80 chars, with the sniffed extension. */
export function safeName(original: string, ext: string): string {
  const base = original.replace(/\\/g, '/').split('/').pop() ?? 'file';
  const stem = base.replace(/\.[^.]*$/, '').normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+|[.-]+$/g, '').slice(0, 60);
  return `${stem || 'file'}.${ext}`;
}
