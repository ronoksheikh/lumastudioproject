// Serving finished renders. The export/ folder is writable by the project's own unix user, so a file
// there could have been swapped for a symlink: open with O_NOFOLLOW and check the resolved location.
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { notFound } from '../http/errors.js';
import { PathError, resolveInProject } from '../runner/paths.js';

const TYPES: Record<string, string> = { '.mp4': 'video/mp4', '.jpg': 'image/jpeg' };

function openRegular(projectDir: string, rel: string): { fd: number; size: number } {
  let abs: string;
  try {
    abs = resolveInProject(projectDir, rel);
  } catch (e) {
    if (e instanceof PathError) throw notFound();
    throw e;
  }
  if (!abs.startsWith(fs.realpathSync(projectDir) + path.sep + 'export' + path.sep)) throw notFound();
  let fd: number;
  try {
    fd = fs.openSync(abs, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch {
    throw notFound();
  }
  const st = fs.fstatSync(fd);
  if (!st.isFile()) {
    fs.closeSync(fd);
    throw notFound();
  }
  return { fd, size: st.size };
}

/** Streams `rel` (relative to the project dir) with HTTP Range support. */
export function sendExportFile(req: FastifyRequest, reply: FastifyReply, projectDir: string, rel: string, opts: { download?: string } = {}) {
  const { fd, size } = openRegular(projectDir, rel);
  const type = TYPES[path.extname(rel)] ?? 'application/octet-stream';
  reply.header('Content-Type', type).header('Accept-Ranges', 'bytes').header('Cache-Control', 'private, max-age=3600').header('X-Content-Type-Options', 'nosniff');
  if (opts.download) reply.header('Content-Disposition', `attachment; filename="${opts.download.replace(/[^\w.-]/g, '_')}"`);

  let start = 0;
  let end = size - 1;
  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!m || (m[1] === '' && m[2] === '')) {
      fs.closeSync(fd);
      return reply.code(416).header('Content-Range', `bytes */${size}`).send();
    }
    if (m[1] === '') {
      start = Math.max(0, size - Number(m[2]));
    } else {
      start = Number(m[1]);
      if (m[2] !== '') end = Math.min(end, Number(m[2]));
    }
    if (start > end || start >= size) {
      fs.closeSync(fd);
      return reply.code(416).header('Content-Range', `bytes */${size}`).send();
    }
    reply.code(206).header('Content-Range', `bytes ${start}-${end}/${size}`);
  }
  reply.header('Content-Length', end - start + 1);
  if (size === 0) {
    fs.closeSync(fd);
    return reply.send();
  }
  return reply.send(fs.createReadStream('', { fd, start, end, autoClose: true }));
}
