// 8. FOR — "নিজের ভিডিওতে, অথবা ক্লায়েন্টের কাজে।"
import { icons, q, qa } from '../lib/core.js';
import { countUp, fmt } from '../lib/recipes/counter.js';
import { morph } from '../lib/recipes/particles.js';

export default function forScene(ctx) {
  const { tl, w, S, BG, cue, show, add } = ctx;
  const s = add(`
    <div class="scene s-for">
      <div class="fo-card own">
        <div class="fo-ico">${icons.camera}</div>
        <b class="bn">নিজের ভিডিওতে</b>
        <div class="fo-meta"><span class="mono">YOUR CHANNEL</span><span class="fo-views en">+<b>0</b> views</span></div>
      </div>
      <div class="fo-or bn">অথবা</div>
      <div class="fo-card client">
        <div class="fo-ico">${icons.brief}</div>
        <b class="bn">ক্লায়েন্টের কাজে</b>
        <div class="fo-meta"><span class="mono">INVOICE #024</span><span class="fo-paid en">${icons.check} Paid</span></div>
      </div>
    </div>`);
  const start = S.for.start;
  const end = S.learn.start;
  show(s, start, end);
  tl.set(BG.uNight, { value: 0 }, start);
  const [own, client] = qa(s, '.fo-card');
  tl.fromTo(own, { x: -200, opacity: 0, rotateY: 30 }, { x: 0, opacity: 1, rotateY: 0, duration: 0.55 }, start - 0.05);
  cue(start, 'whoosh', 0.6);
  countUp(ctx, q(s, '.fo-views b'), { to: 128000, at: start + 0.25, dur: 1.3, format: fmt.thousands });
  tl.fromTo(q(s, '.fo-or'), { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.3, ease: 'back.out(2)' }, w('for', 2) - 0.05);
  tl.fromTo(client, { x: 200, opacity: 0, rotateY: -30 }, { x: 0, opacity: 1, rotateY: 0, duration: 0.55 }, w('for', 3) - 0.12);
  tl.fromTo(q(s, '.fo-paid'), { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35, ease: 'back.out(3)' }, w('for', 4));
  cue(w('for', 3) - 0.12, 'whoosh', 0.6);
  cue(w('for', 4), 'pop', 0.8);
  // particles gather into the Lumademy mark for the end card
  morph(ctx, end - 0.5, 'logo', { opacity: 0.9, jitter: 0.03 });
  tl.to([...s.children], { opacity: 0, scale: 0.9, duration: 0.28, ease: 'power3.in' }, end - 0.38);
  cue(end - 0.5, 'riser', 0.7);
}
