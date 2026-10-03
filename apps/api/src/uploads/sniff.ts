export interface Sniffed {
  mime: string;
  ext: string;
}

/** Decide the type from the bytes, never from the client's filename or Content-Type. */
export function sniffUpload(buf: Buffer): Sniffed | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return { mime: 'image/png', ext: 'png' };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.length >= 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (buf.length >= 5 && buf.subarray(0, 1024).toString('latin1').includes('%PDF-')) return { mime: 'application/pdf', ext: 'pdf' };
  const head = buf.subarray(0, 4096).toString('utf8').trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(head)) return { mime: 'image/svg+xml', ext: 'svg' };
  return null;
}

/** A safe file name: base name only, [A-Za-z0-9._-], at most 80 chars, with the sniffed extension. */
export function safeName(original: string, ext: string): string {
  const base = original.replace(/\\/g, '/').split('/').pop() ?? 'file';
  const stem = base.replace(/\.[^.]*$/, '').normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+|[.-]+$/g, '').slice(0, 60);
  return `${stem || 'file'}.${ext}`;
}
