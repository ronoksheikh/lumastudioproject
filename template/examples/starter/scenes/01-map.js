// Starter scene 2 — map-zoom recipe: world → region → city pin, with a caption landing on the words.
import { q, splitWords } from '../lib/core.js';
import { loadMap, mapMarkup, pinMarkup, mapCamera, mapPoints } from '../lib/recipes/map-zoom.js';
import { particlesTo } from '../lib/recipes/particles.js';

export default async function mapScene(ctx) {
  const { tl, w, cue, shake, show, add, wordIn } = ctx;
  const map = await loadMap(ctx);
  const { box, city } = mapPoints(map);
  const [start, end] = ctx.range('map');
  const s = add(`
    <div class="scene s-map">
      ${mapMarkup(map)}
      <div class="rc-city"><i></i></div>
      ${pinMarkup()}
      <div class="rc-card"><b class="en">Dhaka, Bangladesh</b><span class="mono">23.81°N · 90.41°E</span></div>
      <div class="m-cap en">Any country, any city. One smooth zoom.</div>
    </div>`);
  show(s, start, end);
  particlesTo(ctx, start, 0, 0.4);
  tl.fromTo(q(s, '.rc-map'), { opacity: 0, scale: 1.2 }, { opacity: 1, scale: 1, duration: 0.7, ease: 'power3.out' }, start - 0.05);
  cue(start, 'whoosh', 0.6);

  const cam = mapCamera(ctx, q(s, '.rc-map'), map, {
    from: start - 0.1,
    to: end,
    overlays: [{ nodes: [q(s, '.rc-city'), q(s, '.rc-pin'), q(s, '.rc-card')], at: city }],
  });
  const tZoom = w('map', 4); // "One smooth zoom"
  tl.fromTo(cam.vb, { ...cam.world() }, { ...cam.view(map.width * 0.8, box[0] + box[2] / 2 + 150, box[1] + box[3] / 2), duration: tZoom - start, ease: 'none' }, start);
  tl.to(cam.vb, { ...cam.view(70, city[0], city[1] + 3), duration: 0.9, ease: 'power3.inOut' }, tZoom);
  cue(tZoom, 'whoosh', 1);

  // country lights up on "country", the city dot on "city"
  tl.fromTo(q(s, '.hl'), { fill: 'rgba(255,255,255,0.16)' }, { fill: '#5DAEFF', duration: 0.3 }, w('map', 1));
  tl.fromTo(q(s, '.rc-city'), { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35, ease: 'back.out(3)' }, w('map', 3));
  cue(w('map', 3), 'tick', 0.9);
  splitWords(q(s, '.m-cap')).forEach((wd, i) => wordIn(wd, w('map', i)));

  const tPin = tZoom + 0.6;
  tl.fromTo(q(s, '.rc-pin'), { y: -380, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: 'bounce.out' }, tPin);
  tl.fromTo(q(s, '.rc-card'), { x: 20, opacity: 0 }, { x: 0, opacity: 1, duration: 0.4 }, tPin + 0.3);
  shake(tPin + 0.35, 0.6);
  cue(tPin + 0.35, 'impact', 0.7);
  tl.to([...s.children], { opacity: 0, duration: 0.25, ease: 'power2.in' }, end - 0.25);
}
