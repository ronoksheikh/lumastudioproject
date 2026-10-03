// In-page layout checks for preview-frames: finds the problems a student would see on screen but a
// model without vision cannot — overlapping text, text running off the stage, tiny text, blank frames
// and words that are still hidden after they were spoken. `probeLayout` is serialised into the page by
// puppeteer, so it must stay self-contained (no imports, no outer variables).

/** @param {{ t: number }} arg  @returns {string[]} one sentence per problem, empty when the frame looks fine */
export function probeLayout({ t }) {
  const stage = document.getElementById('stage');
  const S = stage.getBoundingClientRect();
  const W = window.ad?.size?.W ?? 1920;
  const k = S.width / W; // screen px per stage px
  const area = (r) => Math.max(0, r.r - r.l) * Math.max(0, r.b - r.t);
  const meet = (a, b) => ({ l: Math.max(a.l, b.l), t: Math.max(a.t, b.t), r: Math.min(a.r, b.r), b: Math.min(a.b, b.b) });
  const box = (r) => ({ l: r.left, t: r.top, r: r.right, b: r.bottom });
  const short = (s) => (s.length > 36 ? s.slice(0, 33) + '…' : s);
  const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

  const items = [];
  for (const el of stage.querySelectorAll('*')) {
    if (el.closest('#fx, #captions, script, style, defs')) continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
    if (!own) continue;
    if (!el.getClientRects().length) continue; // display:none somewhere above
    let op = 1;
    for (let a = el; a; a = a.parentElement) {
      op *= Number(getComputedStyle(a).opacity);
      if (a === stage) break;
    }
    const cs = getComputedStyle(el);
    const rect = box(el.getBoundingClientRect());
    // what is left after ancestors that cut their content (masks); the stage edge is checked separately
    let cut = box(el.getBoundingClientRect());
    for (let a = el.parentElement; a && a !== stage; a = a.parentElement) {
      const c = getComputedStyle(a);
      if (c.overflowX !== 'visible' || c.overflowY !== 'visible') cut = meet(cut, box(a.getBoundingClientRect()));
    }
    const vis = area(rect) > 0 ? area(cut) / area(rect) : 0;
    const hidden = cs.visibility === 'hidden' || op < 0.05 || vis < 0.05 || area(rect) < 1;
    items.push({ el, text: own, rect, cut, op, vis, hidden, shown: !hidden && op >= 0.6 && vis >= 0.6, px: parseFloat(cs.fontSize) || 0 });
  }

  const issues = [];
  const shown = items.filter((i) => i.shown);

  if (!shown.length) issues.push('no readable text is visible in this frame (fine for a pure-visual beat, a problem if words were meant to be on screen)');

  // text beyond the stage edge
  for (const i of shown) {
    const inside = area(meet(i.cut, box(S)));
    const out = 1 - inside / Math.max(1, area(i.cut));
    if (out > 0.08) issues.push(`text "${short(i.text)}" runs off the edge of the stage (${Math.round(out * 100)}% outside)`);
  }

  // text on top of other text
  const seen = new Set();
  for (let a = 0; a < shown.length && issues.length < 12; a++) {
    for (let b = a + 1; b < shown.length; b++) {
      const A = shown[a];
      const B = shown[b];
      if (A.el.contains(B.el) || B.el.contains(A.el)) continue;
      const m = area(meet(A.cut, B.cut));
      const small = Math.min(area(A.cut), area(B.cut));
      if (small > 0 && m / small > 0.3) {
        const key = [A.text, B.text].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        issues.push(`text "${short(A.text)}" overlaps "${short(B.text)}" (${Math.round((m / small) * 100)}% of the smaller one)`);
      }
    }
  }

  // too small to read on a phone
  const tiny = [...new Map(shown.filter((i) => i.px > 0 && i.px < 18 && i.text.length > 3).map((i) => [i.text, i])).values()];
  for (const i of tiny.slice(0, 3)) issues.push(`text "${short(i.text)}" is only ${Math.round(i.px)}px tall on a ${W}px stage — too small to read on a phone (ignore if it is decorative)`);

  // a word that was already spoken is still hidden while its neighbours are on screen
  const segs = window.ad?.segments ?? [];
  const seg = [...segs].reverse().find((s) => s.start <= t);
  if (seg) {
    const spoken = new Map(); // word → how many times it was already said
    for (const w of seg.words) if (w.start <= t - 0.35) spoken.set(norm(w.w), (spoken.get(norm(w.w)) ?? 0) + 1);
    const groups = new Map();
    for (const i of items) {
      const g = i.el.closest('.w')?.parentElement ?? i.el.parentElement;
      (groups.get(g) ?? groups.set(g, []).get(g)).push(i);
    }
    for (const list of groups.values()) {
      if (!list.some((i) => i.shown)) continue;
      const nth = new Map(); // the 2nd "the" on screen is only due once "the" was said twice
      for (const i of list) {
        const n = norm(i.text);
        nth.set(n, (nth.get(n) ?? 0) + 1);
        if (i.hidden && (spoken.get(n) ?? 0) >= nth.get(n)) issues.push(`the word "${short(i.text)}" was spoken before ${t.toFixed(2)}s but is still hidden while the words around it are showing — check its reveal time and mask`);
      }
    }
  }
  return issues.slice(0, 10).map((s) => `t=${t.toFixed(2)}s: ${s}`);
}

/**
 * Plain facts about the frame at time t, for a model that cannot see it (and as context for one that can):
 * which segment and word are being spoken, which scenes are on screen, and the readable text. Self-contained
 * like probeLayout (serialised into the page).
 * @param {{ t: number }} arg
 */
export function describeFrame({ t }) {
  const stage = document.getElementById('stage');
  const segs = window.ad?.segments ?? [];
  const seg = [...segs].reverse().find((s) => s.start <= t + 0.001) ?? null;
  let word = null;
  if (seg) {
    const i = seg.words.reduce((best, w, k) => (w.start <= t ? k : best), -1);
    if (i >= 0) word = { index: i, w: seg.words[i].w, start: seg.words[i].start, spokenNow: t <= seg.words[i].end + 0.05 };
  }
  const visible = (el) => {
    if (!el.getClientRects().length) return false;
    for (let a = el; a && a !== stage; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.3) return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const scenes = [...stage.querySelectorAll('#scenes > *')].filter(visible).map((el) => [...el.classList].filter((c) => c !== 'scene').join('.') || el.tagName.toLowerCase());
  // readable text, grouped by the nearest block (word spans joined back into lines)
  const lines = [];
  const seen = new Set();
  for (const el of stage.querySelectorAll('#scenes *')) {
    if (el.closest('.w') && !el.classList.contains('w')) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const isWordLine = el.querySelector(':scope > .w');
    if (!own && !isWordLine) continue;
    if (!visible(el)) continue;
    const text = isWordLine
      ? [...el.querySelectorAll(':scope > .w .wi')].filter(visible).map((w) => w.textContent.trim()).join(' ')
      : el.textContent.replace(/\s+/g, ' ').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    lines.push(text.length > 120 ? text.slice(0, 117) + '…' : text);
    if (lines.length >= 14) break;
  }
  return {
    t,
    segment: seg ? { id: seg.id, start: seg.start, end: seg.end, text: seg.words.map((w) => w.w).join(' ') } : null,
    word,
    scenes,
    text: lines,
  };
}
