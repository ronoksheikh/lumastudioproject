// Serves a project's preview straight from its folder — there is no dev server per project.
//   /vendor/<pkg>/…  -> <project>/node_modules/<pkg>, else the shared base (/opt/luma/node_modules)
//   /assets/…        -> <project>/assets
//   /project.json, /brand.json, /script.json -> project root
//   everything else  -> <project>/public
// Same mapping as template/server.mjs. Range requests are supported; unsatisfiable ranges answer 416.
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};
const ROOT_FILES = new Set(['project.json', 'brand.json', 'script.json']);

const within = (base: string, target: string) => target === base || target.startsWith(base + path.sep);

/** The first existing regular file for a URL path, or null. Symlinks may not lead outside their base. */
export function resolvePreviewFile(projectDir: string, urlPath: string, sharedModules: string = config.sharedModules): string | null {
  let clean: string;
  try {
    clean = decodeURIComponent(urlPath.split('?')[0]!);
  } catch {
    return null;
  }
  if (clean.includes('\0')) return null;
  const bases: Array<[string, string]> = [];
  if (clean.startsWith('/vendor/')) {
    const rel = clean.slice('/vendor/'.length);
    bases.push([path.join(projectDir, 'node_modules'), rel], [sharedModules, rel]);
  } else if (clean.startsWith('/assets/')) bases.push([path.join(projectDir, 'assets'), clean.slice('/assets/'.length)]);
  else if (ROOT_FILES.has(clean.slice(1))) bases.push([projectDir, clean.slice(1)]);
  else bases.push([path.join(projectDir, 'public'), clean === '/' || clean === '' ? 'index.html' : clean.slice(1)]);

  for (const [base, rel] of bases) {
    const file = path.normalize(path.join(base, rel));
    if (!within(base, file)) continue;
    try {
      const real = fs.realpathSync(file);
      const realBase = fs.realpathSync(base);
      if (!within(realBase, real)) continue; // symlink pointing out of its base
      if (fs.statSync(real).isFile()) return real;
    } catch { /* try the next base */ }
  }
  return null;
}

/** Streams `file` with Range support. */
export function sendFile(req: FastifyRequest, reply: FastifyReply, file: string) {
  const size = fs.statSync(file).size;
  const headers: Record<string, string | number> = {
    'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  };
  const range = /bytes=(\d*)-(\d*)/.exec(String(req.headers.range ?? ''));
  if (range) {
    // a suffix range ("bytes=-500") means the last N bytes
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2] || 0));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      return reply.code(416).headers({ 'Content-Range': `bytes */${size}` }).send();
    }
    return reply
      .code(206)
      .headers({ ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 })
      .send(fs.createReadStream(file, { start, end }));
  }
  return reply.code(200).headers({ ...headers, 'Content-Length': size }).send(fs.createReadStream(file));
}

export function servePreview(req: FastifyRequest, reply: FastifyReply, projectDir: string, urlPath: string) {
  const file = resolvePreviewFile(projectDir, urlPath);
  if (!file) return reply.code(404).send('Not found');
  return sendFile(req, reply, file);
}
