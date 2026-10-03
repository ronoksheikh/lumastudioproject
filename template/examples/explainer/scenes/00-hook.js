// 1. HOOK — "এই ভিডিওর সব অ্যানিমেশন বানানো এআই দিয়ে।"
//    Rapid cuts on every word → all four snap into a grid → the grid flies
//    into the preview window of the AI project that made them.
import { icons, qa, q } from '../lib/core.js';
import { punchWords } from '../lib/recipes/kinetic-type.js';
import { loadMap, mapMarkup, pinMarkup, mapCamera, mapPoints } from '../lib/recipes/map-zoom.js';
import { calloutsMarkup, animateCallouts } from '../lib/recipes/callouts.js';
import { ideWindow, animateIde } from '../lib/recipes/ui-mockups.js';
import { gridSnap, flyInto } from '../lib/recipes/transitions.js';

export default async function hook(ctx) {
  const { tl, w, S, P, cue, flash, shake, onFrame, show, add, wordsOut } = ctx;
  const map = await loadMap(ctx);
  const { city: dhaka } = mapPoints(map);

  const code = [
    ['c', '// explainer.js — generated with AI'],
    ['k', "tl.to(map, { zoom: 'Dhaka' }, word('জুম'));"],
    ['k', "tl.from(bars, { scaleY: 0, stagger: 0.07 });"],
    ['k', "tl.add(highlight(people[6], '1 / 10'));"],
    ['k', "tl.add(callouts(['Camera', 'Battery', 'Chip']));"],
    ['k', "voice.sync(tl, 'elevenlabs/timing.json');"],
    ['c', '// ✓ 1920×1080 · 60fps · rendered'],
  ];
  const s = add(`
    <div class="scene s-hook">
      ${ideWindow({ title: 'lumademy-explainer — explainer.js', lines: code, prompt: 'Explainer: map zoom to Dhaka, bar graph, 1-in-10, callouts', cls: 'ide' })}
      <div class="g4">
        <div class="shot sh-map">
          ${mapMarkup(map)}
          ${pinMarkup()}
          <div class="sh-tag mono">MAP ZOOM</div>
        </div>
        <div class="shot sh-bars">
          <div class="bars5">${[24, 38, 33, 62, 96].map((v) => `<i style="--h:${v}"></i>`).join('')}</div>
          <b class="big en">+320%</b>
          <div class="sh-tag mono">GRAPH</div>
        </div>
        <div class="shot sh-ten">
          <div class="row10">${Array.from({ length: 10 }, (_, i) => `<span class="${i === 6 ? 'one' : ''}">${icons.person}</span>`).join('')}</div>
          <b class="big en">1 / 10</b>
          <div class="sh-tag mono">HIGHLIGHT</div>
        </div>
        <div class="shot sh-call">
          ${calloutsMarkup()}
          <div class="sh-tag mono">CALLOUTS</div>
        </div>
      </div>
      <div class="hk-cap bn"><span class="h1">এই ভিডিওর সব অ্যানিমেশন</span><span class="h2">বানানো <b>এআই</b> দিয়ে</span></div>
      <div class="rv-chip mono">${icons.spark} 100% AI-GENERATED</div>
    </div>`);
  const end = S.ten.start;
  show(s, 0, end + 0.02);
  tl.set(P.uOpacity, { value: 0 }, 0);

  const shots = qa(s, '.shot');
  const [shMap, shBars, shTen, shCall] = shots;
  // four even, punchy cuts across "এই ভিডিওর সব অ্যানিমেশন" (the map gets the longest look)
  const cuts = [0, w('hook', 1) + 0.25, w('hook', 2) + 0.1, w('hook', 3) + 0.18];
  const tGrid = w('hook', 4);
  shots.forEach((sh, i) => {
    tl.set(sh, { autoAlpha: 1 }, cuts[i]);
    if (i < 3) tl.set(sh, { autoAlpha: 0 }, cuts[i + 1]);
    tl.fromTo(sh, { scale: 1.18 }, { scale: 1, duration: 0.35, ease: 'expo.out' }, cuts[i]);
    flash(cuts[i], i === 0 ? 0.6 : 0.3, 0.18);
    cue(cuts[i], i === 0 ? 'impact' : 'whoosh', i === 0 ? 1 : 0.7);
  });
  shake(0, 1.2, 0.4);

  // shot 1 — the map slams from the whole world into Dhaka
  const cam = mapCamera(ctx, q(shMap, '.rc-map'), map, { from: 0, to: end });
  tl.fromTo(cam.vb, { ...cam.world() }, { ...cam.view(80, dhaka[0], dhaka[1] + 2), duration: 0.42, ease: 'expo.inOut' }, 0);
  tl.fromTo(q(shMap, '.hl'), { fill: 'rgba(255,255,255,0.16)' }, { fill: '#5DAEFF', duration: 0.15 }, 0.2);
  tl.fromTo(q(shMap, '.rc-pin'), { y: -200, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: 'bounce.out' }, 0.32);
  // shot 2 — bars shoot up
  tl.fromTo(qa(shBars, '.bars5 i'), { scaleY: 0 }, { scaleY: 1, duration: 0.3, stagger: 0.035, ease: 'back.out(1.6)', transformOrigin: '50% 100%' }, cuts[1]);
  tl.fromTo(q(shBars, '.big'), { scale: 0.4, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3, ease: 'back.out(2)' }, cuts[1] + 0.12);
  // shot 3 — one in ten lights up
  tl.fromTo(q(shTen, '.one'), { color: 'rgba(255,255,255,0.85)' }, { color: '#5DAEFF', scale: 1.25, duration: 0.2 }, cuts[2] + 0.08);
  tl.fromTo(q(shTen, '.big'), { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.25 }, cuts[2] + 0.1);
  // shot 4 — callouts draw on
  animateCallouts(ctx, q(shCall, '.rc-callout'), { at: cuts[3] });

  // captions: every word punches in
  punchWords(ctx, q(s, '.h1'), 'hook', 0);
  wordsOut(q(s, '.h1'), tGrid - 0.12);

  // "বানানো" — zoom out: all four were one piece of work
  // grid tile centres, as offsets from the frame centre (shots scale about their centre)
  gridSnap(ctx, shots, { at: tGrid - 0.02, tiles: [[-473, -271], [473, -271], [-473, 270], [473, 270]] });
  shots.forEach((sh) => tl.fromTo(q(sh, '.sh-tag'), { opacity: 0 }, { opacity: 1, duration: 0.2 }, tGrid + 0.15));
  shake(tGrid, 0.8, 0.3);
  cue(tGrid, 'impact', 0.8);

  // "এআই দিয়ে" — the grid flies into the AI project's preview window
  const tAI = w('hook', 5) - 0.06;
  const g4 = q(s, '.g4');
  const ide = q(s, '.ide');
  flyInto(ctx, g4, { x: 950, y: 260, width: 780 }, { at: tAI - 0.12 });
  tl.fromTo(ide, { opacity: 0, scale: 1.12 }, { opacity: 1, scale: 1, duration: 0.5, ease: 'expo.out' }, tAI - 0.05);
  animateIde(ctx, ide, { at: tAI });
  cue(tAI - 0.1, 'whoosh', 0.9);
  punchWords(ctx, q(s, '.h2'), 'hook', 4);
  tl.fromTo(q(s, '.rv-chip'), { scale: 0.5, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35, ease: 'back.out(2)' }, w('hook', 5));
  flash(w('hook', 5), 0.35, 0.3);
  cue(w('hook', 5), 'shimmer', 1);
  tl.to([ide, g4, q(s, '.hk-cap'), q(s, '.rv-chip')], { opacity: 0, scale: '-=0.06', filter: 'blur(8px)', duration: 0.25, ease: 'power3.in' }, end - 0.25);
  tl.to(P.uOpacity, { value: 0.12, duration: 0.4 }, end - 0.1);
}
