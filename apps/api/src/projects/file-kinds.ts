// How the Files tab shows a project file: by extension first (media is never read into memory), then by
// content (text vs binary). The raw bytes come from GET /projects/:id/raw.
import path from 'node:path';

export type FileKind = 'text' | 'svg' | 'image' | 'audio' | 'video' | 'pdf' | 'binary';

const BY_EXT: Record<string, { kind: Exclude<FileKind, 'text' | 'binary'>; mime: string }> = {
  '.svg': { kind: 'svg', mime: 'image/svg+xml' },
  '.png': { kind: 'image', mime: 'image/png' },
  '.jpg': { kind: 'image', mime: 'image/jpeg' },
  '.jpeg': { kind: 'image', mime: 'image/jpeg' },
  '.webp': { kind: 'image', mime: 'image/webp' },
  '.gif': { kind: 'image', mime: 'image/gif' },
  '.mp3': { kind: 'audio', mime: 'audio/mpeg' },
  '.wav': { kind: 'audio', mime: 'audio/wav' },
  '.m4a': { kind: 'audio', mime: 'audio/mp4' },
  '.ogg': { kind: 'audio', mime: 'audio/ogg' },
  '.mp4': { kind: 'video', mime: 'video/mp4' },
  '.webm': { kind: 'video', mime: 'video/webm' },
  '.mov': { kind: 'video', mime: 'video/quicktime' },
  '.pdf': { kind: 'pdf', mime: 'application/pdf' },
};

export const mediaKind = (file: string) => BY_EXT[path.extname(file).toLowerCase()] ?? null;

/** Content-Type for the raw endpoint. Text-like files (html, js, css…) are always served as plain text: never rendered on the app origin. */
export function rawContentType(file: string, isText: boolean): string {
  const m = mediaKind(file);
  if (m) return m.mime;
  return isText ? 'text/plain; charset=utf-8' : 'application/octet-stream';
}
