// Zero-dependency static server for the ad.
//   /           -> public/
//   /vendor/*   -> node_modules/*  (three, gsap)
// Supports HTTP Range requests so the audio element can seek.

import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 5173;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
};

function resolve(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  const [base, rel] = clean.startsWith('/vendor/')
    ? [path.join(root, 'node_modules'), clean.slice('/vendor/'.length)]
    : [path.join(root, 'public'), clean === '/' ? 'index.html' : clean.slice(1)];
  const file = path.normalize(path.join(base, rel));
  return file.startsWith(base) ? file : null;
}

http
  .createServer(async (req, res) => {
    const file = resolve(req.url);
    let info;
    try {
      info = file && (await stat(file));
    } catch { /* falls through to 404 */ }
    if (!info?.isFile()) {
      res.writeHead(404).end('Not found');
      return;
    }

    const headers = {
      'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
    };
    const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
    if (range) {
      // a suffix range ("bytes=-500") means the last N bytes
      const start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2] || 0));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
      if (start >= info.size || start > end) {
        // e.g. a cached range from a longer, older version of the file
        res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }).end();
        return;
      }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${info.size}`, 'Content-Length': end - start + 1 });
      createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { ...headers, 'Content-Length': info.size });
      createReadStream(file).pipe(res);
    }
  })
  .listen(PORT, () => console.log(`Lumademy ad → http://localhost:${PORT}`));
