// 9. END CARD — "লুমাডেমি এআই মোশন গ্রাফিক্স ক্র্যাশ কোর্স। আজই এনরোল করুন।"
import { icons, q, qa } from '../lib/core.js';
import { morph } from '../lib/recipes/particles.js';
import { logoIn } from '../lib/recipes/logo3d.js';

export default function end(ctx) {
  const { tl, w, S, BG, cue, flash, shake, onFrame, add } = ctx;
  const flow = ['Prompt', 'Animate', 'Map & Graph', 'Voice Sync', 'Export'];
  const s = add(`
    <div class="scene s-end">
      <div class="en-title en"><span>AI</span> <span>Motion</span> <span>Graphics</span> <span>Crash</span> <span>Course</span></div>
      <div class="en-flow">${flow.map((f, i) => `<span class="en">${f}</span>${i < flow.length - 1 ? '<i>→</i>' : ''}`).join('')}</div>
      <div class="en-now bn">আজই Enroll করুন</div>
      <div class="en-btn en"><span class="lbl">Enroll Now</span><span class="go">${icons.arrow}</span><i class="touch"></i></div>
    </div>`);
  const start = S.learn.start;
  tl.set(s, { autoAlpha: 1 }, start);
  tl.set(BG.uNight, { value: 0 }, start);

  // the particle mark becomes the solid 3D logo
  logoIn(ctx, start, { y: 2.3, x: 0 });
  morph(ctx, start + 0.05, 'scatter', { dur: 1.2, ease: 'power3.out', opacity: 0.25, opacityDur: 1, jitter: 0.3 });
  flash(start, 0.8, 0.5);
  shake(start, 0.8);
  cue(start, 'impact', 0.9);
  cue(start, 'shimmer', 0.8);

  qa(s, '.en-title span').forEach((sp, i) => {
    tl.fromTo(sp, { yPercent: 110, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.4 }, w('learn', 1 + i) - 0.04);
    cue(w('learn', 1 + i), 'tick', 0.5);
  });
  tl.fromTo(qa(s, '.en-flow > *'), { x: 20, opacity: 0 }, { x: 0, opacity: 1, duration: 0.3, stagger: 0.05 }, w('learn', 5) + 0.1);

  // CTA
  const tN = w('cta', 0);
  tl.fromTo(q(s, '.en-now'), { scale: 1.5, opacity: 0, filter: 'blur(14px)' }, { scale: 1, opacity: 1, filter: 'blur(0px)', duration: 0.4 }, tN);
  cue(tN, 'impact', 0.7);
  const btn = q(s, '.en-btn');
  tl.fromTo(btn, { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45 }, tN + 0.1);
  const tClick = w('cta', 2) + 0.3;
  tl.fromTo(q(btn, '.touch'), { scale: 1.8, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.25 }, tClick - 0.25);
  tl.to(q(btn, '.touch'), { scale: 0.6, opacity: 0, duration: 0.3, ease: 'power2.in' }, tClick + 0.02);
  tl.to(btn, { keyframes: [{ scale: 0.95, duration: 0.08 }, { scale: 1, duration: 0.4, ease: 'expo.out' }] }, tClick);
  cue(tClick, 'click', 0.8);
  onFrame((t) => {
    if (t < tClick + 0.5) return;
    btn.style.boxShadow = `0 24px 70px rgba(3,20,70,.4), 0 0 0 ${8 + Math.sin(t * 4) * 6}px rgba(255,255,255,.16)`;
  });
}
