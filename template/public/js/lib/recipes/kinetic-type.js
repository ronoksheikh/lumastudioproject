// Kinetic typography: masked word reveals, punch-in captions, stamps.
import { splitWords } from '../core.js';

/** Splits `node` into words and reveals each one (slide up through a mask + fade) on its spoken word.
 *  offset = index of the first word of `node` inside segment `id`. Returns the word spans. */
export function maskedWords(ctx, node, id, offset = 0) {
  const words = splitWords(node);
  ctx.reveal(words, id, offset);
  return words;
}

/** Faster, punchier version for hooks: every word slams in (scale 1.3 → 1) right on its word. */
export function punchWords(ctx, node, id, offset = 0, { duration = 0.25 } = {}) {
  const words = splitWords(node);
  words.forEach((wd, i) =>
    ctx.tl.fromTo(wd, { yPercent: 120, opacity: 0, scale: 1.3 }, { yPercent: 0, opacity: 1, scale: 1, duration }, ctx.w(id, offset + i) - 0.02));
  return words;
}

/** A stamp slamming onto the screen at time `t` (+ flash, shake, impact sound). Node needs class `rc-stamp` or equivalent. */
export function stamp(ctx, node, t, { rotate = -4, fromScale = 2.4, fromRotate = 10, lead = 0.05, flash = 0.3, shake = 0.9, sound = 'impact', gain = 0.9 } = {}) {
  ctx.tl.fromTo(node, { scale: fromScale, rotate: fromRotate, opacity: 0 }, { scale: 1, rotate, opacity: 1, duration: 0.35, ease: 'back.out(1.7)' }, t - lead);
  if (flash) ctx.flash(t, flash, 0.3);
  if (shake) ctx.shake(t, shake);
  if (sound) ctx.cue(t, sound, gain);
}

/** Markup for a check-mark stamp: `<div class="rc-stamp ...">✓ text</div>`. Position it with your own class. */
export function stampMarkup(icon, text, { cls = '', lang = 'bn' } = {}) {
  return `<div class="rc-stamp ${lang} ${cls}">${icon}<span>${text}</span></div>`;
}
