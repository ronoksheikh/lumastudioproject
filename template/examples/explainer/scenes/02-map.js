// 3. MAP — "কোন দেশ, কোন শহর? ম্যাপে সোজা জুম।"
import { icons, q, splitWords } from '../lib/core.js';
import { morph, particlesTo } from '../lib/recipes/particles.js';
import { loadMap, mapMarkup, pinMarkup, mapCamera, mapPoints } from '../lib/recipes/map-zoom.js';

export default async function mapScene(ctx) {
  const { tl, w, S, cue, shake, show, add, onFrame, wordIn, wordsOut } = ctx;
  const map = await loadMap(ctx);
  const { width: MW, height: MH } = map;
  const { box: bdBox, city: dhaka } = mapPoints(map);
  const s = add(`
    <div class="scene s-map">
      ${mapMarkup(map)}
      <div class="rc-ripple"></div>
      <div class="rc-tag mono"><b class="bn">বাংলাদেশ</b>BANGLADESH</div>
      <div class="rc-city"><i></i></div>
      ${pinMarkup()}
      <div class="rc-card"><b class="bn">ঢাকা, বাংলাদেশ</b><span class="mono">23.81°N · 90.41°E</span></div>
      <div class="mp-cap bn"><span class="m1">কোন দেশ, কোন শহর?</span><span class="m2">ম্যাপে সোজা জুম</span></div>
    </div>`);
  const start = S.map.start;
  const end = S.graph.start + 0.3; // hold the pin a beat under the next line
  show(s, start, end);
  const svg = q(s, '.rc-map');
  tl.fromTo(svg, { opacity: 0, scale: 1.25 }, { opacity: 1, scale: 1, duration: 0.7, ease: 'power3.out' }, start - 0.05);
  particlesTo(ctx, start, 0, 0.45);
  morph(ctx, start + 0.5, 'scatter', { ease: 'expo.out' });
  cue(start, 'whoosh', 0.6);

  // camera on the map is a tweened viewBox
  const cx = bdBox[0] + bdBox[2] / 2;
  const cy = bdBox[1] + bdBox[3] / 2;
  const ripple = q(s, '.rc-ripple');
  const tag = q(s, '.rc-tag');
  const city = q(s, '.rc-city');
  const pin = q(s, '.rc-pin');
  const card = q(s, '.rc-card');
  const cam = mapCamera(ctx, svg, map, {
    from: start - 0.1,
    to: end,
    overlays: [{ nodes: [ripple, tag], at: [cx, cy] }, { nodes: [city, pin, card], at: dhaka }],
  });
  const { vb, view } = cam;
  const tZ = w('map', 5) - 0.12;
  tl.fromTo(vb, { ...cam.world() }, { ...view(MW * 0.8, MW / 2 + 180, MH / 2 + 20), duration: tZ - start, ease: 'none' }, start);

  splitWords(q(s, '.m1')).forEach((wd, i) => wordIn(wd, w('map', i)));
  // "দেশ" — Bangladesh lights up
  const tC = w('map', 1);
  tl.fromTo(q(s, '.hl'), { fill: 'rgba(255,255,255,0.16)' }, { fill: '#5DAEFF', duration: 0.3, ease: 'power2.out' }, tC);
  tl.fromTo(ripple, { scale: 0, opacity: 1 }, { scale: 1, opacity: 0, duration: 0.8, ease: 'power2.out' }, tC);
  tl.fromTo(tag, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.35 }, tC + 0.1);
  cue(tC, 'pop', 0.8);
  // "শহর" — the city dot
  const tCity = w('map', 3);
  tl.fromTo(city, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35, ease: 'back.out(3)' }, tCity);
  cue(tCity, 'tick', 0.9);

  // "ম্যাপে সোজা জুম" — swoop straight in to Dhaka
  wordsOut(q(s, '.m1'), w('map', 4) - 0.28);
  splitWords(q(s, '.m2')).forEach((wd, i) => wordIn(wd, w('map', 4 + i)));
  tl.to(vb, { ...view(70, dhaka[0], dhaka[1] + 3), duration: 0.8, ease: 'power3.inOut' }, tZ);
  tl.to(tag, { opacity: 0, duration: 0.2 }, tZ + 0.05);
  tl.to(city, { scale: 2.2, opacity: 0, duration: 0.3 }, tZ + 0.45);
  tl.fromTo(svg, { filter: 'blur(0px)' }, { keyframes: [{ filter: 'blur(3px)', duration: 0.35 }, { filter: 'blur(0px)', duration: 0.4 }] }, tZ + 0.05);
  cue(tZ, 'whoosh', 1);
  const tPin = tZ + 0.55;
  tl.fromTo(pin, { y: -380, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, ease: 'bounce.out' }, tPin);
  tl.fromTo(card, { x: 20, opacity: 0 }, { x: 0, opacity: 1, duration: 0.4 }, tPin + 0.3);
  shake(tPin + 0.35, 0.6);
  cue(tPin + 0.35, 'impact', 0.7);
  tl.to([...s.children], { opacity: 0, duration: 0.25, ease: 'power2.in' }, end - 0.25);
  tl.to(vb, { ...view(30, dhaka[0], dhaka[1] + 1), duration: 0.5, ease: 'power2.in' }, end - 0.5);
}
