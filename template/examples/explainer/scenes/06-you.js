// 7. YOU — "এখন এগুলো আপনি নিজেই বানাবেন। ডিজাইন না জেনেও।"
import { icons, q, qa, splitWords } from '../lib/core.js';
import { loadMap, mapPoints } from '../lib/recipes/map-zoom.js';
import { stamp, stampMarkup } from '../lib/recipes/kinetic-type.js';
import { particlesTo } from '../lib/recipes/particles.js';

export default async function you(ctx) {
  const { tl, w, S, BG, cue, flash, shake, show, add, reveal } = ctx;
  const map = await loadMap(ctx);
  const { box: bdBox } = mapPoints(map);
  const bdPath = map.highlight ?? map.bd;
  const cards = [
    ['ZOOM', 'জুম', `<div class="ex ex-zoom">${'<i></i>'.repeat(3)}<span>${icons.lens}</span></div>`],
    ['MAP', 'ম্যাপ', `<div class="ex ex-map"><svg viewBox="${bdBox[0] - 6} ${bdBox[1] - 4} ${bdBox[2] + 12} ${bdBox[3] + 8}"><path d="${bdPath}"/></svg><i class="dot"></i></div>`],
    ['GRAPH', 'গ্রাফ', `<div class="ex ex-graph">${[30, 45, 38, 70, 95].map((v) => `<i style="--h:${v}"></i>`).join('')}</div>`],
    ['EXPLAINER', 'এক্সপ্লেইনার', `<div class="ex ex-call"><i class="dev"></i><b class="a"></b><b class="b"></b><span class="mono t1">Chip</span><span class="mono t2">Battery</span></div>`],
  ];
  const s = add(`
    <div class="scene s-you">
      <div class="yo-track">${cards.map(([en, bn, art]) => `<div class="yo-card">${art}<div class="yo-lab"><b class="en">${en}</b><span class="bn">${bn}</span></div></div>`).join('')}</div>
      <div class="yo-big bn">এখন এগুলো আপনি <b>নিজেই</b> বানাবেন</div>
      ${stampMarkup(icons.check, 'ডিজাইন না জেনেও', { cls: 'yo-stamp' })}
    </div>`);
  const start = S.you.start;
  const end = S.for.start;
  show(s, start, end);
  tl.set(BG.uNight, { value: 0 }, start);
  particlesTo(ctx, start, 0.2);
  flash(start, 0.4, 0.3);

  // "এগুলো" — everything we just showed comes back as a row of cards
  const yc = qa(s, '.yo-card');
  tl.fromTo(yc, { y: 260, opacity: 0, rotate: (i) => (i - 1.5) * 8, scale: 0.8 }, { y: 0, opacity: 1, rotate: 0, scale: 1, duration: 0.5, stagger: 0.08, ease: 'back.out(1.4)' }, start - 0.05);
  for (let i = 0; i < 4; i++) cue(start - 0.05 + i * 0.08, 'pop', 0.5);
  const tA = start + 0.35;
  tl.fromTo(qa(s, '.ex-zoom i'), { scale: 0.2, opacity: 1 }, { scale: 1.6, opacity: 0, duration: 0.8, stagger: 0.15, ease: 'power2.out', repeat: 2 }, tA);
  tl.fromTo(q(s, '.ex-map path'), { drawSVG: '0%' }, { drawSVG: '100%', duration: 0.5, ease: 'power2.inOut' }, tA + 0.08);
  tl.fromTo(q(s, '.ex-map .dot'), { scale: 0 }, { scale: 1, duration: 0.3, ease: 'back.out(3)' }, tA + 0.45);
  tl.fromTo(qa(s, '.ex-graph i'), { scaleY: 0 }, { scaleY: 1, duration: 0.4, stagger: 0.06, ease: 'back.out(1.5)', transformOrigin: '50% 100%' }, tA + 0.16);
  tl.fromTo(qa(s, '.ex-call b'), { scaleX: 0 }, { scaleX: 1, duration: 0.3, stagger: 0.12, transformOrigin: 'left center' }, tA + 0.24);
  tl.fromTo(qa(s, '.ex-call span'), { opacity: 0 }, { opacity: 1, duration: 0.2, stagger: 0.12 }, tA + 0.45);

  reveal(splitWords(q(s, '.yo-big')), 'you');
  tl.fromTo(q(s, '.yo-big b'), { color: '#ffffff' }, { color: '#BFE2FF', duration: 0.2 }, w('you', 3));
  shake(w('you', 3), 0.5);
  cue(w('you', 3), 'impact', 0.6);

  // "ডিজাইন না জেনেও" — stamp
  stamp(ctx, q(s, '.yo-stamp'), w('you', 5));
  tl.to([...s.children], { opacity: 0, y: -40, duration: 0.25, ease: 'power3.in' }, end - 0.25);
}
