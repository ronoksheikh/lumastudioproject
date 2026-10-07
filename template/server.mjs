// Zero-dependency static server for a Luma project.
//   /vendor/<pkg>/…  -> <project>/node_modules/<pkg>, else the shared base (NODE_PATH, e.g. /opt/luma/node_modules)
//   /assets/…        -> <project>/assets, else the engine's assets (fonts, logos, world map)
//   /project.json, /brand.json, /script.json -> project root
//   everything else  -> <project>/public, else the engine's public/ (index.html, main.js, lib/, base css)
// The engine is the folder this file lives in. A project only holds its own files (scenes, audio, styles,
// assets); anything it does not have comes from the engine — except the project-owned paths below, which
// never fall back (an empty project must look empty, not like a demo).
// Range requests are supported (audio seeking). Unsatisfiable ranges answer 416 (pitfall #10).

import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const defaultRoot = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 5173;
const HOST = process.env.HOST || '0.0.0.0';
const SHARED = (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean);
const ROOT_FILES = new Set(['project.json', 'brand.json', 'script.json']);
/** Paths (relative to public/) that belong to the project alone. */
export const PROJECT_OWNED = /^(js\/scenes(\/|$)|audio(\/|$)|css\/scenes\.css$)/;

const TYPES = {
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
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
};

const inside = (base, file) => file === base || file.startsWith(base + path.sep);

/** Candidate files for a URL path, most specific first. */
export function candidates(urlPath, root = defaultRoot) {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  const within = (base, rel) => {
    const file = path.normalize(path.join(base, rel));
    return inside(base, file) ? file : null;
  };
  if (clean.startsWith('/vendor/')) {
    const rel = clean.slice('/vendor/'.length);
    return [path.join(root, 'node_modules'), ...SHARED].map((b) => within(b, rel)).filter(Boolean);
  }
  const engine = path.resolve(defaultRoot) === path.resolve(root) ? [] : [defaultRoot];
  if (clean.startsWith('/assets/')) {
    const rel = clean.slice('/assets/'.length);
    return [root, ...engine].map((b) => within(path.join(b, 'assets'), rel)).filter(Boolean);
  }
  if (ROOT_FILES.has(clean.slice(1))) return [path.join(root, clean.slice(1))];
  const rel = clean === '/' ? 'index.html' : clean.slice(1);
  const bases = PROJECT_OWNED.test(rel) ? [root] : [root, ...engine];
  return bases.map((b) => within(path.join(b, 'public'), rel)).filter(Boolean);
}

async function find(urlPath, root) {
  for (const file of candidates(urlPath, root)) {
    try {
      const info = await stat(file);
      if (info.isFile()) return { file, info };
    } catch { /* try the next candidate */ }
  }
  return null;
}

export function createServer(root = defaultRoot) {
  return http.createServer(async (req, res) => {
    const hit = await find(req.url, root);
    if (!hit) {
      res.writeHead(404).end('Not found');
      return;
    }
    const { file, info } = hit;
    const headers = {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
    };
    if (req.method === 'HEAD') {
      res.writeHead(200, { ...headers, 'Content-Length': info.size }).end();
      return;
    }
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
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--root');
  const root = path.resolve(i > 0 ? process.argv[i + 1] : process.cwd());
  createServer(root).listen(PORT, HOST, () => console.log(`Luma project ${root} → http://localhost:${PORT}`));
}
