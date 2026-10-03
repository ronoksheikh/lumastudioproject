// Starter scene 1 — the hook. Rule: full energy from t=0 (impact + flash), the strongest claim first.
import { icons, q } from '../lib/core.js';
import { maskedWords } from '../lib/recipes/kinetic-type.js';
import { particlesTo } from '../lib/recipes/particles.js';

export default function title(ctx) {
  const { tl, S, cue, flash, shake, show, add, wordsOut } = ctx;
  const [start, end] = ctx.range('title');
  const s = add(`
    <div class="scene s-title">
      <div class="t-chip mono">${icons.spark} MADE WITH LUMA STUDIO</div>
      <div class="t-main en">This whole video was built from a single prompt.</div>
    </div>`);
  show(s, 0, end + 0.02);

  // impact on the very first frame
  flash(0, 0.7, 0.4);
  shake(0, 1, 0.45);
  cue(0, 'impact', 1);
  cue(0, 'whoosh', 0.6);
  particlesTo(ctx, 0, 0.5, 0.6);

  maskedWords(ctx, q(s, '.t-main'), 'title', 0);
  tl.fromTo(q(s, '.t-chip'), { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.4, ease: 'back.out(2)' }, S.title.start + 0.05);
  wordsOut(s, end - 0.3);
}
