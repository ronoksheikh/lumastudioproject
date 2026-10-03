// 2. TEN — "দশজনের মধ্যে একজন? চোখের সামনে।"
import { icons, qa, q, splitWords } from '../lib/core.js';
import { morph } from '../lib/recipes/particles.js';

export default function ten(ctx) {
  const { tl, w, S, P, cue, flash, shake, show, add, wordIn } = ctx;
  const s = add(`
    <div class="scene s-ten">
      <div class="tn-row">${Array.from({ length: 10 }, (_, i) => `<div class="pp ${i === 6 ? 'one' : ''}">${icons.person}</div>`).join('')}</div>
      <svg class="tn-call" viewBox="0 0 1920 1080"><path d="M1086 600 C 1120 760 1240 800 1330 800"/></svg>
      <div class="tn-label"><b class="bn">১০ জনের মধ্যে ১ জন</b><span class="mono">1 IN 10 · 10%</span></div>
      <div class="tn-cap2 bn">চোখের সামনে।</div>
    </div>`);
  const start = S.ten.start;
  const end = S.map.start;
  show(s, start, end);
  tl.to(P.uOpacity, { value: 0.12, duration: 0.4 }, start);

  const pps = qa(s, '.pp');
  tl.fromTo(pps, { y: 80, opacity: 0, scale: 0.6 }, { y: 0, opacity: 1, scale: 1, duration: 0.4, stagger: 0.03, ease: 'back.out(2)' }, start - 0.12);
  for (let i = 0; i < 10; i++) cue(start - 0.12 + i * 0.03, 'tick', 0.45);

  // zoom into the one
  const one = pps[6];
  const row = q(s, '.tn-row');
  const tOne = w('ten', 2);
  tl.to(pps.filter((p) => p !== one), { opacity: 0.18, duration: 0.35 }, tOne - 0.1);
  tl.to(row, { scale: 2.3, x: -360, y: -40, duration: 0.7, ease: 'power3.inOut' }, tOne - 0.2);
  tl.to(one, { '--lit': 1, duration: 0.3 }, tOne);
  tl.fromTo(one, { scale: 1 }, { keyframes: [{ scale: 1.25, duration: 0.15 }, { scale: 1.1, duration: 0.4, ease: 'back.out(3)' }] }, tOne);
  flash(tOne, 0.25, 0.3);
  shake(tOne, 0.6);
  cue(tOne, 'impact', 0.8);
  cue(tOne + 0.05, 'shimmer', 0.6);

  // "চোখের সামনে।" — callout
  const tCall = w('ten', 3) - 0.15;
  tl.fromTo(q(s, '.tn-call path'), { drawSVG: '0%' }, { drawSVG: '100%', duration: 0.4, ease: 'power2.inOut' }, tCall);
  const lab = q(s, '.tn-label');
  tl.fromTo(lab, { x: -30, opacity: 0 }, { x: 0, opacity: 1, duration: 0.45 }, tCall + 0.25);
  splitWords(q(s, '.tn-cap2')).forEach((wd, i) => wordIn(wd, w('ten', 3 + i)));
  cue(tCall + 0.25, 'pop', 0.7);

  // the world arrives: particles gather into a spinning globe
  tl.to([row, lab, q(s, '.tn-call'), q(s, '.tn-cap2')], { opacity: 0, scale: 0.9, duration: 0.3, ease: 'power3.in' }, end - 0.45);
  morph(ctx, end - 0.5, 'sphere', { opacity: 0.9, jitter: 0.02, spin: { to: 3, dur: 1.2 } });
  cue(end - 0.5, 'riser', 0.5);
}
