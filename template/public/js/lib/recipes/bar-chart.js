// Animated bar chart with value labels, a trend line, a headline chip and a "focus on the winner" beat.
// Usage:
//   const chart = barChart({ title: 'মাসিক ভিউ', chip: '+320%', values: [22, 31, 28, 46, 63, 92], labels: [...], valueFmt: (v) => `${v / 10}M` });
//   const s = ctx.add(`<div class="scene">… <div class="my-chart">${chart.html}</div> …</div>`);   // position it in scenes.css
//   chart.animate(ctx, s, { at: tBars, trendAt: tTrend, focusAt: tFocus });
// values are 0–100 (relative bar height).
import { q, qa } from '../core.js';

export function barChart({ title = '', chip = '', values, labels = [], valueFmt = (v) => String(v), lang = 'en', cls = '', trend = true, grid = 4 }) {
  const n = values.length;
  // trend polyline in a 600×300 viewBox, aligned with the bar tops
  const pts = values.map((v, i) => `${i ? 'L' : 'M'}${Math.round(((i + 0.5) * 600) / n)} ${Math.round(300 - 2.78 * v)}`).join(' ');
  const html = `
    <div class="rc-chart ${cls}">
      <div class="rc-chart-head"><span class="t ${lang}">${title}</span>${chip ? `<span class="rc-chip en">${chip}</span>` : ''}</div>
      <div class="rc-plot">
        <div class="rc-grid">${'<i></i>'.repeat(grid)}</div>
        ${values.map((v, i) => `<div class="rc-bar" style="--h:${v}"><b class="mono">${valueFmt(v)}</b><i></i><span class="${lang}">${labels[i] ?? ''}</span></div>`).join('')}
        ${trend ? `<svg class="rc-trend" viewBox="0 0 600 300" preserveAspectRatio="none"><path d="${pts}"/></svg>` : ''}
      </div>
    </div>`;

  /**
   * at       – bars start growing
   * labelsAt – value labels appear (default at + 0.25)
   * trendAt  – trend line draws (default at + 0.55); chip pops 0.3s later
   * focusAt  – dim every bar except `focus` (default: the last one)
   */
  function animate(ctx, root, { at, labelsAt = at + 0.25, trendAt = at + 0.55, focusAt, focus = values.length - 1 }) {
    const { tl } = ctx;
    const bars = qa(root, '.rc-bar');
    tl.fromTo(qa(root, '.rc-bar i'), { scaleY: 0 }, { scaleY: 1, duration: 0.5, stagger: 0.06, ease: 'back.out(1.4)', transformOrigin: '50% 100%' }, at);
    tl.fromTo(qa(root, '.rc-bar b'), { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.3, stagger: 0.06 }, labelsAt);
    for (let i = 0; i < bars.length; i++) ctx.cue(at + i * 0.06, 'pop', 0.35);
    const path = q(root, '.rc-trend path');
    if (path) tl.fromTo(path, { drawSVG: '0%' }, { drawSVG: '100%', duration: 0.5, ease: 'power2.inOut' }, trendAt);
    const chipEl = q(root, '.rc-chip');
    if (chipEl) {
      tl.fromTo(chipEl, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35, ease: 'back.out(3)' }, trendAt + 0.3);
      ctx.cue(trendAt + 0.3, 'shimmer', 0.6);
    }
    if (focusAt != null) {
      tl.to(bars.filter((_, i) => i !== focus), { opacity: 0.35, duration: 0.3 }, focusAt);
      tl.to(bars[focus], { scale: 1.06, duration: 0.3, transformOrigin: '50% 100%' }, focusAt);
    }
    return bars;
  }
  return { html, animate };
}
