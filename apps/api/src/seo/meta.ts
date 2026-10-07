// Search engines and link previews. The app is a SPA, so the server fills each page's <head> (title, description,
// canonical, robots, Open Graph) before sending index.html, and serves robots.txt + sitemap.xml. Public pages
// (log in, API docs) are indexed; everything behind the login is noindex.
import { config } from '../config.js';

export const SITE_NAME = 'Luma Studio';
export const DEFAULT_DESCRIPTION =
  'Luma Studio by Lumademy is an AI motion-graphics agent: describe a video and it writes the script, records the voiceover, animates every scene with GSAP and Three.js, checks its own work and renders a 1080p MP4.';

interface PageMeta { title: string; description: string; index: boolean; path: string }

/** Public, indexable pages (also the sitemap). */
const PUBLIC: Record<string, Omit<PageMeta, 'path' | 'index'>> = {
  '/login': {
    title: 'Luma Studio — AI motion graphics agent by Lumademy',
    description: DEFAULT_DESCRIPTION,
  },
  '/docs/api': {
    title: 'Luma Studio API — make motion-graphics videos from code',
    description: 'Luma Studio API docs: create a project, brief the AI motion-graphics agent, render the MP4 and download it — with an API key, from your own code.',
  },
};

export function pageMeta(url: string): PageMeta {
  const path = (url.split('?')[0] ?? '/').replace(/\/+$/, '') || '/';
  if (path === '/') return { ...PUBLIC['/login']!, path: '/login', index: true }; // signed-out visitors land on the login
  const pub = PUBLIC[path];
  if (pub) return { ...pub, path, index: true };
  if (path === '/signup') return { ...PUBLIC['/login']!, title: 'Create your account — Luma Studio', path: '/login', index: false };
  return { title: SITE_NAME, description: DEFAULT_DESCRIPTION, path, index: false };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const origin = () => config.appOrigin.replace(/\/+$/, '');

function head(m: PageMeta): string {
  const url = `${origin()}${m.path}`;
  const image = `${origin()}/og-image.png`;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SITE_NAME,
    applicationCategory: 'MultimediaApplication',
    applicationSubCategory: 'AI motion graphics and video creation',
    operatingSystem: 'Web browser',
    url: origin(),
    image,
    description: DEFAULT_DESCRIPTION,
    inLanguage: ['en', 'bn'],
    publisher: { '@type': 'Organization', name: 'Lumademy', url: 'https://lumademy.com', logo: `${origin()}/Lumademy_Icon_Blue.svg` },
  };
  return [
    `<title>${esc(m.title)}</title>`,
    `<meta name="description" content="${esc(m.description)}" />`,
    `<meta name="robots" content="${m.index ? 'index, follow, max-image-preview:large' : 'noindex, nofollow'}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${SITE_NAME} by Lumademy" />`,
    `<meta property="og:title" content="${esc(m.title)}" />`,
    `<meta property="og:description" content="${esc(m.description)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:image" content="${esc(image)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="Luma Studio — AI motion graphics agent by Lumademy" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(m.title)}" />`,
    `<meta name="twitter:description" content="${esc(m.description)}" />`,
    `<meta name="twitter:image" content="${esc(image)}" />`,
    m.index ? `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>` : '',
  ].filter(Boolean).join('\n    ');
}

/** index.html with this page's head between the `<!-- seo:start -->` / `<!-- seo:end -->` markers. */
export function renderIndex(html: string, url: string): string {
  return html.replace(/<!-- seo:start -->[\s\S]*?<!-- seo:end -->/, `<!-- seo:start -->\n    ${head(pageMeta(url))}\n    <!-- seo:end -->`);
}

export function robotsTxt(): string {
  return [
    'User-agent: *',
    'Allow: /$',
    'Allow: /login',
    'Allow: /docs/api',
    'Disallow: /api/',
    'Disallow: /p/',
    'Disallow: /projects/',
    'Disallow: /settings',
    'Disallow: /admin',
    'Disallow: /improvements',
    'Disallow: /signup',
    '',
    `Sitemap: ${origin()}/sitemap.xml`,
    '',
  ].join('\n');
}

export function sitemapXml(lastmod = new Date().toISOString().slice(0, 10)): string {
  const urls = Object.keys(PUBLIC).map((p) => `  <url><loc>${esc(origin() + p)}</loc><lastmod>${lastmod}</lastmod><changefreq>weekly</changefreq><priority>${p === '/login' ? '1.0' : '0.7'}</priority></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}
