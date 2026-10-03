// Starter scene 3 — bar-chart + counter recipes, white card on the blue stage.
import { q, splitWords } from '../lib/core.js';
import { barChart } from '../lib/recipes/bar-chart.js';
import { countUp, fmt } from '../lib/recipes/counter.js';
import { particlesTo } from '../lib/recipes/particles.js';

export default function chart(ctx) {
  const { tl, w, cue, flash, show, add, reveal } = ctx;
  const [start, end] = ctx.range('chart');
  const growth = barChart({
    title: 'Monthly views', chip: '+320%', lang: 'en', cls: 'c-card',
    values: [22, 31, 28, 46, 63, 92], labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'], valueFmt: (v) => `${v / 10}M`,
  });
  const s = add(`
    <div class="scene s-chart">
      <div class="c-num en">0</div>
      ${growth.html}
      <div class="c-cap en">Up and to the right.</div>
    </div>`);
  show(s, start, end);
  particlesTo(ctx, start, 0.18);
  flash(start + 0.05, 0.4, 0.3);
  cue(start, 'whoosh', 0.6);

  const num = q(s, '.c-num');
  tl.fromTo(num, { scale: 1.3, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35 }, start + 0.05);
  countUp(ctx, num, { to: 4.2, at: start + 0.05, dur: 0.9, format: fmt.millions(1) });
  const tBars = w('chart', 2); // "Growth at a glance" → bars land on "at a glance"
  tl.to(num, { y: -40, scale: 0.7, duration: 0.45, ease: 'power3.inOut' }, tBars - 0.35);
  tl.fromTo(q(s, '.c-card'), { y: 160, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5 }, tBars - 0.3);
  growth.animate(ctx, s, { at: tBars, trendAt: w('chart', 4), focusAt: w('chart', 6) });
  reveal(splitWords(q(s, '.c-cap')), 'chart', 4);
  tl.to([q(s, '.c-card'), num, q(s, '.c-cap')], { opacity: 0, y: -40, duration: 0.25, ease: 'power3.in' }, end - 0.25);
}
