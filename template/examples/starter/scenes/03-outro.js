// Starter scene 4 — call to action: the 3D logo lands, the line reveals, the lockup fades in.
import { q, splitWords } from '../lib/core.js';
import { logoIn } from '../lib/recipes/logo3d.js';
import { morph } from '../lib/recipes/particles.js';

export default function outro(ctx) {
  const { tl, w, cue, flash, shake, add, brand } = ctx;
  const [start] = ctx.range('cta');
  const s = add(`
    <div class="scene s-cta">
      <div class="o-line en">Make yours today.</div>
      <img class="o-lockup" src="${brand.logo.lockup}" alt="" />
    </div>`);
  tl.set(s, { autoAlpha: 1 }, start);

  logoIn(ctx, start, { y: 2.3 });
  morph(ctx, start, 'scatter', { opacity: 0.25, jitter: 0.3 });
  flash(start, 0.7, 0.5);
  shake(start, 0.8);
  cue(start, 'impact', 0.9);
  cue(start, 'shimmer', 0.8);

  splitWords(q(s, '.o-line')).forEach((wd, i) => ctx.wordIn(wd, w('cta', i)));
  tl.fromTo(q(s, '.o-lockup'), { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6 }, w('cta', 2));
}
