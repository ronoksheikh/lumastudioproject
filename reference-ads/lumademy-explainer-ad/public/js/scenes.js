// Builds every scene's DOM and one master GSAP timeline, synced to the
// ElevenLabs word timestamps in audio/timing.json.

const ICON = 'assets/Lumademy_Icon_White.svg';
const LOCKUP = 'assets/Lumademy_All_White.svg';
const BN = '০১২৩৪৫৬৭৮৯';
const bnNum = (n) => String(n).replace(/\d/g, (d) => BN[d]);

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
function splitWords(node) {
  const words = node.textContent.trim().split(/\s+/);
  node.innerHTML = words.map((w) => `<span class="w"><span class="wi">${w}</span></span>`).join(' ');
  return [...node.querySelectorAll('.wi')];
}
const rand = (i, k = 1) => {
  const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const I = {
  arrow: '<svg viewBox="0 0 24 24" class="ico"><path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  play: '<svg viewBox="0 0 24 24" class="ico"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" class="ico"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg>',
  spark: '<svg viewBox="0 0 24 24" class="ico"><path d="M12 1.5c.6 4.9 2.6 8.2 10.5 10.5C14.6 14.3 12.6 17.6 12 22.5 11.4 17.6 9.4 14.3 1.5 12 9.4 9.7 11.4 6.4 12 1.5Z" fill="currentColor"/></svg>',
  person: '<svg viewBox="0 0 48 48" class="ico"><circle cx="24" cy="14" r="8" fill="currentColor"/><path d="M9 44c1.5-11 7.5-16 15-16s13.5 5 15 16z" fill="currentColor"/></svg>',
  clock: '<svg viewBox="0 0 48 48" class="ico"><circle cx="24" cy="24" r="19" fill="none" stroke="currentColor" stroke-width="3.4"/><path class="hand" d="M24 24V12" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/><path class="hand2" d="M24 24h8" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/></svg>',
  star: '<svg viewBox="0 0 24 24" class="ico"><path d="M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z" fill="currentColor"/></svg>',
  pin: '<svg viewBox="0 0 48 64" class="pin-svg"><path d="M24 2C12.4 2 3 11.2 3 22.6 3 38 24 62 24 62s21-24 21-39.4C45 11.2 35.6 2 24 2Z" fill="#fff"/><circle cx="24" cy="23" r="8.5" fill="#2970EC"/></svg>',
  camera: '<svg viewBox="0 0 48 48" class="ico"><rect x="4" y="12" width="28" height="24" rx="6" fill="none" stroke="currentColor" stroke-width="3.4"/><path d="M32 21l12-7v20l-12-7z" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linejoin="round"/></svg>',
  brief: '<svg viewBox="0 0 48 48" class="ico"><rect x="5" y="14" width="38" height="27" rx="5" fill="none" stroke="currentColor" stroke-width="3.4"/><path d="M17 14v-3a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v3M5 25h38" fill="none" stroke="currentColor" stroke-width="3.4"/></svg>',
  check: '<svg viewBox="0 0 24 24" class="ico"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  lens: '<svg viewBox="0 0 48 48" class="ico"><circle cx="21" cy="21" r="13" fill="none" stroke="currentColor" stroke-width="3.6"/><path d="M31 31l11 11M21 15v12M15 21h12" stroke="currentColor" stroke-width="3.6" stroke-linecap="round"/></svg>',
};

export async function buildTimeline({ timing, world, scenesRoot, fxRoot }) {
  const S = Object.fromEntries(timing.segments.map((s) => [s.id, s]));
  const w = (id, i) => S[id].words[i].start;
  const END = timing.duration + 2.4;
  const map = await (await fetch('assets/world-map.json')).json();

  const tl = gsap.timeline({ paused: true, defaults: { ease: 'expo.out', duration: 0.6 } });
  const cues = [];
  const frameHooks = [];
  const cue = (t, type, gain = 1) => cues.push({ t, type, gain });
  const onFrame = (fn) => frameHooks.push(fn);

  const st = world.state;
  const P = world.particles;
  const BG = world.bg;

  const flashEl = fxRoot.querySelector('.flash');
  const flash = (t, peak = 0.85, dur = 0.45) =>
    tl.fromTo(flashEl, { opacity: peak }, { opacity: 0, duration: dur, ease: 'power2.out', immediateRender: false }, t);
  const shake = (t, amt = 1, dur = 0.45) =>
    tl.fromTo(st, { shake: amt }, { shake: 0, duration: dur, ease: 'power2.out', immediateRender: false }, t);
  const show = (node, from, to) => {
    tl.set(node, { autoAlpha: 1 }, from);
    if (to != null) tl.set(node, { autoAlpha: 0 }, to);
  };
  const add = (html) => scenesRoot.appendChild(el(html));
  const q = (n, s) => n.querySelector(s);
  const qa = (n, s) => [...n.querySelectorAll(s)];
  // masked word reveal; opacity keeps Bengali matras from peeking out early
  const wordIn = (wd, t, d = 0.42) => tl.fromTo(wd, { yPercent: 130, opacity: 0 }, { yPercent: 0, opacity: 1, duration: d }, t - 0.03);
  const reveal = (words, id, offset = 0) => words.forEach((wd, i) => wordIn(wd, w(id, offset + i)));
  const wordsOut = (node, t) => tl.to(node, { y: -40, opacity: 0, filter: 'blur(8px)', duration: 0.28, ease: 'power2.in' }, t);

  // ---------- initial world state ----------
  tl.set(BG.uNight, { value: 1 }, 0);
  tl.set([P.wSphere, P.wLogo, P.wRing], { value: 0 }, 0);
  tl.set(P.wScatter, { value: 1 }, 0);
  tl.set(P.uJitter, { value: 0.35 }, 0);
  tl.fromTo(P.uOpacity, { value: 0 }, { value: 0.14, duration: 1 }, 0);

  // ===========================================================================
  // 1. HOOK — "এই ভিডিওর সব অ্যানিমেশন বানানো এআই দিয়ে।"
  //    Rapid cuts on every word → all four snap into a grid → the grid flies
  //    into the preview window of the AI project that made them.
  // ===========================================================================
  {
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
        <div class="ide">
          <div class="ide-bar"><i></i><i></i><i></i><span class="mono">lumademy-explainer — explainer.js</span></div>
          <div class="ide-body">
            <div class="code mono">${code.map(([k, l], i) => `<div class="ln ${k}"><em>${i + 1}</em><span>${l.replace(/</g, '&lt;')}</span></div>`).join('')}</div>
            <div class="preview">
              <div class="pv-screen"><span class="pv-badge mono">PREVIEW</span></div>
              <div class="prompt"><span class="sp">${I.spark}</span><span class="en">Explainer: map zoom to Dhaka, bar graph, 1-in-10, callouts</span></div>
            </div>
          </div>
        </div>
        <div class="g4">
          <div class="shot sh-map">
            <svg class="mp" viewBox="0 0 ${map.width} ${map.height}" preserveAspectRatio="xMidYMid slice"><path class="rest" d="${map.rest}"/><path class="nb" d="${map.neighbours}"/><path class="bd" d="${map.bd}"/></svg>
            <div class="mp-pin">${I.pin}</div>
            <div class="sh-tag mono">MAP ZOOM</div>
          </div>
          <div class="shot sh-bars">
            <div class="bars5">${[24, 38, 33, 62, 96].map((v) => `<i style="--h:${v}"></i>`).join('')}</div>
            <b class="big en">+320%</b>
            <div class="sh-tag mono">GRAPH</div>
          </div>
          <div class="shot sh-ten">
            <div class="row10">${Array.from({ length: 10 }, (_, i) => `<span class="${i === 6 ? 'one' : ''}">${I.person}</span>`).join('')}</div>
            <b class="big en">1 / 10</b>
            <div class="sh-tag mono">HIGHLIGHT</div>
          </div>
          <div class="shot sh-call">
            <div class="m-callout">
              <div class="device"><i></i></div>
              <svg viewBox="0 0 1000 560"><path d="M520 200 L700 110 L820 110"/><path d="M440 360 L280 450 L160 450"/><path d="M560 380 L720 470 L840 470"/></svg>
              <span class="cl l1 en">Camera</span><span class="cl l2 en">Battery</span><span class="cl l3 en">Chip</span>
            </div>
            <div class="sh-tag mono">CALLOUTS</div>
          </div>
        </div>
        <div class="hk-cap bn"><span class="h1">এই ভিডিওর সব অ্যানিমেশন</span><span class="h2">বানানো <b>এআই</b> দিয়ে</span></div>
        <div class="rv-chip mono">${I.spark} 100% AI-GENERATED</div>
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
    const mapSvg = q(shMap, '.mp');
    const { dhaka } = map;
    const vb = { x: 0, y: 120, w: map.width, h: (map.width * 9) / 16 };
    const dk = (wv) => ({ x: dhaka[0] - wv / 2, y: dhaka[1] + 2 - (wv * 9) / 32, w: wv, h: (wv * 9) / 16 });
    tl.fromTo(vb, { x: 0, y: 120, w: map.width, h: (map.width * 9) / 16 }, { ...dk(80), duration: 0.42, ease: 'expo.inOut' }, 0);
    tl.fromTo(q(shMap, '.bd'), { fill: 'rgba(255,255,255,0.16)' }, { fill: '#5DAEFF', duration: 0.15 }, 0.2);
    const pin = q(shMap, '.mp-pin');
    tl.fromTo(pin, { y: -200, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: 'bounce.out' }, 0.32);
    onFrame((t) => {
      if (t > end) return;
      mapSvg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    });
    // shot 2 — bars shoot up
    tl.fromTo(qa(shBars, '.bars5 i'), { scaleY: 0 }, { scaleY: 1, duration: 0.3, stagger: 0.035, ease: 'back.out(1.6)', transformOrigin: '50% 100%' }, cuts[1]);
    tl.fromTo(q(shBars, '.big'), { scale: 0.4, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3, ease: 'back.out(2)' }, cuts[1] + 0.12);
    // shot 3 — one in ten lights up
    const one = q(shTen, '.one');
    tl.fromTo(one, { color: 'rgba(255,255,255,0.85)' }, { color: '#5DAEFF', scale: 1.25, duration: 0.2 }, cuts[2] + 0.08);
    tl.fromTo(q(shTen, '.big'), { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.25 }, cuts[2] + 0.1);
    // shot 4 — callouts draw on
    tl.fromTo(q(shCall, '.device'), { scale: 0.7, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3 }, cuts[3]);
    tl.fromTo(qa(shCall, 'svg path'), { drawSVG: '0%' }, { drawSVG: '100%', duration: 0.2, stagger: 0.08 }, cuts[3] + 0.1);
    tl.fromTo(qa(shCall, '.cl'), { opacity: 0 }, { opacity: 1, duration: 0.15, stagger: 0.08 }, cuts[3] + 0.2);

    // captions: every word punches in
    const h1 = splitWords(q(s, '.h1'));
    h1.forEach((wd, i) => tl.fromTo(wd, { yPercent: 120, opacity: 0, scale: 1.3 }, { yPercent: 0, opacity: 1, scale: 1, duration: 0.25 }, w('hook', i) - 0.02));
    wordsOut(q(s, '.h1'), tGrid - 0.12);

    // "বানানো" — zoom out: all four were one piece of work
    // grid tile centres, as offsets from the frame centre (shots scale about their centre)
    const tiles = [[-473, -271], [473, -271], [-473, 270], [473, 270]];
    shots.forEach((sh, i) => {
      tl.set(sh, { autoAlpha: 1 }, tGrid - 0.02);
      tl.to(sh, { x: tiles[i][0], y: tiles[i][1], scale: 0.48, borderRadius: 40, duration: 0.42, ease: 'expo.out' }, tGrid - 0.02);
      tl.fromTo(q(sh, '.sh-tag'), { opacity: 0 }, { opacity: 1, duration: 0.2 }, tGrid + 0.15);
    });
    shake(tGrid, 0.8, 0.3);
    cue(tGrid, 'impact', 0.8);

    // "এআই দিয়ে" — the grid flies into the AI project's preview window
    const tAI = w('hook', 5) - 0.06;
    const g4 = q(s, '.g4');
    const ide = q(s, '.ide');
    tl.to(g4, { x: 950, y: 260, scale: 780 / 1920, duration: 0.5, ease: 'expo.inOut' }, tAI - 0.12);
    tl.fromTo(ide, { opacity: 0, scale: 1.12 }, { opacity: 1, scale: 1, duration: 0.5, ease: 'expo.out' }, tAI - 0.05);
    const lines = qa(s, '.ln');
    tl.fromTo(lines, { opacity: 0, x: -16 }, { opacity: 1, x: 0, duration: 0.15, stagger: 0.07 }, tAI + 0.1);
    tl.fromTo(q(s, '.prompt'), { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.25 }, tAI + 0.25);
    cue(tAI - 0.1, 'whoosh', 0.9);
    for (let i = 0; i < lines.length; i += 2) cue(tAI + 0.1 + i * 0.07, 'tick', 0.4);
    const h2 = splitWords(q(s, '.h2'));
    h2.forEach((wd, i) => tl.fromTo(wd, { yPercent: 120, opacity: 0, scale: 1.3 }, { yPercent: 0, opacity: 1, scale: 1, duration: 0.25 }, w('hook', 4 + i) - 0.02));
    tl.fromTo(q(s, '.rv-chip'), { scale: 0.5, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35, ease: 'back.out(2)' }, w('hook', 5));
    flash(w('hook', 5), 0.35, 0.3);
    cue(w('hook', 5), 'shimmer', 1);
    tl.to([ide, g4, q(s, '.hk-cap'), q(s, '.rv-chip')], { opacity: 0, scale: '-=0.06', filter: 'blur(8px)', duration: 0.25, ease: 'power3.in' }, end - 0.25);
    tl.to(P.uOpacity, { value: 0.12, duration: 0.4 }, end - 0.1);
  }

  // ===========================================================================
  // 2. TEN — "দশজনের মধ্যে একজন? চোখের সামনে।"
  // ===========================================================================
  {
    const s = add(`
      <div class="scene s-ten">
        <div class="tn-row">${Array.from({ length: 10 }, (_, i) => `<div class="pp ${i === 6 ? 'one' : ''}">${I.person}</div>`).join('')}</div>
        <svg class="tn-call" viewBox="0 0 1920 1080"><path d="M1086 600 C 1120 760 1240 800 1330 800"/></svg>
        <div class="tn-label"><b class="bn">১০ জনের মধ্যে ১ জন</b><span class="mono">1 IN 10 · 10%</span></div>
        <div class="tn-cap2 bn">চোখের সামনে।</div>
      </div>`);
    const start = S.ten.start;
    const end = S.map.start;
    show(s, start, end);
    tl.to(P.uOpacity, { value: 0.12, duration: 0.4 }, start);

    const pps = qa(s, '.pp');
    tl.fromTo(pps, { y: 80, opacity: 0, scale: 0.6 }, { y: 0, opacity: 1, scale: 1, duration: 0.4, stagger: 0.03, ease: 'back.out(2)' }, start - 0.12);
    for (let i = 0; i < 10; i++) cue(start - 0.12 + i * 0.03, 'tick', 0.45);

    // zoom into the one
    const one = pps[6];
    const row = q(s, '.tn-row');
    const tOne = w('ten', 2);
    tl.to(pps.filter((p) => p !== one), { opacity: 0.18, duration: 0.35 }, tOne - 0.1);
    tl.to(row, { scale: 2.3, x: -360, y: -40, duration: 0.7, ease: 'power3.inOut' }, tOne - 0.2);
    tl.to(one, { '--lit': 1, duration: 0.3 }, tOne);
    tl.fromTo(one, { scale: 1 }, { keyframes: [{ scale: 1.25, duration: 0.15 }, { scale: 1.1, duration: 0.4, ease: 'back.out(3)' }] }, tOne);
    flash(tOne, 0.25, 0.3);
    shake(tOne, 0.6);
    cue(tOne, 'impact', 0.8);
    cue(tOne + 0.05, 'shimmer', 0.6);

    // "চোখের সামনে।" — callout
    const tCall = w('ten', 3) - 0.15;
    tl.fromTo(q(s, '.tn-call path'), { drawSVG: '0%' }, { drawSVG: '100%', duration: 0.4, ease: 'power2.inOut' }, tCall);
    const lab = q(s, '.tn-label');
    tl.fromTo(lab, { x: -30, opacity: 0 }, { x: 0, opacity: 1, duration: 0.45 }, tCall + 0.25);
    const cap2 = splitWords(q(s, '.tn-cap2'));
    cap2.forEach((wd, i) => wordIn(wd, w('ten', 3 + i)));
    cue(tCall + 0.25, 'pop', 0.7);

    // the world arrives: particles gather into a spinning globe
    tl.to([row, lab, q(s, '.tn-call'), q(s, '.tn-cap2')], { opacity: 0, scale: 0.9, duration: 0.3, ease: 'power3.in' }, end - 0.45);
    tl.to(P.wScatter, { value: 0, duration: 0.5, ease: 'power3.inOut' }, end - 0.5);
    tl.to(P.wSphere, { value: 1, duration: 0.5, ease: 'power3.inOut' }, end - 0.5);
    tl.to(P.uOpacity, { value: 0.9, duration: 0.35 }, end - 0.5);
    tl.set(P.uJitter, { value: 0.02 }, end - 0.5);
    tl.fromTo(P.uSpin, { value: 0 }, { value: 3, duration: 1.2, ease: 'power2.out' }, end - 0.5);
    cue(end - 0.5, 'riser', 0.5);
  }

  // ===========================================================================
  // 3. MAP — "কোন দেশ, কোন শহর? ম্যাপে সোজা জুম।"
  // ===========================================================================
  {
    const { width: MW, height: MH, dhaka, bdBox } = map;
    const s = add(`
      <div class="scene s-map">
        <svg class="mp" viewBox="0 0 ${MW} ${MH}" preserveAspectRatio="xMidYMid slice">
          <path class="rest" d="${map.rest}"/>
          <path class="nb" d="${map.neighbours}"/>
          <path class="bd" d="${map.bd}"/>
        </svg>
        <div class="mp-ripple"></div>
        <div class="mp-tag mono"><b class="bn">বাংলাদেশ</b>BANGLADESH</div>
        <div class="mp-city"><i></i></div>
        <div class="mp-pin">${I.pin}</div>
        <div class="mp-card"><b class="bn">ঢাকা, বাংলাদেশ</b><span class="mono">23.81°N · 90.41°E</span></div>
        <div class="mp-cap bn"><span class="m1">কোন দেশ, কোন শহর?</span><span class="m2">ম্যাপে সোজা জুম</span></div>
      </div>`);
    const start = S.map.start;
    const end = S.graph.start + 0.3; // hold the pin a beat under the next line
    show(s, start, end);
    const svg = q(s, '.mp');
    tl.fromTo(svg, { opacity: 0, scale: 1.25 }, { opacity: 1, scale: 1, duration: 0.7, ease: 'power3.out' }, start - 0.05);
    tl.to(P.uOpacity, { value: 0, duration: 0.45 }, start);
    tl.to(P.wSphere, { value: 0, duration: 0.5 }, start + 0.5);
    tl.to(P.wScatter, { value: 1, duration: 0.5 }, start + 0.5);
    cue(start, 'whoosh', 0.6);

    // camera on the map is a tweened viewBox
    const vb = { x: 0, y: 0, w: MW, h: MH };
    const cx = bdBox[0] + bdBox[2] / 2;
    const cy = bdBox[1] + bdBox[3] / 2;
    const view = (wv, x = cx, y = cy) => ({ x: x - wv / 2, y: y - (wv * 9) / 16 / 2, w: wv, h: (wv * 9) / 16 });
    const world0 = { x: 0, y: 120, w: MW, h: (MW * 9) / 16 };
    const tZ = w('map', 5) - 0.12;
    tl.fromTo(vb, { ...world0 }, { ...view(MW * 0.8, MW / 2 + 180, MH / 2 + 20), duration: tZ - start, ease: 'none' }, start);
    const toPx = (px, py) => {
      const k = Math.max(1920 / vb.w, 1080 / vb.h);
      return [(px - vb.x) * k + (1920 - vb.w * k) / 2, (py - vb.y) * k + (1080 - vb.h * k) / 2];
    };
    const ripple = q(s, '.mp-ripple');
    const tag = q(s, '.mp-tag');
    const city = q(s, '.mp-city');
    const pin = q(s, '.mp-pin');
    const card = q(s, '.mp-card');
    onFrame((t) => {
      if (t < start - 0.1 || t > end) return;
      svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
      const [bx, by] = toPx(cx, cy);
      const [dx, dy] = toPx(dhaka[0], dhaka[1]);
      for (const n of [ripple, tag]) Object.assign(n.style, { left: bx + 'px', top: by + 'px' });
      for (const n of [city, pin, card]) Object.assign(n.style, { left: dx + 'px', top: dy + 'px' });
    });

    const m1 = splitWords(q(s, '.m1'));
    m1.forEach((wd, i) => wordIn(wd, w('map', i)));
    // "দেশ" — Bangladesh lights up
    const tC = w('map', 1);
    tl.fromTo(q(s, '.bd'), { fill: 'rgba(255,255,255,0.16)' }, { fill: '#5DAEFF', duration: 0.3, ease: 'power2.out' }, tC);
    tl.fromTo(ripple, { scale: 0, opacity: 1 }, { scale: 1, opacity: 0, duration: 0.8, ease: 'power2.out' }, tC);
    tl.fromTo(tag, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.35 }, tC + 0.1);
    cue(tC, 'pop', 0.8);
    // "শহর" — the city dot
    const tCity = w('map', 3);
    tl.fromTo(city, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35, ease: 'back.out(3)' }, tCity);
    cue(tCity, 'tick', 0.9);

    // "ম্যাপে সোজা জুম" — swoop straight in to Dhaka
    wordsOut(q(s, '.m1'), w('map', 4) - 0.28);
    const m2 = splitWords(q(s, '.m2'));
    m2.forEach((wd, i) => wordIn(wd, w('map', 4 + i)));
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

  // ===========================================================================
  // 4. GRAPH — "কত বাড়ল? এক গ্রাফেই পরিষ্কার।"
  // ===========================================================================
  {
    const vals = [22, 31, 28, 46, 63, 92];
    const months = ['জানু', 'ফেব্রু', 'মার্চ', 'এপ্রিল', 'মে', 'জুন'];
    const s = add(`
      <div class="scene s-graph">
        <div class="gr-num"><b class="en n">0</b><span class="bn">ভিউ</span></div>
        <div class="gr-card">
          <div class="gr-head"><span class="bn">মাসিক ভিউ</span><span class="chip en">+320%</span></div>
          <div class="gr-plot">
            <div class="grid">${'<i></i>'.repeat(4)}</div>
            ${vals.map((v, i) => `<div class="bar" style="--h:${v}"><b class="mono">${v / 10}M</b><i></i><span class="bn">${months[i]}</span></div>`).join('')}
            <svg class="trend" viewBox="0 0 600 300" preserveAspectRatio="none"><path d="M50 239 L150 214 L250 222 L350 172 L450 125 L550 44"/></svg>
          </div>
        </div>
        <div class="gr-cap bn">এক গ্রাফেই পরিষ্কার</div>
      </div>`);
    const start = S.graph.start;
    const end = S.youtube.start;
    show(s, start, end);
    tl.set(BG.uNight, { value: 0 }, start);
    tl.to(P.uOpacity, { value: 0.18, duration: 0.4 }, start);
    flash(start + 0.05, 0.45, 0.3);
    cue(start, 'whoosh', 0.6);

    // "কত বাড়ল?" — the number counts up
    const num = q(s, '.gr-num');
    const n = q(num, '.n');
    const cnt = { v: 0 };
    tl.fromTo(num, { scale: 1.4, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35 }, start + 0.05);
    tl.fromTo(cnt, { v: 0 }, { v: 4.2, duration: 0.8, ease: 'power3.out', onUpdate: () => (n.textContent = cnt.v.toFixed(1) + 'M') }, start + 0.05);
    cue(start + 0.1, 'tick', 0.8);

    // "এক গ্রাফেই" — bars
    const card = q(s, '.gr-card');
    const tG = w('graph', 2);
    tl.to(num, { y: -330, scale: 0.55, duration: 0.45, ease: 'power3.inOut' }, tG - 0.35);
    tl.fromTo(card, { y: 160, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5 }, tG - 0.3);
    tl.fromTo(qa(s, '.bar i'), { scaleY: 0 }, { scaleY: 1, duration: 0.5, stagger: 0.06, ease: 'back.out(1.4)', transformOrigin: '50% 100%' }, tG - 0.05);
    tl.fromTo(qa(s, '.bar b'), { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.3, stagger: 0.06 }, tG + 0.2);
    for (let i = 0; i < 6; i++) cue(tG - 0.05 + i * 0.06, 'pop', 0.35);
    const tT = w('graph', 3) + 0.1;
    tl.fromTo(q(s, '.trend path'), { drawSVG: '0%' }, { drawSVG: '100%', duration: 0.5, ease: 'power2.inOut' }, tT);
    tl.fromTo(q(s, '.chip'), { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35, ease: 'back.out(3)' }, tT + 0.3);
    cue(tT + 0.3, 'shimmer', 0.6);
    // "পরিষ্কার" — focus on the winner
    const tF = w('graph', 4);
    const barEls = qa(s, '.bar');
    tl.to(barEls.slice(0, 5), { opacity: 0.35, duration: 0.3 }, tF);
    tl.to(barEls[5], { scale: 1.06, duration: 0.3, transformOrigin: '50% 100%' }, tF);
    reveal(splitWords(q(s, '.gr-cap')), 'graph', 2);
    tl.to([card, num, q(s, '.gr-cap')], { opacity: 0, y: -40, duration: 0.25, ease: 'power3.in' }, end - 0.25);
  }

  // ===========================================================================
  // 5. YOUTUBE — "বড় বড় ইউটিউব চ্যানেল ঠিক এভাবেই ভিউ ধরে রাখে।"
  // ===========================================================================
  {
    const s = add(`
      <div class="scene s-yt">
        <div class="yt-cap bn">বড় বড় ইউটিউব চ্যানেল ঠিক এভাবেই</div>
        <div class="player">
          <div class="screen">
            <div class="mtg m-timeline">
              <i class="axis"></i>
              ${[1950, 1969, 1991, 2007, 2025].map((y, i) => `<div class="ev" style="left:${10 + i * 20}%"><i></i><b class="mono">${y}</b></div>`).join('')}
            </div>
            <div class="mtg m-compare">
              <div class="cmp"><span class="en">A</span><i><b style="--v:72%"></b></i><em class="mono">72%</em></div>
              <div class="cmp b"><span class="en">B</span><i><b style="--v:28%"></b></i><em class="mono">28%</em></div>
            </div>
            <div class="mtg m-retain">
              <div class="rt-head mono">AUDIENCE RETENTION</div>
              <svg viewBox="0 0 1000 400" preserveAspectRatio="none"><path class="flat" d="M0 60 C 200 140 300 300 1000 360"/><path class="up" d="M0 60 C 250 80 500 90 1000 110"/></svg>
              <span class="rt-a en">with motion graphics</span><span class="rt-b en">without</span>
            </div>
          </div>
          <div class="ctrl"><span class="pp">${I.play}</span><div class="prog"><i></i></div><span class="mono">12:48</span></div>
        </div>
        <div class="channel">
          <span class="ch-av">${I.play}</span>
          <div><b class="en">Explainer Channel</b><span class="mono">2.4M subscribers · 1.8M views</span></div>
          <div class="ch-sub en">Subscribe</div>
        </div>
        <div class="yt-cap2 bn">ভিউ <b>ধরে রাখে</b></div>
      </div>`);
    const start = S.youtube.start;
    const end = S.paths.start;
    show(s, start, end);
    tl.set(BG.uNight, { value: 1 }, start);
    tl.to(P.uOpacity, { value: 0.14, duration: 0.4 }, start);

    const cap = splitWords(q(s, '.yt-cap'));
    reveal(cap, 'youtube');
    const player = q(s, '.player');
    tl.fromTo(player, { y: 140, opacity: 0, rotateX: 22, scale: 0.9 }, { y: 0, opacity: 1, rotateX: 0, scale: 1, duration: 0.6 }, start - 0.05);
    tl.fromTo(q(s, '.channel'), { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45 }, w('youtube', 3));
    cue(start - 0.05, 'whoosh', 0.7);
    tl.fromTo(q(s, '.prog i'), { scaleX: 0.1 }, { scaleX: 0.7, duration: end - start, ease: 'none' }, start);

    // montage inside the player, cut on the words
    const [mT, mC, mR] = qa(s, '.mtg');
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
    const cap2 = splitWords(q(s, '.yt-cap2'));
    cap2.forEach((wd, i) => wordIn(wd, w('youtube', 6 + i)));
    tl.fromTo(q(s, '.ch-sub'), { backgroundColor: '#ffffff', color: '#10234B' }, { backgroundColor: 'rgba(255,255,255,0.14)', color: '#ffffff', duration: 0.2 }, w('youtube', 8));
    cue(w('youtube', 8), 'click', 0.7);
    tl.to([player, q(s, '.channel'), q(s, '.yt-cap2')], { opacity: 0, scale: 0.94, duration: 0.25, ease: 'power3.in' }, end - 0.25);
  }

  // ===========================================================================
  // 6. PATHS — "কিন্তু এতদিন এসব বানাতে, হয় হাজার টাকা দিয়ে কাউকে হায়ার করতেন, নয়তো সারারাত জেগে নিজে।"
  // ===========================================================================
  {
    const tracks = Array.from({ length: 16 }, (_, i) => {
      const keys = Array.from({ length: 5 }, (_, k) => `<b style="left:${8 + ((i * 13 + k * 19) % 84)}%"></b>`).join('');
      return `<div class="kt"><span class="mono">Layer ${i + 1}</span><div>${keys}</div></div>`;
    }).join('');
    const s = add(`
      <div class="scene s-paths">
        <div class="ph half left">
          <div class="ph-tag bn">কাউকে হায়ার করুন</div>
          <div class="fl-card">
            <div class="fl-top"><span class="av">${I.person}</span><div><b class="en">Motion Designer</b><span class="stars">${I.star.repeat(5)}</span></div></div>
            <div class="fl-price"><small class="bn">শুরু</small><b class="bn price">৳০</b></div>
            <div class="fl-meta"><span class="bn">ডেলিভারি <b>৩–৫ দিন</b></span><span class="bn">রিভিশন <b>+৳</b></span></div>
          </div>
        </div>
        <div class="ph half right">
          <div class="ph-tag bn">সারারাত জেগে নিজে</div>
          <div class="pile">${tracks}</div>
          <div class="hours"><span class="clk">${I.clock}</span><b class="bn n">১</b><span class="bn">ঘণ্টা…</span></div>
        </div>
        <i class="ph-split"></i>
        <div class="ph-or bn">নয়তো</div>
        <div class="ph-intro bn">কিন্তু এতদিন এসব বানাতে…</div>
      </div>`);
    const start = S.paths.start;
    const end = S.you.start;
    show(s, start, end);
    tl.set(BG.uNight, { value: 1 }, start);

    const left = q(s, '.left');
    const right = q(s, '.right');
    // "কিন্তু এতদিন এসব বানাতে…" — the turn
    const intro = splitWords(q(s, '.ph-intro'));
    reveal(intro, 'paths');
    const tSplit = w('paths', 4) - 0.1;
    wordsOut(q(s, '.ph-intro'), tSplit - 0.15);
    tl.fromTo(q(s, '.ph-split'), { scaleY: 0 }, { scaleY: 1, duration: 0.45, ease: 'expo.inOut' }, tSplit);
    tl.fromTo([left, right], { opacity: 0 }, { opacity: 1, duration: 0.3 }, tSplit);
    cue(tSplit, 'whoosh', 0.7);

    // "হাজার টাকা দিয়ে কাউকে হায়ার করতেন"
    const tH = w('paths', 5);
    const card = q(s, '.fl-card');
    tl.fromTo(card, { y: 80, opacity: 0, rotate: -4 }, { y: 0, opacity: 1, rotate: 0, duration: 0.55, ease: 'back.out(1.4)' }, tH - 0.2);
    tl.fromTo(qa(card, '.stars .ico'), { scale: 0 }, { scale: 1, duration: 0.25, stagger: 0.04, ease: 'back.out(3)' }, tH + 0.05);
    const price = q(s, '.price');
    const pr = { v: 0 };
    tl.fromTo(pr, { v: 0 }, { v: 15000, duration: 0.7, ease: 'power3.out', onUpdate: () => (price.textContent = '৳' + bnNum(Math.round(pr.v / 100) * 100).replace(/(\S)(?=(\S{3})+$)/g, '$1,') + '+') }, tH);
    cue(tH, 'tick', 0.8);
    cue(tH + 0.35, 'tick', 0.6);
    tl.fromTo(q(left, '.ph-tag'), { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4 }, w('paths', 8));

    // "নয়তো সারারাত জেগে নিজে"
    const tD = w('paths', 11);
    tl.fromTo(q(s, '.ph-or'), { scale: 0.5, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35, ease: 'back.out(2)' }, tD - 0.05);
    tl.to(left, { opacity: 0.35, filter: 'grayscale(0.6)', duration: 0.4 }, tD);
    tl.to(q(s, '.ph-or'), { opacity: 0, duration: 0.25 }, tD + 0.5);
    tl.fromTo(q(right, '.ph-tag'), { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4 }, w('paths', 12));
    const kts = qa(s, '.kt');
    const tPile = w('paths', 12) - 0.1;
    const pileDur = S.paths.end - tPile;
    tl.fromTo(kts, { x: 60, opacity: 0 }, { x: 0, opacity: 1, duration: 0.3, stagger: pileDur / kts.length, ease: 'power3.out' }, tPile);
    tl.fromTo(qa(s, '.kt b'), { scale: 0, rotate: 45 }, { scale: 1, rotate: 45, duration: 0.2, stagger: pileDur / kts.length / 5 }, tPile + 0.05);
    tl.fromTo(q(s, '.pile'), { y: 0 }, { y: -120, duration: pileDur, ease: 'power1.in' }, tPile);
    const hours = q(s, '.hours');
    const hn = q(hours, '.n');
    const hr = { v: 1 };
    tl.fromTo(hours, { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4 }, tPile);
    tl.fromTo(hr, { v: 1 }, { v: 8, duration: pileDur, ease: 'power2.in', onUpdate: () => (hn.textContent = bnNum(Math.round(hr.v))) }, tPile);
    const handA = q(hours, '.hand');
    const handB = q(hours, '.hand2');
    onFrame((t) => {
      if (t < tPile || t > end) return;
      const k = t - tPile;
      handA.style.transform = `rotate(${k * 720}deg)`;
      handB.style.transform = `rotate(${k * 60}deg)`;
    });
    for (let i = 0; i < 8; i++) cue(tPile + i * (pileDur / 8), 'tick', 0.5);
    tl.to([left, right, q(s, '.ph-split')], { opacity: 0, scale: 0.94, duration: 0.25, ease: 'power3.in' }, end - 0.25);
  }

  // ===========================================================================
  // 7. YOU — "এখন এগুলো আপনি নিজেই বানাবেন। ডিজাইন না জেনেও।"
  // ===========================================================================
  {
    const cards = [
      ['ZOOM', 'জুম', `<div class="ex ex-zoom">${'<i></i>'.repeat(3)}<span>${I.lens}</span></div>`],
      ['MAP', 'ম্যাপ', `<div class="ex ex-map"><svg viewBox="${map.bdBox[0] - 6} ${map.bdBox[1] - 4} ${map.bdBox[2] + 12} ${map.bdBox[3] + 8}"><path d="${map.bd}"/></svg><i class="dot"></i></div>`],
      ['GRAPH', 'গ্রাফ', `<div class="ex ex-graph">${[30, 45, 38, 70, 95].map((v) => `<i style="--h:${v}"></i>`).join('')}</div>`],
      ['EXPLAINER', 'এক্সপ্লেইনার', `<div class="ex ex-call"><i class="dev"></i><b class="a"></b><b class="b"></b><span class="mono t1">Chip</span><span class="mono t2">Battery</span></div>`],
    ];
    const s = add(`
      <div class="scene s-you">
        <div class="yo-track">${cards.map(([en, bn, art]) => `<div class="yo-card">${art}<div class="yo-lab"><b class="en">${en}</b><span class="bn">${bn}</span></div></div>`).join('')}</div>
        <div class="yo-big bn">এখন এগুলো আপনি <b>নিজেই</b> বানাবেন</div>
        <div class="yo-stamp bn">${I.check}<span>ডিজাইন না জেনেও</span></div>
      </div>`);
    const start = S.you.start;
    const end = S.for.start;
    show(s, start, end);
    tl.set(BG.uNight, { value: 0 }, start);
    tl.to(P.uOpacity, { value: 0.2, duration: 0.4 }, start);
    flash(start, 0.4, 0.3);

    // "এগুলো" — everything we just showed comes back as a row of cards
    const yc = qa(s, '.yo-card');
    tl.fromTo(yc, { y: 260, opacity: 0, rotate: (i) => (i - 1.5) * 8, scale: 0.8 }, { y: 0, opacity: 1, rotate: 0, scale: 1, duration: 0.5, stagger: 0.08, ease: 'back.out(1.4)' }, start - 0.05);
    for (let i = 0; i < 4; i++) cue(start - 0.05 + i * 0.08, 'pop', 0.5);
    const tA = start + 0.35;
    tl.fromTo(qa(s, '.ex-zoom i'), { scale: 0.2, opacity: 1 }, { scale: 1.6, opacity: 0, duration: 0.8, stagger: 0.15, ease: 'power2.out', repeat: 2 }, tA);
    tl.fromTo(q(s, '.ex-map path'), { drawSVG: '0%' }, { drawSVG: '100%', duration: 0.5, ease: 'power2.inOut' }, tA + 0.08);
    tl.fromTo(q(s, '.ex-map .dot'), { scale: 0 }, { scale: 1, duration: 0.3, ease: 'back.out(3)' }, tA + 0.45);
    tl.fromTo(qa(s, '.ex-graph i'), { scaleY: 0 }, { scaleY: 1, duration: 0.4, stagger: 0.06, ease: 'back.out(1.5)', transformOrigin: '50% 100%' }, tA + 0.16);
    tl.fromTo(qa(s, '.ex-call b'), { scaleX: 0 }, { scaleX: 1, duration: 0.3, stagger: 0.12, transformOrigin: 'left center' }, tA + 0.24);
    tl.fromTo(qa(s, '.ex-call span'), { opacity: 0 }, { opacity: 1, duration: 0.2, stagger: 0.12 }, tA + 0.45);

    const big = splitWords(q(s, '.yo-big'));
    reveal(big, 'you');
    tl.fromTo(q(s, '.yo-big b'), { color: '#ffffff' }, { color: '#BFE2FF', duration: 0.2 }, w('you', 3));
    shake(w('you', 3), 0.5);
    cue(w('you', 3), 'impact', 0.6);

    // "ডিজাইন না জেনেও" — stamp
    const stamp = q(s, '.yo-stamp');
    tl.fromTo(stamp, { scale: 2.4, rotate: 10, opacity: 0 }, { scale: 1, rotate: -4, opacity: 1, duration: 0.35, ease: 'back.out(1.7)' }, w('you', 5) - 0.05);
    flash(w('you', 5), 0.3, 0.3);
    shake(w('you', 5), 0.9);
    cue(w('you', 5), 'impact', 0.9);
    tl.to([...s.children], { opacity: 0, y: -40, duration: 0.25, ease: 'power3.in' }, end - 0.25);
  }

  // ===========================================================================
  // 8. FOR — "নিজের ভিডিওতে, অথবা ক্লায়েন্টের কাজে।"
  // ===========================================================================
  {
    const s = add(`
      <div class="scene s-for">
        <div class="fo-card own">
          <div class="fo-ico">${I.camera}</div>
          <b class="bn">নিজের ভিডিওতে</b>
          <div class="fo-meta"><span class="mono">YOUR CHANNEL</span><span class="fo-views en">+<b>0</b> views</span></div>
        </div>
        <div class="fo-or bn">অথবা</div>
        <div class="fo-card client">
          <div class="fo-ico">${I.brief}</div>
          <b class="bn">ক্লায়েন্টের কাজে</b>
          <div class="fo-meta"><span class="mono">INVOICE #024</span><span class="fo-paid en">${I.check} Paid</span></div>
        </div>
      </div>`);
    const start = S.for.start;
    const end = S.learn.start;
    show(s, start, end);
    tl.set(BG.uNight, { value: 0 }, start);
    const [own, client] = qa(s, '.fo-card');
    tl.fromTo(own, { x: -200, opacity: 0, rotateY: 30 }, { x: 0, opacity: 1, rotateY: 0, duration: 0.55 }, start - 0.05);
    cue(start, 'whoosh', 0.6);
    const vEl = q(s, '.fo-views b');
    const vv = { v: 0 };
    tl.fromTo(vv, { v: 0 }, { v: 128000, duration: 1.3, ease: 'power3.out', onUpdate: () => (vEl.textContent = Math.round(vv.v).toLocaleString('en-US')) }, start + 0.25);
    tl.fromTo(q(s, '.fo-or'), { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.3, ease: 'back.out(2)' }, w('for', 2) - 0.05);
    tl.fromTo(client, { x: 200, opacity: 0, rotateY: -30 }, { x: 0, opacity: 1, rotateY: 0, duration: 0.55 }, w('for', 3) - 0.12);
    tl.fromTo(q(s, '.fo-paid'), { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35, ease: 'back.out(3)' }, w('for', 4));
    cue(w('for', 3) - 0.12, 'whoosh', 0.6);
    cue(w('for', 4), 'pop', 0.8);
    // particles gather into the Lumademy mark for the end card
    tl.to(P.uOpacity, { value: 0.9, duration: 0.35 }, end - 0.5);
    tl.set(P.uJitter, { value: 0.03 }, end - 0.5);
    tl.to(P.wScatter, { value: 0, duration: 0.5, ease: 'power3.inOut' }, end - 0.5);
    tl.to(P.wLogo, { value: 1, duration: 0.5, ease: 'power3.inOut' }, end - 0.5);
    tl.to([...s.children], { opacity: 0, scale: 0.9, duration: 0.28, ease: 'power3.in' }, end - 0.38);
    cue(end - 0.5, 'riser', 0.7);
  }

  // ===========================================================================
  // 9. END CARD — "Lumademy AI Motion Graphics Crash Course। আজই Enroll করুন।"
  // ===========================================================================
  {
    const flow = ['Prompt', 'Animate', 'Map & Graph', 'Voice Sync', 'Export'];
    const s = add(`
      <div class="scene s-end">
        <div class="en-title en"><span>AI</span> <span>Motion</span> <span>Graphics</span> <span>Crash</span> <span>Course</span></div>
        <div class="en-flow">${flow.map((f, i) => `<span class="en">${f}</span>${i < flow.length - 1 ? '<i>→</i>' : ''}`).join('')}</div>
        <div class="en-now bn">আজই Enroll করুন</div>
        <div class="en-btn en"><span class="lbl">Enroll Now</span><span class="go">${I.arrow}</span><i class="touch"></i></div>
      </div>`);
    const start = S.learn.start;
    tl.set(s, { autoAlpha: 1 }, start);
    tl.set(BG.uNight, { value: 0 }, start);

    // the particle mark becomes the solid 3D logo
    tl.set(st, { logoY: 2.3, logoX: 0 }, start);
    tl.fromTo(st, { logo: 0 }, { logo: 0.62, duration: 0.7, ease: 'back.out(1.5)' }, start);
    tl.fromTo(st, { logoSpin: -Math.PI * 2 }, { logoSpin: 0, duration: 1.4, ease: 'expo.out' }, start);
    tl.to(P.wLogo, { value: 0, duration: 1.2, ease: 'power3.out' }, start + 0.05);
    tl.to(P.wScatter, { value: 1, duration: 1.2, ease: 'power3.out' }, start + 0.05);
    tl.to(P.uOpacity, { value: 0.25, duration: 1 }, start + 0.05);
    tl.set(P.uJitter, { value: 0.3 }, start + 0.05);
    flash(start, 0.8, 0.5);
    shake(start, 0.8);
    cue(start, 'impact', 0.9);
    cue(start, 'shimmer', 0.8);

    qa(s, '.en-title span').forEach((sp, i) => {
      tl.fromTo(sp, { yPercent: 110, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.4 }, w('learn', 1 + i) - 0.04);
      cue(w('learn', 1 + i), 'tick', 0.5);
    });
    tl.fromTo(qa(s, '.en-flow > *'), { x: 20, opacity: 0 }, { x: 0, opacity: 1, duration: 0.3, stagger: 0.05 }, w('learn', 5) + 0.1);

    // CTA
    const tN = w('cta', 0);
    tl.fromTo(q(s, '.en-now'), { scale: 1.5, opacity: 0, filter: 'blur(14px)' }, { scale: 1, opacity: 1, filter: 'blur(0px)', duration: 0.4 }, tN);
    cue(tN, 'impact', 0.7);
    const btn = q(s, '.en-btn');
    tl.fromTo(btn, { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45 }, tN + 0.1);
    const tClick = w('cta', 2) + 0.3;
    tl.fromTo(q(btn, '.touch'), { scale: 1.8, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.25 }, tClick - 0.25);
    tl.to(q(btn, '.touch'), { scale: 0.6, opacity: 0, duration: 0.3, ease: 'power2.in' }, tClick + 0.02);
    tl.to(btn, { keyframes: [{ scale: 0.95, duration: 0.08 }, { scale: 1, duration: 0.4, ease: 'expo.out' }] }, tClick);
    cue(tClick, 'click', 0.8);
    onFrame((t) => {
      if (t < tClick + 0.5) return;
      btn.style.boxShadow = `0 24px 70px rgba(3,20,70,.4), 0 0 0 ${8 + Math.sin(t * 4) * 6}px rgba(255,255,255,.16)`;
    });
  }

  tl.set({}, {}, END);
  cues.sort((a, b) => a.t - b.t);
  return { tl, cues, frameHooks, END, segments: timing.segments };
}
