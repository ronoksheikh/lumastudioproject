// 4. GRAPH — "কত বাড়ল? এক গ্রাফেই পরিষ্কার।"
import { q } from '../lib/core.js';
import { barChart } from '../lib/recipes/bar-chart.js';
import { countUp, fmt } from '../lib/recipes/counter.js';
import { particlesTo } from '../lib/recipes/particles.js';
import { splitWords } from '../lib/core.js';

export default function graph(ctx) {
  const { tl, w, S, BG, cue, flash, show, add, reveal } = ctx;
  const vals = [22, 31, 28, 46, 63, 92];
  const months = ['জানু', 'ফেব্রু', 'মার্চ', 'এপ্রিল', 'মে', 'জুন'];
  const chart = barChart({ title: 'মাসিক ভিউ', chip: '+320%', values: vals, labels: months, valueFmt: (v) => `${v / 10}M`, lang: 'bn', cls: 'gr-card' });
  const s = add(`
    <div class="scene s-graph">
      <div class="gr-num"><b class="en n">0</b><span class="bn">ভিউ</span></div>
      ${chart.html}
      <div class="gr-cap bn">এক গ্রাফেই পরিষ্কার</div>
    </div>`);
  const start = S.graph.start;
  const end = S.youtube.start;
  show(s, start, end);
  tl.set(BG.uNight, { value: 0 }, start);
  particlesTo(ctx, start, 0.18);
  flash(start + 0.05, 0.45, 0.3);
  cue(start, 'whoosh', 0.6);

  // "কত বাড়ল?" — the number counts up
  const num = q(s, '.gr-num');
  tl.fromTo(num, { scale: 1.4, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35 }, start + 0.05);
  countUp(ctx, q(num, '.n'), { to: 4.2, at: start + 0.05, dur: 0.8, format: fmt.millions(1) });
  cue(start + 0.1, 'tick', 0.8);

  // "এক গ্রাফেই" — bars
  const card = q(s, '.gr-card');
  const tG = w('graph', 2);
  tl.to(num, { y: -330, scale: 0.55, duration: 0.45, ease: 'power3.inOut' }, tG - 0.35);
  tl.fromTo(card, { y: 160, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5 }, tG - 0.3);
  // "পরিষ্কার" — trend line, then focus on the winner
  chart.animate(ctx, s, { at: tG - 0.05, labelsAt: tG + 0.2, trendAt: w('graph', 3) + 0.1, focusAt: w('graph', 4) });
  reveal(splitWords(q(s, '.gr-cap')), 'graph', 2);
  tl.to([card, num, q(s, '.gr-cap')], { opacity: 0, y: -40, duration: 0.25, ease: 'power3.in' }, end - 0.25);
}
