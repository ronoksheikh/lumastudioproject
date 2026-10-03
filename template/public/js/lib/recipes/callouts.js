// A device with leader lines and labels pointing at its parts (product explainers).
// Coordinates: `d` paths live in a 1000×560 viewBox laid over a 1200×675 box; `left`/`top` place each label in px.
import { q, qa } from '../core.js';

export const PHONE_CALLOUTS = [
  { text: 'Camera', d: 'M520 200 L700 110 L820 110', left: 990, top: 140 },
  { text: 'Battery', d: 'M440 360 L280 450 L160 450', left: 60, top: 470 },
  { text: 'Chip', d: 'M560 380 L720 470 L840 470', left: 1000, top: 520 },
];

export function calloutsMarkup({ items = PHONE_CALLOUTS, cls = '' } = {}) {
  return `<div class="rc-callout ${cls}">
    <div class="device"><i></i></div>
    <svg viewBox="0 0 1000 560">${items.map((it) => `<path d="${it.d}"/>`).join('')}</svg>
    ${items.map((it, i) => `<span class="cl l${i + 1} en" style="left:${it.left}px;top:${it.top}px">${it.text}</span>`).join('')}
  </div>`;
}

/** Device pops in at `at`, lines draw 0.1s later, labels fade in. */
export function animateCallouts(ctx, root, { at }) {
  const { tl } = ctx;
  tl.fromTo(q(root, '.device'), { scale: 0.7, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3 }, at);
  tl.fromTo(qa(root, 'svg path'), { drawSVG: '0%' }, { drawSVG: '100%', duration: 0.2, stagger: 0.08 }, at + 0.1);
  tl.fromTo(qa(root, '.cl'), { opacity: 0 }, { opacity: 1, duration: 0.15, stagger: 0.08 }, at + 0.2);
}
