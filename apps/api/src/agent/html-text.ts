/** Small HTML → readable text/markdown converter for web_fetch (no dependencies, good enough for docs and articles). */
const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ', '&apos;': "'" };

export function htmlToText(html: string): string {
  let s = html;
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<(script|style|noscript|svg|head|template)\b[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, n, t) => `\n\n${'#'.repeat(Number(n))} ${t.replace(/<[^>]+>/g, '').trim()}\n\n`);
  s = s.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, t) => {
    const text = t.replace(/<[^>]+>/g, '').trim();
    return text && !href.startsWith('#') && !href.startsWith('javascript:') ? `[${text}](${href})` : text;
  });
  s = s.replace(/<li\b[^>]*>/gi, '\n- ').replace(/<\/(p|div|section|article|tr|ul|ol|table|blockquote|pre)>/gi, '\n\n').replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_m, c) => '\n```\n' + c.replace(/<[^>]+>/g, '') + '\n```\n');
  s = s.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_m, c) => '`' + c.replace(/<[^>]+>/g, '') + '`');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/&(amp|lt|gt|quot|nbsp|apos|#39);/g, (m) => ENTITIES[m] ?? m).replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)));
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
}
