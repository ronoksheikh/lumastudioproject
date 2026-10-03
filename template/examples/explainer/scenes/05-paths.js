// 6. PATHS — "কিন্তু এতদিন এসব বানাতে, হয় হাজার টাকা দিয়ে কাউকে হায়ার করতেন, নয়তো সারারাত জেগে নিজে।"
import { icons, bnNum, q, qa, splitWords } from '../lib/core.js';
import { countUp } from '../lib/recipes/counter.js';

export default function paths(ctx) {
  const { tl, w, S, BG, cue, show, add, onFrame, reveal, wordsOut } = ctx;
  const tracks = Array.from({ length: 16 }, (_, i) => {
    const keys = Array.from({ length: 5 }, (_, k) => `<b style="left:${8 + ((i * 13 + k * 19) % 84)}%"></b>`).join('');
    return `<div class="kt"><span class="mono">Layer ${i + 1}</span><div>${keys}</div></div>`;
  }).join('');
  const s = add(`
    <div class="scene s-paths">
      <div class="ph half left">
        <div class="ph-tag bn">কাউকে হায়ার করুন</div>
        <div class="fl-card">
          <div class="fl-top"><span class="av">${icons.person}</span><div><b class="en">Motion Designer</b><span class="stars">${icons.star.repeat(5)}</span></div></div>
          <div class="fl-price"><small class="bn">শুরু</small><b class="bn price">৳০</b></div>
          <div class="fl-meta"><span class="bn">ডেলিভারি <b>৩–৫ দিন</b></span><span class="bn">রিভিশন <b>+৳</b></span></div>
        </div>
      </div>
      <div class="ph half right">
        <div class="ph-tag bn">সারারাত জেগে নিজে</div>
        <div class="pile">${tracks}</div>
        <div class="hours"><span class="clk">${icons.clock}</span><b class="bn n">১</b><span class="bn">ঘণ্টা…</span></div>
      </div>
      <i class="ph-split"></i>
      <div class="ph-or bn">নয়তো</div>
      <div class="ph-intro bn">কিন্তু এতদিন এসব বানাতে…</div>
    </div>`);
  const start = S.paths.start;
  const end = S.you.start;
  show(s, start, end);
  tl.set(BG.uNight, { value: 1 }, start);

  const left = q(s, '.left');
  const right = q(s, '.right');
  // "কিন্তু এতদিন এসব বানাতে…" — the turn
  reveal(splitWords(q(s, '.ph-intro')), 'paths');
  const tSplit = w('paths', 4) - 0.1;
  wordsOut(q(s, '.ph-intro'), tSplit - 0.15);
  tl.fromTo(q(s, '.ph-split'), { scaleY: 0 }, { scaleY: 1, duration: 0.45, ease: 'expo.inOut' }, tSplit);
  tl.fromTo([left, right], { opacity: 0 }, { opacity: 1, duration: 0.3 }, tSplit);
  cue(tSplit, 'whoosh', 0.7);

  // "হাজার টাকা দিয়ে কাউকে হায়ার করতেন"
  const tH = w('paths', 5);
  const card = q(s, '.fl-card');
  tl.fromTo(card, { y: 80, opacity: 0, rotate: -4 }, { y: 0, opacity: 1, rotate: 0, duration: 0.55, ease: 'back.out(1.4)' }, tH - 0.2);
  tl.fromTo(qa(card, '.stars .ico'), { scale: 0 }, { scale: 1, duration: 0.25, stagger: 0.04, ease: 'back.out(3)' }, tH + 0.05);
  countUp(ctx, q(s, '.price'), {
    to: 15000, at: tH, dur: 0.7,
    format: (v) => '৳' + bnNum(Math.round(v / 100) * 100).replace(/(\S)(?=(\S{3})+$)/g, '$1,') + '+',
  });
  cue(tH, 'tick', 0.8);
  cue(tH + 0.35, 'tick', 0.6);
  tl.fromTo(q(left, '.ph-tag'), { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4 }, w('paths', 8));

  // "নয়তো সারারাত জেগে নিজে"
  const tD = w('paths', 11);
  tl.fromTo(q(s, '.ph-or'), { scale: 0.5, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35, ease: 'back.out(2)' }, tD - 0.05);
  tl.to(left, { opacity: 0.35, filter: 'grayscale(0.6)', duration: 0.4 }, tD);
  tl.to(q(s, '.ph-or'), { opacity: 0, duration: 0.25 }, tD + 0.5);
  tl.fromTo(q(right, '.ph-tag'), { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4 }, w('paths', 12));
  const kts = qa(s, '.kt');
  const tPile = w('paths', 12) - 0.1;
  const pileDur = S.paths.end - tPile;
  tl.fromTo(kts, { x: 60, opacity: 0 }, { x: 0, opacity: 1, duration: 0.3, stagger: pileDur / kts.length, ease: 'power3.out' }, tPile);
  tl.fromTo(qa(s, '.kt b'), { scale: 0, rotate: 45 }, { scale: 1, rotate: 45, duration: 0.2, stagger: pileDur / kts.length / 5 }, tPile + 0.05);
  tl.fromTo(q(s, '.pile'), { y: 0 }, { y: -120, duration: pileDur, ease: 'power1.in' }, tPile);
  const hours = q(s, '.hours');
  tl.fromTo(hours, { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4 }, tPile);
  countUp(ctx, q(hours, '.n'), { from: 1, to: 8, at: tPile, dur: pileDur, ease: 'power2.in', format: (v) => bnNum(Math.round(v)) });
  const handA = q(hours, '.hand');
  const handB = q(hours, '.hand2');
  onFrame((t) => {
    if (t < tPile || t > end) return;
    const k = t - tPile;
    handA.style.transform = `rotate(${k * 720}deg)`;
    handB.style.transform = `rotate(${k * 60}deg)`;
  });
  for (let i = 0; i < 8; i++) cue(tPile + i * (pileDur / 8), 'tick', 0.5);
  tl.to([left, right, q(s, '.ph-split')], { opacity: 0, scale: 0.94, duration: 0.25, ease: 'power3.in' }, end - 0.25);
}
