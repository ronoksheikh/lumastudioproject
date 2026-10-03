// 5. YOUTUBE — "বড় বড় ইউটিউব চ্যানেল ঠিক এভাবেই ভিউ ধরে রাখে।"
import { q, qa, splitWords } from '../lib/core.js';
import { icons } from '../lib/core.js';
import { videoPlayer, channelRow } from '../lib/recipes/ui-mockups.js';
import { progressBar } from '../lib/recipes/counter.js';
import { particlesTo } from '../lib/recipes/particles.js';

export default function youtube(ctx) {
  const { tl, w, S, BG, cue, show, add, reveal, wordIn, wordsOut } = ctx;
  const screen = `
    <div class="rc-mtg m-timeline">
      <i class="axis"></i>
      ${[1950, 1969, 1991, 2007, 2025].map((y, i) => `<div class="ev" style="left:${10 + i * 20}%"><i></i><b class="mono">${y}</b></div>`).join('')}
    </div>
    <div class="rc-mtg m-compare">
      <div class="cmp"><span class="en">A</span><i><b style="--v:72%"></b></i><em class="mono">72%</em></div>
      <div class="cmp b"><span class="en">B</span><i><b style="--v:28%"></b></i><em class="mono">28%</em></div>
    </div>
    <div class="rc-mtg m-retain">
      <div class="rt-head mono">AUDIENCE RETENTION</div>
      <svg viewBox="0 0 1000 400" preserveAspectRatio="none"><path class="flat" d="M0 60 C 200 140 300 300 1000 360"/><path class="up" d="M0 60 C 250 80 500 90 1000 110"/></svg>
      <span class="rt-a en">with motion graphics</span><span class="rt-b en">without</span>
    </div>`;
  const s = add(`
    <div class="scene s-yt">
      <div class="yt-cap bn">বড় বড় ইউটিউব চ্যানেল ঠিক এভাবেই</div>
      ${videoPlayer({ screen })}
      ${channelRow({ name: 'Explainer Channel', stats: '2.4M subscribers · 1.8M views' })}
      <div class="yt-cap2 bn">ভিউ <b>ধরে রাখে</b></div>
    </div>`);
  const start = S.youtube.start;
  const end = S.paths.start;
  show(s, start, end);
  tl.set(BG.uNight, { value: 1 }, start);
  particlesTo(ctx, start, 0.14);

  reveal(splitWords(q(s, '.yt-cap')), 'youtube');
  const player = q(s, '.rc-player');
  tl.fromTo(player, { y: 140, opacity: 0, rotateX: 22, scale: 0.9 }, { y: 0, opacity: 1, rotateX: 0, scale: 1, duration: 0.6 }, start - 0.05);
  tl.fromTo(q(s, '.rc-channel'), { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45 }, w('youtube', 3));
  cue(start - 0.05, 'whoosh', 0.7);
  progressBar(ctx, q(s, '.rc-ctrl .prog i'), { at: start, dur: end - start, from: 0.1, to: 0.7 });

  // montage inside the player, cut on the words
  const [mT, mC, mR] = qa(s, '.rc-mtg');
  const cuts = [start + 0.05, w('youtube', 4) - 0.05, w('youtube', 6) - 0.08];
  [mT, mC, mR].forEach((m, i) => {
    tl.set(m, { autoAlpha: 1 }, cuts[i]);
    if (i < 2) tl.set(m, { autoAlpha: 0 }, cuts[i + 1]);
    cue(cuts[i], 'tick', 0.8);
  });
  tl.fromTo(q(mT, '.axis'), { scaleX: 0 }, { scaleX: 1, duration: 0.5, ease: 'power2.out', transformOrigin: 'left center' }, cuts[0]);
  tl.fromTo(qa(mT, '.ev'), { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, stagger: 0.14 }, cuts[0] + 0.05);
  tl.fromTo(mT, { x: 80 }, { x: -80, duration: cuts[1] - cuts[0], ease: 'none' }, cuts[0]);
  tl.fromTo(qa(mC, '.cmp b'), { scaleX: 0 }, { scaleX: 1, duration: 0.5, stagger: 0.1, ease: 'expo.out', transformOrigin: 'left center' }, cuts[1] + 0.05);
  tl.fromTo(qa(mC, '.cmp em'), { opacity: 0 }, { opacity: 1, duration: 0.25, stagger: 0.1 }, cuts[1] + 0.3);
  // "ভিউ ধরে রাখে" — retention curve: with motion graphics stays high
  tl.fromTo(q(mR, '.flat'), { drawSVG: '0%' }, { drawSVG: '100%', duration: 0.6, ease: 'power2.inOut' }, cuts[2]);
  tl.fromTo(q(mR, '.up'), { drawSVG: '0%' }, { drawSVG: '100%', duration: 0.6, ease: 'power2.inOut' }, cuts[2] + 0.15);
  tl.fromTo(qa(mR, '.rt-a, .rt-b'), { opacity: 0 }, { opacity: 1, duration: 0.25, stagger: 0.15 }, cuts[2] + 0.45);
  wordsOut(q(s, '.yt-cap'), w('youtube', 6) - 0.25);
  splitWords(q(s, '.yt-cap2')).forEach((wd, i) => wordIn(wd, w('youtube', 6 + i)));
  tl.fromTo(q(s, '.rc-ch-sub'), { backgroundColor: '#ffffff', color: '#10234B' }, { backgroundColor: 'rgba(255,255,255,0.14)', color: '#ffffff', duration: 0.2 }, w('youtube', 8));
  cue(w('youtube', 8), 'click', 0.7);
  tl.to([player, q(s, '.rc-channel'), q(s, '.yt-cap2')], { opacity: 0, scale: 0.94, duration: 0.25, ease: 'power3.in' }, end - 0.25);
}
