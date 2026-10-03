// Builds every scene's DOM and one master GSAP timeline. All timings come from
// the ElevenLabs word timestamps (audio/timing.json), so each visual beat lands
// on the spoken word.

const ICON = 'assets/Lumademy_Icon_White.svg';
const LOCKUP = 'assets/Lumademy_All_White.svg';
const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
const bnNum = (n) => String(n).replace(/\d/g, (d) => BN_DIGITS[d]);

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

// Wraps every word of an element in a masked span (keeps Bengali clusters intact).
function splitWords(node) {
  const words = node.textContent.trim().split(/\s+/);
  node.innerHTML = words.map((w) => `<span class="w"><span class="wi">${w}</span></span>`).join(' ');
  return [...node.querySelectorAll('.wi')];
}

// Per-character split — only for Latin text.
function splitChars(node) {
  const text = node.textContent;
  node.innerHTML = [...text].map((c) => (c === ' ' ? ' ' : `<span class="c">${c}</span>`)).join('');
  return [...node.querySelectorAll('.c')];
}

const SVG_ARROW = '<svg viewBox="0 0 24 24" class="arrow"><path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SVG_SPARK = '<svg viewBox="0 0 24 24" class="spark"><path d="M12 1.5c.6 4.9 2.6 8.2 10.5 10.5C14.6 14.3 12.6 17.6 12 22.5 11.4 17.6 9.4 14.3 1.5 12 9.4 9.7 11.4 6.4 12 1.5Z" fill="currentColor"/></svg>';
const SVG_HEART = '<svg viewBox="0 0 24 24"><path d="M12 21s-7.5-4.6-9.6-9.3C1 8.4 3 4.5 6.7 4.5c2.2 0 3.7 1.2 5.3 3.1 1.6-1.9 3.1-3.1 5.3-3.1 3.7 0 5.7 3.9 4.3 7.2C19.5 16.4 12 21 12 21Z" fill="currentColor"/></svg>';

export async function buildTimeline({ timing, world, scenesRoot, fxRoot }) {
  const S = Object.fromEntries(timing.segments.map((s) => [s.id, s]));
  const w = (id, i) => S[id].words[i].start;
  const END = timing.duration + 2.2;

  const tl = gsap.timeline({ paused: true, defaults: { ease: 'expo.out', duration: 0.6 } });
  const cues = [];
  const frameHooks = [];
  const cue = (t, type, gain = 1) => cues.push({ t, type, gain });
  const onFrame = (fn) => frameHooks.push(fn);

  const st = world.state;
  const P = world.particles;
  const BG = world.bg;

  // ---------- global fx ----------
  const flashEl = fxRoot.querySelector('.flash');
  const wipeCircle = el('<div class="wipe-circle"></div>');
  const stripes = el('<div class="stripes"><i></i><i></i><i></i><i></i></div>');
  fxRoot.prepend(wipeCircle, stripes);

  const flash = (t, peak = 0.85, dur = 0.45) => {
    tl.fromTo(flashEl, { opacity: peak }, { opacity: 0, duration: dur, ease: 'power2.out', immediateRender: false }, t);
  };
  const shake = (t, amt = 1, dur = 0.45) => {
    tl.fromTo(st, { shake: amt }, { shake: 0, duration: dur, ease: 'power2.out', immediateRender: false }, t);
  };
  const show = (node, from, to) => {
    tl.set(node, { autoAlpha: 1 }, from);
    tl.set(node, { autoAlpha: 0 }, to);
  };
  const add = (html) => {
    const node = el(html);
    scenesRoot.appendChild(node);
    return node;
  };
  const q = (node, sel) => node.querySelector(sel);
  const qa = (node, sel) => [...node.querySelectorAll(sel)];

  // Initial world state
  tl.set(BG.uNight, { value: 1 }, 0);
  tl.set(BG.uWhite, { value: 0 }, 0);
  tl.set(P.wScatter, { value: 0 }, 0);
  tl.set(P.wSphere, { value: 1 }, 0);

  // =========================================================================
  // 1. HOOK — "এই অ্যাডটা দেখছেন?"
  // =========================================================================
  {
    const frame = add(`
      <div class="scene s-frame">
        <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
        <div class="hud-tag tl mono"><b class="rec"></b>REC</div>
        <div class="hud-tag tr mono">1920 × 1080 · 60 FPS</div>
        <div class="hud-tag bl mono">LUMADEMY / AI MOTION LAB</div>
        <div class="hud-tag br mono"><span class="tc">00:00:00</span></div>
      </div>`);
    const s = add(`
      <div class="scene s-hook">
        <h1 class="bn"><span class="l1">এই অ্যাডটা</span><span class="l2">দেখছেন?</span></h1>
      </div>`);
    show(frame, 0, S.nosoft.start);
    show(s, 0, S.reveal.start);
    const tc = q(frame, '.tc');
    onFrame((t) => {
      const f = Math.floor((t % 1) * 60);
      tc.textContent = `00:${String(Math.floor(t)).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
    });

    tl.fromTo(qa(frame, '.corner'), { scale: 1.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.7, stagger: 0.04 }, 0);
    tl.fromTo(qa(frame, '.hud-tag'), { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.5, stagger: 0.06 }, 0.15);
    tl.to(frame, { opacity: 0, duration: 0.3, ease: 'power2.in' }, S.nosoft.start - 0.3);

    const [a, b] = splitWords(q(s, '.l1'));
    const l2 = q(s, '.l2');
    tl.fromTo(a, { yPercent: 110 }, { yPercent: 0, duration: 0.45 }, w('hook', 0));
    tl.fromTo(b, { yPercent: 110 }, { yPercent: 0, duration: 0.45 }, w('hook', 1));
    tl.fromTo(l2, { scale: 2.4, opacity: 0, filter: 'blur(24px)' }, { scale: 1, opacity: 1, filter: 'blur(0px)', duration: 0.55 }, w('hook', 2));
    shake(w('hook', 2), 0.8);
    cue(w('hook', 0), 'whoosh', 0.7);
    cue(w('hook', 2), 'impact', 0.8);
    tl.to(q(s, 'h1'), { scale: 0.86, opacity: 0, filter: 'blur(10px)', duration: 0.35, ease: 'power3.in' }, S.reveal.start - 0.3);

    // particles: a glowing sphere breathing behind the title
    tl.fromTo(P.uOpacity, { value: 0 }, { value: 0.55, duration: 1.2, ease: 'power2.out' }, 0);
    tl.fromTo(P.uSpin, { value: 0 }, { value: 4.2, duration: S.reveal.start + 1.6, ease: 'none' }, 0);
    tl.set(P.uJitter, { value: 0.05 }, 0);
  }

  // =========================================================================
  // 2. REVEAL — "এর পুরোটাই বানানো হয়েছে এআই দিয়ে।"
  // =========================================================================
  {
    const s = add(`
      <div class="scene s-reveal">
        <div class="rv-top bn">এর পুরোটাই বানানো হয়েছে</div>
        <div class="rv-chip en">${SVG_SPARK}<span>100% MADE WITH AI</span></div>
      </div>`);
    show(s, S.reveal.start, S.nosoft.start);
    const words = splitWords(q(s, '.rv-top'));
    words.forEach((wd, i) => tl.fromTo(wd, { yPercent: 115, rotate: 6 }, { yPercent: 0, rotate: 0, duration: 0.45 }, w('reveal', i)));

    const tAI = w('reveal', 4);
    tl.to(P.uOpacity, { value: 0.95, duration: 0.6, ease: 'power2.out' }, S.reveal.start);
    // sphere -> "AI"
    tl.to(P.wSphere, { value: 0, duration: 0.42, ease: 'power3.inOut' }, tAI - 0.4);
    tl.to(P.wAI, { value: 1, duration: 0.42, ease: 'power3.inOut' }, tAI - 0.4);
    tl.to(P.uExplode, { keyframes: [{ value: 0.9, duration: 0.06, ease: 'none' }, { value: 0, duration: 0.6, ease: 'expo.out' }] }, tAI);
    tl.to(P.uSize, { keyframes: [{ value: 4.6, duration: 0.06 }, { value: 3.4, duration: 0.6 }] }, tAI);
    flash(tAI, 0.7, 0.5);
    shake(tAI, 1.2);
    cue(tAI - 0.4, 'riser', 0.6);
    cue(tAI, 'impact', 1);
    cue(tAI, 'shimmer', 0.8);

    const chip = q(s, '.rv-chip');
    tl.fromTo(chip, { y: 40, opacity: 0, scale: 0.8 }, { y: 0, opacity: 1, scale: 1, duration: 0.5, ease: 'back.out(2)' }, w('reveal', 5));
    cue(w('reveal', 5), 'pop');

    // dissolve: AI letters blow apart into dust
    const out = S.nosoft.start - 0.15;
    tl.to(q(s, '.rv-top'), { y: -60, opacity: 0, duration: 0.3, ease: 'power2.in' }, out - 0.1);
    tl.to(chip, { y: 40, opacity: 0, duration: 0.25, ease: 'power2.in' }, out - 0.1);
    tl.to(P.wAI, { value: 0, duration: 0.7, ease: 'power2.inOut' }, out);
    tl.to(P.wScatter, { value: 1, duration: 0.7, ease: 'power2.inOut' }, out);
    tl.to(P.uOpacity, { value: 0.32, duration: 0.7 }, out);
    tl.to(P.uJitter, { value: 0.25, duration: 0.7 }, out);
    cue(out, 'whoosh', 0.6);
  }

  // =========================================================================
  // 3. NO SOFTWARE — "কোনো জটিল সফটওয়্যার না, বছরের পর বছর প্র্যাকটিস না।"
  // =========================================================================
  {
    const layers = ['Shape Layer 7', 'Logo_Final_v3', 'Null 12', 'Adjustment', 'Particles [Trapcode]', 'Camera 1', 'Light 2', 'BG Solid'];
    const tracks = layers
      .map((_, i) => {
        const x = 6 + ((i * 37) % 30);
        const len = 30 + ((i * 23) % 45);
        const keys = Array.from({ length: 4 }, (_, k) => `<b class="kf" style="left:${x + (len / 3) * k}%"></b>`).join('');
        return `<div class="trk"><i class="bar" style="left:${x}%;width:${len}%"></i>${keys}</div>`;
      })
      .join('');
    const s = add(`
      <div class="scene s-nosoft">
        <div class="ns-title bn">কোনো জটিল সফটওয়্যার</div>
        <div class="app">
          <div class="app-bar"><i></i><i></i><i></i><span class="mono">Untitled Project.aep — Comp 1 — 1920×1080 — 29.97fps *</span></div>
          <div class="app-body">
            <div class="app-tools">${'<i></i>'.repeat(12)}</div>
            <div class="app-layers">${layers.map((n, i) => `<div class="row"><b style="--h:${(i * 47) % 360}"></b><span class="mono">${n}</span></div>`).join('')}</div>
            <div class="app-main">
              <div class="app-graph">
                <svg viewBox="0 0 800 240" preserveAspectRatio="none">
                  <path class="grid" d="M0 60H800M0 120H800M0 180H800M100 0V240M200 0V240M300 0V240M400 0V240M500 0V240M600 0V240M700 0V240"/>
                  <path class="curve c1" d="M0 210 C120 210 160 30 300 40 S520 220 640 120 760 30 800 30"/>
                  <path class="curve c2" d="M0 120 C80 40 200 230 360 160 S560 20 800 140"/>
                </svg>
              </div>
              <div class="app-tl"><div class="ruler mono">${Array.from({ length: 10 }, (_, i) => `<span>0:${String(i * 3).padStart(2, '0')}</span>`).join('')}</div>${tracks}<i class="playhead"></i></div>
            </div>
            <div class="app-props">${['Position', 'Scale', 'Rotation', 'Opacity', 'Motion Blur', 'Ease In', 'Ease Out', 'Expression'].map((p) => `<div class="prop"><span class="mono">${p}</span><i><b></b></i></div>`).join('')}</div>
          </div>
        </div>
        <svg class="strike x" viewBox="0 0 1920 1080"><path d="M560 250 L1360 850"/><path d="M1360 250 L560 850"/></svg>
        <div class="years">
          <div class="yr-dial">
            <svg viewBox="0 0 200 200"><circle class="trk" cx="100" cy="100" r="88"/><circle class="arc" cx="100" cy="100" r="88"/></svg>
            <div class="yr-num bn"><span class="n">০</span><small>বছর</small></div>
          </div>
          <div class="yr-label bn">বছরের পর বছর প্র্যাকটিস</div>
          <svg class="strike line" viewBox="0 0 1200 40" preserveAspectRatio="none"><path d="M0 22 L1200 18"/></svg>
        </div>
      </div>`);
    const start = S.nosoft.start;
    const end = S.prompt.start;
    show(s, start, end);

    const title = q(s, '.ns-title');
    const tw = splitWords(title);
    tw.forEach((wd, i) => tl.fromTo(wd, { yPercent: 110 }, { yPercent: 0, duration: 0.4 }, w('nosoft', i)));

    const app = q(s, '.app');
    tl.fromTo(app, { opacity: 0, scale: 0.82, rotateX: 28, y: 80 }, { opacity: 1, scale: 1, rotateX: 0, y: 0, duration: 0.6 }, start + 0.02);
    tl.fromTo(qa(s, '.app-tools i'), { scale: 0 }, { scale: 1, duration: 0.25, stagger: 0.015, ease: 'back.out(3)' }, start + 0.12);
    tl.fromTo(qa(s, '.app-layers .row'), { x: -40, opacity: 0 }, { x: 0, opacity: 1, duration: 0.3, stagger: 0.035 }, start + 0.15);
    tl.fromTo(qa(s, '.trk .bar'), { scaleX: 0 }, { scaleX: 1, duration: 0.35, stagger: 0.035, transformOrigin: 'left center' }, start + 0.2);
    tl.fromTo(qa(s, '.kf'), { scale: 0, rotate: 45 }, { scale: 1, rotate: 45, duration: 0.2, stagger: 0.008, ease: 'back.out(3)' }, start + 0.3);
    tl.fromTo(qa(s, '.prop'), { x: 40, opacity: 0 }, { x: 0, opacity: 1, duration: 0.3, stagger: 0.03 }, start + 0.2);
    tl.fromTo(qa(s, '.prop b'), { scaleX: 0 }, { scaleX: () => 0.25 + Math.random() * 0.7, duration: 0.6, stagger: 0.03, transformOrigin: 'left center' }, start + 0.35);
    tl.fromTo(qa(s, '.curve'), { drawSVG: '0%' }, { drawSVG: '100%', duration: 0.9, stagger: 0.12, ease: 'power2.inOut' }, start + 0.25);
    tl.fromTo(q(s, '.playhead'), { left: '6%' }, { left: '78%', duration: 1.2, ease: 'none' }, start + 0.2);
    cue(start, 'whoosh', 0.6);
    for (let i = 0; i < 8; i++) cue(start + 0.15 + i * 0.06, 'tick', 0.6);

    // "না," — cross it out
    const tNo = w('nosoft', 3);
    const xs = qa(s, '.strike.x path');
    tl.fromTo(xs[0], { drawSVG: '0%' }, { drawSVG: '100%', duration: 0.14, ease: 'power3.in' }, tNo - 0.08);
    tl.fromTo(xs[1], { drawSVG: '0%' }, { drawSVG: '100%', duration: 0.14, ease: 'power3.in' }, tNo + 0.04);
    shake(tNo + 0.06, 1.4);
    flash(tNo + 0.06, 0.25, 0.3);
    cue(tNo - 0.02, 'impact', 0.9);
    cue(tNo + 0.08, 'glitch', 0.7);
    tl.to(app, { scale: 0.7, rotateX: -24, y: 160, opacity: 0, filter: 'blur(14px)', duration: 0.38, ease: 'power3.in' }, tNo + 0.18);
    tl.to(q(s, '.strike.x'), { scale: 1.4, opacity: 0, duration: 0.3, ease: 'power3.in' }, tNo + 0.24);
    tl.to(title, { yPercent: -60, opacity: 0, duration: 0.3, ease: 'power3.in' }, tNo + 0.18);

    // years of practice
    const yrs = q(s, '.years');
    const yLabel = q(s, '.yr-label');
    const yw = splitWords(yLabel);
    const tY = w('nosoft', 4);
    tl.fromTo(yrs, { opacity: 0 }, { opacity: 1, duration: 0.01 }, tY - 0.1);
    tl.fromTo(q(s, '.yr-dial'), { scale: 0.4, rotate: -90, opacity: 0 }, { scale: 1, rotate: 0, opacity: 1, duration: 0.6, ease: 'back.out(1.6)' }, tY - 0.1);
    yw.forEach((wd, i) => tl.fromTo(wd, { yPercent: 110 }, { yPercent: 0, duration: 0.4 }, w('nosoft', 4 + i)));
    const counter = { v: 0 };
    const nEl = q(s, '.yr-num .n');
    tl.fromTo(counter, { v: 0 }, {
      v: 10, duration: w('nosoft', 8) - tY - 0.05, ease: 'power2.in',
      onUpdate: () => (nEl.textContent = bnNum(Math.round(counter.v)) + (counter.v > 9.5 ? '+' : '')),
    }, tY);
    tl.fromTo(q(s, '.arc'), { drawSVG: '0%' }, { drawSVG: '100%', duration: w('nosoft', 8) - tY, ease: 'power2.in' }, tY);
    for (let i = 0; i < 10; i++) cue(tY + (w('nosoft', 8) - tY) * Math.sqrt(i / 10), 'tick', 0.8);

    const tNo2 = w('nosoft', 8);
    tl.fromTo(q(s, '.strike.line path'), { drawSVG: '0%' }, { drawSVG: '100%', duration: 0.16, ease: 'power3.in' }, tNo2 - 0.06);
    shake(tNo2 + 0.1, 1.2);
    cue(tNo2, 'impact', 0.9);
    cue(tNo2 + 0.1, 'glitch', 0.8);
    tl.to(yrs, { keyframes: [
      { x: -18, skewX: 12, duration: 0.05, ease: 'none' },
      { x: 22, skewX: -16, duration: 0.05, ease: 'none' },
      { x: -8, skewX: 6, opacity: 0.6, duration: 0.05, ease: 'none' },
      { x: 0, skewX: 0, opacity: 0, scale: 1.1, filter: 'blur(12px)', duration: 0.25, ease: 'power2.in' },
    ] }, tNo2 + 0.15);
  }

  // =========================================================================
  // 4. PROMPT — "শুধু একটা প্রম্পট লিখুন,"
  // =========================================================================
  {
    const prompt = 'A cinematic 3D logo reveal with glowing particles';
    const s = add(`
      <div class="scene s-prompt">
        <div class="pr-title bn">শুধু একটা <b>প্রম্পট</b> লিখুন</div>
        <div class="pr-box">
          <div class="pr-ico">${SVG_SPARK}</div>
          <div class="pr-text en"><span class="typed"></span><i class="caret"></i></div>
          <div class="pr-btn en"><span>Generate</span>${SVG_ARROW}</div>
        </div>
        <div class="pr-chips en"><span>3D</span><span>Particles</span><span>Kinetic Type</span><span>16:9 · 60fps</span></div>
      </div>`);
    const start = S.prompt.start;
    const end = S.power.start + 0.05;
    show(s, start, end);
    tl.set(BG.uWhite, { value: 1 }, start);
    tl.set(P.uOpacity, { value: 0 }, start);
    flash(start, 0.9, 0.35);
    cue(start, 'whoosh', 0.7);

    const tw = splitWords(q(s, '.pr-title'));
    tw.forEach((wd, i) => tl.fromTo(wd, { yPercent: 110 }, { yPercent: 0, duration: 0.4 }, w('prompt', i)));
    const box = q(s, '.pr-box');
    tl.fromTo(box, { y: 80, opacity: 0, scale: 0.94 }, { y: 0, opacity: 1, scale: 1, duration: 0.5 }, start + 0.02);

    const typed = q(s, '.typed');
    const tc = { n: 0 };
    const tType = start + 0.22;
    const typeDur = S.power.start - tType - 0.28;
    tl.fromTo(tc, { n: 0 }, {
      n: prompt.length, duration: typeDur, ease: 'none',
      onUpdate: () => (typed.textContent = prompt.slice(0, Math.round(tc.n))),
    }, tType);
    for (let i = 0; i < 14; i++) cue(tType + (typeDur * i) / 14, 'tick', 0.5);
    tl.fromTo(qa(s, '.pr-chips span'), { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, stagger: 0.05, ease: 'back.out(2)' }, tType + typeDur - 0.3);

    const btn = q(s, '.pr-btn');
    const tClick = S.power.start - 0.2;
    tl.to(btn, { keyframes: [{ scale: 0.9, duration: 0.07 }, { scale: 1.06, duration: 0.15 }] }, tClick);
    cue(tClick, 'click', 1);

    // the click blooms into a full-screen blue circle
    tl.fromTo(wipeCircle, { scale: 0, opacity: 1 }, { scale: 1, opacity: 1, duration: 0.3, ease: 'power3.in', immediateRender: false }, tClick + 0.02);
    tl.set(wipeCircle, { scale: 0, opacity: 0 }, S.power.start + 0.16);
    tl.set(BG.uWhite, { value: 0 }, S.power.start);
    flash(S.power.start + 0.15, 0.6, 0.4);
  }

  // =========================================================================
  // 5. POWER — "আর এআই বানিয়ে দেবে থ্রিডি, অ্যানিমেশন, ট্রানজিশন, সবকিছু!"
  // =========================================================================
  {
    const s = add(`
      <div class="scene s-power">
        <div class="pw-lead bn">আর এআই বানিয়ে দেবে</div>
        <div class="pw-stack">
          <div class="pw-word"><span class="num mono">01</span><b class="en">3D</b><em class="bn">থ্রিডি</em></div>
          <div class="pw-word"><span class="num mono">02</span><b class="en">ANIMATION</b><em class="bn">অ্যানিমেশন</em></div>
          <div class="pw-word"><span class="num mono">03</span><b class="en">TRANSITION</b><em class="bn">ট্রানজিশন</em></div>
        </div>
        <div class="pw-all"><span class="bn">সবকিছু!</span><small class="en mono">EVERYTHING · GENERATED</small></div>
      </div>`);
    const start = S.power.start;
    const end = S.usecases.start;
    show(s, start, end);
    tl.set(BG.uNight, { value: 1 }, start);
    tl.set(P.wAI, { value: 0 }, start);
    tl.to(P.uOpacity, { value: 0.45, duration: 0.6 }, start);

    const lead = splitWords(q(s, '.pw-lead'));
    lead.forEach((wd, i) => tl.fromTo(wd, { yPercent: 110 }, { yPercent: 0, duration: 0.4 }, w('power', i)));

    const rows = qa(s, '.pw-word');
    const times = [w('power', 4), w('power', 5), w('power', 6)];
    rows.forEach((row, i) => {
      const chars = splitChars(q(row, 'b'));
      const t = times[i];
      tl.fromTo(row, { opacity: 0 }, { opacity: 1, duration: 0.01 }, t - 0.02);
      tl.fromTo(chars, { yPercent: 105, rotateX: -80 }, { yPercent: 0, rotateX: 0, duration: 0.5, stagger: 0.02 }, t - 0.02);
      tl.fromTo(q(row, '.num'), { x: -30, opacity: 0 }, { x: 0, opacity: 1, duration: 0.4 }, t);
      tl.fromTo(q(row, 'em'), { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4 }, t + 0.06);
      if (i < rows.length - 1) tl.to(row, { opacity: 0.28, duration: 0.3 }, times[i + 1] - 0.05);
      cue(t, i === 2 ? 'whoosh' : 'pop', 0.9);
    });
    tl.fromTo(st, { showcase: 0 }, { showcase: 1, duration: 0.01 }, times[0] - 0.05);
    tl.fromTo(st, { knot: 0 }, { knot: 1, duration: 0.8, ease: 'back.out(1.7)' }, times[0] - 0.05);
    shake(times[0], 0.6);
    tl.fromTo(st, { cubes: 0 }, { cubes: 1, duration: 0.7, ease: 'none' }, times[1] - 0.05);
    tl.fromTo(st, { glass: 0 }, { glass: 1, duration: 0.6 }, times[1] + 0.25);
    for (let i = 0; i < 7; i++) cue(times[1] + i * 0.1, 'pop', 0.45);

    // TRANSITION: diagonal stripes sweep across the frame
    const bars = qa(stripes, 'i');
    tl.fromTo(bars, { xPercent: -130 }, { xPercent: 130, duration: 0.55, stagger: 0.05, ease: 'power3.inOut', immediateRender: false }, times[2] - 0.08);
    tl.set(stripes, { autoAlpha: 1 }, times[2] - 0.1);
    tl.set(stripes, { autoAlpha: 0 }, times[2] + 0.8);
    tl.fromTo(st, { ico: 0 }, { ico: 1, duration: 0.5, ease: 'back.out(2)' }, times[2] + 0.2);
    tl.fromTo(st, { camRoll: 0 }, { camRoll: 0.06, duration: 0.4, ease: 'power2.inOut' }, times[2]);
    tl.to(st, { camRoll: 0, duration: 0.6, ease: 'power2.inOut' }, times[2] + 0.45);

    // EVERYTHING: centre the showcase and blow it apart
    const tAll = w('power', 7);
    tl.to(q(s, '.pw-lead'), { opacity: 0, y: -30, duration: 0.25, ease: 'power2.in' }, tAll - 0.25);
    tl.to(rows, { opacity: 0, x: -80, duration: 0.25, stagger: 0.03, ease: 'power2.in' }, tAll - 0.25);
    tl.fromTo(st, { showX: 5.6 }, { showX: 0, duration: 0.35, ease: 'power3.inOut' }, tAll - 0.3);
    tl.fromTo(st, { burst: 0 }, { burst: 1, duration: 1.0, ease: 'expo.out' }, tAll);
    tl.to(P.uExplode, { keyframes: [{ value: 3, duration: 0.6, ease: 'expo.out' }, { value: 0, duration: 0.01 }] }, tAll);
    tl.to(P.uOpacity, { value: 0.9, duration: 0.1 }, tAll);
    const all = q(s, '.pw-all');
    tl.fromTo(all, { scale: 1.9, opacity: 0, filter: 'blur(30px)' }, { scale: 1, opacity: 1, filter: 'blur(0px)', duration: 0.5 }, tAll);
    flash(tAll, 0.8, 0.5);
    shake(tAll, 2, 0.7);
    cue(tAll - 0.5, 'riser', 0.7);
    cue(tAll, 'impact', 1.1);
    cue(tAll, 'shimmer', 0.6);
    tl.to(all, { scale: 1.25, opacity: 0, filter: 'blur(16px)', duration: 0.3, ease: 'power3.in' }, end - 0.3);
    tl.to(st, { showcase: 0, duration: 0.3, ease: 'power3.in' }, end - 0.3);
    tl.to(P.uOpacity, { value: 0.3, duration: 0.4 }, end - 0.3);
  }

  // =========================================================================
  // 6. USE CASES — "লোগো অ্যানিমেশন, প্রোডাক্ট অ্যাড, সোশ্যাল মিডিয়া রিলস।"
  // =========================================================================
  {
    const hearts = Array.from({ length: 7 }, (_, i) => `<i class="ht" style="--i:${i}">${SVG_HEART}</i>`).join('');
    const s = add(`
      <div class="scene s-uses">
        <div class="uc-title mono">WHAT YOU'LL CREATE</div>
        <div class="uc-row">
          <div class="uc-card">
            <div class="uc-screen scr-logo">
              <i class="uc-ring"></i><i class="uc-ring"></i><i class="uc-ring"></i>
              <img class="uc-logo" src="${ICON}" alt="">
              <div class="uc-logo-word en">Lumademy</div>
            </div>
            <div class="uc-meta"><span class="mono">01 · LOGO REVEAL</span><b class="bn">লোগো অ্যানিমেশন</b></div>
          </div>
          <div class="uc-card">
            <div class="uc-screen scr-prod">
              <div class="prod-glow"></div>
              <div class="prod">
                <div class="prod-cap"></div>
                <div class="prod-body"><span class="en">LUMA</span><small class="mono">AIR · 250ml</small><i class="prod-shine"></i></div>
              </div>
              <div class="prod-floor"></div>
              <div class="prod-badge en">NEW</div>
              <div class="prod-price bn">৳১,২৯৯</div>
            </div>
            <div class="uc-meta"><span class="mono">02 · PRODUCT AD</span><b class="bn">প্রোডাক্ট অ্যাড</b></div>
          </div>
          <div class="uc-card">
            <div class="uc-screen scr-reel">
              <div class="phone">
                <div class="reel-art"><i></i><i></i><i></i></div>
                <div class="reel-bars"><i><b></b></i><i><b></b></i><i><b></b></i></div>
                <div class="reel-side"><span>${SVG_HEART}<em class="likes en">12.4K</em></span><span class="dot3"></span></div>
                <div class="reel-cap en"><b>@lumademy</b> made with AI ✦</div>
                <div class="hearts">${hearts}</div>
              </div>
            </div>
            <div class="uc-meta"><span class="mono">03 · SOCIAL REELS</span><b class="bn">সোশ্যাল মিডিয়া রিলস</b></div>
          </div>
        </div>
      </div>`);
    const start = S.usecases.start;
    const end = S.limits.start;
    show(s, start, end);
    tl.set(BG.uNight, { value: 0 }, start);
    flash(start, 0.5, 0.35);
    tl.fromTo(q(s, '.uc-title'), { opacity: 0, letterSpacing: '0.6em' }, { opacity: 1, letterSpacing: '0.32em', duration: 0.8 }, start);

    const cards = qa(s, '.uc-card');
    const times = [w('usecases', 0), w('usecases', 2), w('usecases', 4)];
    cards.forEach((c, i) => {
      tl.fromTo(c, { opacity: 0, rotateY: -65, x: 260, z: -500 }, { opacity: 1, rotateY: 0, x: 0, z: 0, duration: 0.75 }, times[i] - 0.08);
      tl.fromTo(q(c, '.uc-meta'), { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5 }, times[i] + 0.1);
      cue(times[i] - 0.08, 'whoosh', 0.55);
    });

    // live mini-animations inside each card, all derived from time
    const rings = qa(s, '.uc-ring');
    const logo = q(s, '.uc-logo');
    const word = q(s, '.uc-logo-word');
    const prod = q(s, '.prod');
    const shine = q(s, '.prod-shine');
    const badge = q(s, '.prod-badge');
    const price = q(s, '.prod-price');
    const bars = qa(s, '.reel-bars b');
    const likes = q(s, '.likes');
    const hts = qa(s, '.ht');
    const art = qa(s, '.reel-art i');
    const ease = gsap.parseEase('back.out(2)');
    const clamp = gsap.utils.clamp(0, 1);
    onFrame((t) => {
      if (t < start || t > end) return;
      const a = t - times[0];
      const lp = clamp(a / 0.7);
      logo.style.transform = `scale(${ease(lp) * (1 + Math.sin(t * 3) * 0.03)}) rotate(${(1 - lp) * -40}deg)`;
      rings.forEach((r, i) => {
        const p = ((a * 0.9 + i / 3) % 1 + 1) % 1;
        r.style.transform = `translate(-50%,-50%) scale(${0.4 + p * 1.6})`;
        r.style.opacity = a > 0 ? (1 - p) * 0.8 : 0;
      });
      word.style.opacity = clamp((a - 0.45) / 0.3);
      word.style.letterSpacing = `${0.4 - clamp((a - 0.45) / 0.5) * 0.4}em`;

      const b = t - times[1];
      prod.style.transform = `translateY(${Math.sin(t * 2.2) * 8}px) rotate(${Math.sin(t * 1.6) * 5}deg)`;
      shine.style.transform = `translateX(${((b * 120) % 400) - 150}%) skewX(-20deg)`;
      badge.style.transform = `scale(${ease(clamp((b - 0.3) / 0.4))}) rotate(-12deg)`;
      price.style.transform = `translateY(${(1 - ease(clamp((b - 0.45) / 0.4))) * 40}px)`;
      price.style.opacity = clamp((b - 0.45) / 0.2);

      const c = t - times[2];
      bars.forEach((bar, i) => (bar.style.transform = `scaleX(${clamp(c * 1.6 - i * 0.6)})`));
      likes.textContent = (12.4 + Math.max(0, c) * 3.1).toFixed(1) + 'K';
      hts.forEach((h, i) => {
        const p = (((c - i * 0.18) * 0.8) % 1 + 1) % 1;
        h.style.opacity = c > i * 0.18 ? Math.sin(p * Math.PI) : 0;
        h.style.transform = `translate(${Math.sin(p * 9 + i) * 18}px, ${-p * 230}px) scale(${0.6 + p * 0.6})`;
      });
      art.forEach((o, i) => (o.style.transform = `translate(${Math.sin(t * (0.8 + i * 0.3) + i * 2) * 60}px, ${Math.cos(t * (0.7 + i * 0.2) + i) * 80}px)`));
    });

    tl.to(cards, { z: 700, opacity: 0, duration: 0.35, stagger: 0.05, ease: 'power3.in' }, end - 0.35);
    tl.to(q(s, '.uc-title'), { opacity: 0, duration: 0.2 }, end - 0.3);
    cue(end - 0.4, 'riser', 0.7);
  }

  // =========================================================================
  // 7. NO LIMITS — "আপনার ক্রিয়েটিভিটির আর কোনো সীমা নেই।"
  // =========================================================================
  {
    const s = add(`
      <div class="scene s-limits">
        <div class="lm-1 bn">আপনার ক্রিয়েটিভিটির</div>
        <div class="lm-2 bn">আর কোনো সীমা নেই</div>
        <div class="lm-en en">NO LIMITS<span>∞</span></div>
      </div>`);
    const start = S.limits.start;
    const end = S.course.start;
    show(s, start, end);
    tl.set(BG.uNight, { value: 1 }, start);
    flash(start, 0.7, 0.4);
    shake(start, 0.8);
    cue(start, 'impact', 0.8);

    // fly through the tunnel
    tl.set(P.wScatter, { value: 0 }, start);
    tl.set(P.wTunnel, { value: 1 }, start);
    tl.set(P.uJitter, { value: 0.05 }, start);
    tl.set(P.uOpacity, { value: 0.9 }, start);
    tl.fromTo(st, { tunnel: 0 }, { tunnel: 1, duration: 0.3 }, start);
    tl.fromTo(st, { camZ: 22 }, { camZ: -185, duration: end - start - 0.01, ease: 'power2.in' }, start);
    tl.set(st, { tunnel: 0, camZ: 22 }, end);
    tl.set(P.wTunnel, { value: 0 }, end);
    tl.set(P.wScatter, { value: 1 }, end);

    const l1 = splitWords(q(s, '.lm-1'));
    l1.forEach((wd, i) => tl.fromTo(wd, { yPercent: 110 }, { yPercent: 0, duration: 0.45 }, w('limits', i)));
    tl.to(q(s, '.lm-1'), { y: -150, scale: 0.62, opacity: 0.75, duration: 0.5, ease: 'power3.inOut' }, w('limits', 2) - 0.2);
    const l2 = splitWords(q(s, '.lm-2'));
    l2.forEach((wd, i) => {
      const t = w('limits', 2 + i);
      tl.fromTo(wd, { scale: 0.3, opacity: 0, filter: 'blur(18px)' }, { scale: 1, opacity: 1, filter: 'blur(0px)', duration: 0.4 }, t);
      cue(t, i === 3 ? 'impact' : 'pop', i === 3 ? 1 : 0.6);
    });
    const tNei = w('limits', 5);
    shake(tNei, 1.4);
    flash(tNei, 0.35, 0.3);
    const en = q(s, '.lm-en');
    tl.fromTo(en, { opacity: 0, letterSpacing: '1.2em' }, { opacity: 1, letterSpacing: '0.42em', duration: 0.6 }, tNei + 0.05);
    tl.to([q(s, '.lm-1'), q(s, '.lm-2'), en], { scale: 2.4, opacity: 0, filter: 'blur(20px)', duration: 0.3, ease: 'power3.in', stagger: 0.02 }, end - 0.3);
    cue(end - 0.35, 'whoosh', 0.9);
  }

  // =========================================================================
  // 8. COURSE — "লুমাডেমির নতুন কোর্সে শিখুন, এআই দিয়ে প্রফেশনাল মোশন গ্রাফিক্স বানানো, একদম শুরু থেকে।"
  // =========================================================================
  {
    const modules = [
      ['প্রম্পট থেকে মোশন', 'Prompt → Motion'],
      ['GSAP অ্যানিমেশন', 'Timelines & Easing'],
      ['Three.js দিয়ে 3D', 'Lights · Materials · Camera'],
      ['কাইনেটিক টাইপোগ্রাফি', 'Bangla & English Type'],
      ['এআই ভয়েসওভার সিঙ্ক', 'Word-level Sync'],
      ['ক্লায়েন্ট-রেডি এক্সপোর্ট', '4K · Reels · Ads'],
    ];
    const s = add(`
      <div class="scene s-course">
        <img class="co-logo" src="${LOCKUP}" alt="Lumademy">
        <div class="co-eyebrow"><i class="dot"></i><span class="bn">নতুন কোর্স</span><span class="en">NEW COURSE</span></div>
        <h2 class="co-title en"><span class="ln">AI Motion</span><span class="ln">Graphics</span></h2>
        <div class="co-sub bn">এআই দিয়ে প্রফেশনাল মোশন গ্রাফিক্স বানানো</div>
        <div class="co-level">
          <div class="lvl-labels"><span class="bn">একদম শুরু থেকে</span><span class="en mono">BEGINNER → PRO</span></div>
          <div class="lvl-track"><i class="lvl-fill"></i><i class="lvl-knob"></i></div>
        </div>
        <div class="co-panel">
          <div class="co-panel-head"><span class="bn">কোর্সে যা শিখবেন</span><span class="mono">06 MODULES</span></div>
          ${modules.map(([bn, en], i) => `<div class="mod"><span class="mono idx">${String(i + 1).padStart(2, '0')}</span><div><b class="bn">${bn}</b><small class="en">${en}</small></div><i class="chk"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></i></div>`).join('')}
        </div>
      </div>`);
    const start = S.course.start;
    const end = S.career.start;
    show(s, start, end);
    tl.set(BG.uNight, { value: 0 }, start);
    tl.to(P.uOpacity, { value: 0.22, duration: 0.6 }, start);
    tl.set(P.uJitter, { value: 0.3 }, start);
    flash(start, 0.9, 0.45);
    cue(start, 'impact', 0.7);

    tl.fromTo(q(s, '.co-logo'), { x: -60, opacity: 0 }, { x: 0, opacity: 1, duration: 0.6 }, w('course', 0));
    tl.fromTo(q(s, '.co-eyebrow'), { y: 24, opacity: 0, scale: 0.9 }, { y: 0, opacity: 1, scale: 1, duration: 0.5, ease: 'back.out(2)' }, w('course', 1));
    cue(w('course', 1), 'pop', 0.7);
    qa(s, '.co-title .ln').forEach((ln, i) => {
      const chars = splitChars(ln);
      tl.fromTo(chars, { yPercent: 110, rotate: 8 }, { yPercent: 0, rotate: 0, duration: 0.55, stagger: 0.025 }, w('course', 2) + i * 0.12);
    });
    cue(w('course', 2), 'whoosh', 0.6);

    const sub = splitWords(q(s, '.co-sub'));
    sub.forEach((wd, i) => tl.fromTo(wd, { yPercent: 110 }, { yPercent: 0, duration: 0.4 }, w('course', 4 + i)));
    // highlight "প্রফেশনাল মোশন গ্রাফিক্স"
    [2, 3, 4].forEach((k) => tl.fromTo(sub[k], { color: '#ffffff' }, { color: '#BFE2FF', duration: 0.3 }, w('course', 4 + k) + 0.1));

    const panel = q(s, '.co-panel');
    tl.fromTo(panel, { x: 120, opacity: 0, rotateY: -25 }, { x: 0, opacity: 1, rotateY: 0, duration: 0.7 }, w('course', 3) - 0.1);
    const mods = qa(s, '.mod');
    const mStart = w('course', 4);
    const mStep = (w('course', 10) - mStart) / mods.length;
    mods.forEach((m, i) => {
      const t = mStart + i * mStep;
      tl.fromTo(m, { x: 50, opacity: 0 }, { x: 0, opacity: 1, duration: 0.4 }, t);
      tl.fromTo(q(m, '.chk'), { scale: 0 }, { scale: 1, duration: 0.35, ease: 'back.out(3)' }, t + 0.15);
      cue(t + 0.15, 'tick', 0.9);
    });

    const lvl = q(s, '.co-level');
    const tLvl = w('course', 10);
    tl.fromTo(lvl, { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4 }, tLvl - 0.1);
    tl.fromTo(q(s, '.lvl-fill'), { scaleX: 0 }, { scaleX: 1, duration: end - tLvl - 0.35, ease: 'power2.inOut' }, tLvl + 0.1);
    tl.fromTo(q(s, '.lvl-knob'), { left: '0%' }, { left: '100%', duration: end - tLvl - 0.35, ease: 'power2.inOut' }, tLvl + 0.1);
    cue(tLvl, 'riser', 0.5);

    tl.to([...s.children], { x: -120, opacity: 0, duration: 0.3, stagger: 0.015, ease: 'power3.in' }, end - 0.32);
    cue(end - 0.25, 'whoosh', 0.6);
  }

  // =========================================================================
  // 9. CAREER — "ফ্রিল্যান্সিং, ক্লায়েন্ট প্রজেক্ট, কিংবা নিজের ব্র্যান্ড।"
  // =========================================================================
  {
    const icons = [
      '<svg viewBox="0 0 48 48"><rect x="6" y="14" width="36" height="26" rx="5" fill="none" stroke="currentColor" stroke-width="3.5"/><path d="M17 14v-3a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v3M6 25h36" fill="none" stroke="currentColor" stroke-width="3.5"/></svg>',
      '<svg viewBox="0 0 48 48"><circle cx="17" cy="17" r="6.5" fill="none" stroke="currentColor" stroke-width="3.5"/><circle cx="33" cy="19" r="5" fill="none" stroke="currentColor" stroke-width="3.5"/><path d="M5 40c1.5-7 6.2-10.5 12-10.5S27.5 33 29 40M30 30.5c5.5 0 10 3 12 9.5" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/></svg>',
      '<svg viewBox="0 0 48 48"><path d="M24 5l5.6 11.6 12.7 1.7-9.3 8.8 2.3 12.6L24 33.6l-11.3 6.1 2.3-12.6-9.3-8.8 12.7-1.7z" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linejoin="round"/></svg>',
    ];
    const s = add(`
      <div class="scene s-career">
        <div class="cr-title mono">YOUR SKILL, YOUR WAY</div>
        <div class="cr-row">
          <div class="cr-card">
            <div class="cr-ico">${icons[0]}</div>
            <b class="bn">ফ্রিল্যান্সিং</b><small class="en">Freelancing</small>
            <svg class="cr-graph" viewBox="0 0 300 90"><path d="M4 80 C40 76 60 60 90 62 S140 40 170 44 230 14 296 8"/></svg>
          </div>
          <div class="cr-card">
            <div class="cr-ico">${icons[1]}</div>
            <b class="bn">ক্লায়েন্ট প্রজেক্ট</b><small class="en">Client Projects</small>
            <div class="cr-tasks">${['Brand intro', 'Explainer', 'Launch ad'].map((x) => `<span><i></i><em class="en">${x}</em></span>`).join('')}</div>
          </div>
          <div class="cr-card">
            <div class="cr-ico">${icons[2]}</div>
            <b class="bn">নিজের ব্র্যান্ড</b><small class="en">Your Own Brand</small>
            <div class="cr-count"><span class="en">0</span><small class="mono">FOLLOWERS</small></div>
          </div>
        </div>
      </div>`);
    const start = S.career.start;
    const end = S.cta.start;
    show(s, start, end);
    tl.to(P.uOpacity, { value: 0.3, duration: 0.5 }, start);
    tl.fromTo(q(s, '.cr-title'), { opacity: 0, letterSpacing: '0.6em' }, { opacity: 1, letterSpacing: '0.32em', duration: 0.8 }, start);

    const cards = qa(s, '.cr-card');
    const times = [w('career', 0), w('career', 1), w('career', 4)];
    cards.forEach((c, i) => {
      const t = times[i] - 0.06;
      tl.fromTo(c, { y: 160, opacity: 0, scale: 0.75, rotate: i === 1 ? 0 : (i - 1) * 8 }, { y: 0, opacity: 1, scale: 1, rotate: 0, duration: 0.6, ease: 'back.out(1.5)' }, t);
      tl.fromTo(q(c, '.cr-ico'), { scale: 0, rotate: -40 }, { scale: 1, rotate: 0, duration: 0.5, ease: 'back.out(2.5)' }, t + 0.12);
      cue(t, 'pop', 1);
      shake(t + 0.08, 0.35, 0.3);
    });
    tl.fromTo(q(s, '.cr-graph path'), { drawSVG: '0%' }, { drawSVG: '100%', duration: 1.0, ease: 'power2.inOut' }, times[0] + 0.25);
    qa(s, '.cr-tasks span').forEach((sp, i) => {
      tl.fromTo(sp, { x: 30, opacity: 0 }, { x: 0, opacity: 1, duration: 0.3 }, times[1] + 0.2 + i * 0.16);
      tl.fromTo(q(sp, 'i'), { backgroundColor: 'rgba(41,112,236,0)' }, { backgroundColor: 'rgba(41,112,236,1)', duration: 0.15 }, times[1] + 0.45 + i * 0.22);
    });
    const cnt = { v: 0 };
    const cEl = q(s, '.cr-count span');
    tl.fromTo(cnt, { v: 0 }, { v: 25000, duration: end - times[2] - 0.2, ease: 'power2.out', onUpdate: () => (cEl.textContent = Math.round(cnt.v).toLocaleString('en-US')) }, times[2] + 0.15);

    tl.to(cards, { y: -80, opacity: 0, scale: 0.9, duration: 0.28, stagger: 0.04, ease: 'power3.in' }, end - 0.3);
    tl.to(q(s, '.cr-title'), { opacity: 0, duration: 0.2 }, end - 0.3);
  }

  // =========================================================================
  // 10. CTA — "আজই এনরোল করুন।"
  // =========================================================================
  {
    const s = add(`
      <div class="scene s-cta">
        <div class="cta-title bn">আজই এনরোল করুন</div>
        <div class="cta-btn en"><span>Enroll Now</span>${SVG_ARROW}<i class="cta-ring"></i></div>
        <svg class="cta-cursor" viewBox="0 0 24 24"><path d="M4 2.5l15 8.2-6.6 1.6 3.9 7.3-2.7 1.4-3.9-7.3L4.9 18z" fill="#fff" stroke="#10234B" stroke-width="1.4" stroke-linejoin="round"/></svg>
      </div>`);
    const start = S.cta.start;
    const end = S.outro.start;
    show(s, start, end);
    flash(start, 0.6, 0.35);
    const ws = splitWords(q(s, '.cta-title'));
    ws.forEach((wd, i) => {
      const t = w('cta', i);
      tl.fromTo(wd, { yPercent: 100, scale: 1.4 }, { yPercent: 0, scale: 1, duration: 0.42 }, t);
      cue(t, 'impact', 0.55);
    });
    shake(w('cta', 2), 1);
    const btn = q(s, '.cta-btn');
    tl.fromTo(btn, { y: 60, opacity: 0, scale: 0.8 }, { y: 0, opacity: 1, scale: 1, duration: 0.45, ease: 'back.out(2)' }, w('cta', 2) - 0.1);
    const cursor = q(s, '.cta-cursor');
    const tClick = end - 0.42;
    tl.fromTo(cursor, { x: 340, y: 220, opacity: 0 }, { x: 0, y: 0, opacity: 1, duration: 0.35, ease: 'power3.out' }, tClick - 0.38);
    tl.to(btn, { keyframes: [{ scale: 0.92, duration: 0.06 }, { scale: 1.05, duration: 0.18 }] }, tClick);
    tl.to(cursor, { keyframes: [{ scale: 0.85, duration: 0.06 }, { scale: 1, duration: 0.12 }] }, tClick);
    tl.fromTo(q(s, '.cta-ring'), { scale: 1, opacity: 0.9 }, { scale: 1.8, opacity: 0, duration: 0.5, ease: 'power2.out' }, tClick);
    cue(tClick, 'click', 1);
    tl.to([q(s, '.cta-title'), btn, cursor], { scale: 0.6, opacity: 0, filter: 'blur(10px)', duration: 0.25, ease: 'power3.in' }, end - 0.22);

    // particles gather into the Lumademy mark
    tl.to(P.uOpacity, { value: 0.95, duration: 0.5 }, tClick - 0.2);
    tl.set(P.uJitter, { value: 0.03 }, tClick - 0.2);
    tl.to(P.wScatter, { value: 0, duration: 0.6, ease: 'power3.inOut' }, tClick - 0.25);
    tl.to(P.wLogo, { value: 1, duration: 0.6, ease: 'power3.inOut' }, tClick - 0.25);
    cue(tClick - 0.25, 'riser', 0.8);
  }

  // =========================================================================
  // 11. OUTRO — "লুমাডেমি। আপনার কল্পনা, এআই-এর গতিতে।"
  // =========================================================================
  {
    const s = add(`
      <div class="scene s-outro">
        <div class="ou-wordmark"></div>
        <div class="ou-tag bn">আপনার কল্পনা, এআই-এর গতিতে।</div>
        <div class="ou-cta"><span class="en">AI Motion Graphics Course</span><i></i><span class="bn">এনরোলমেন্ট চলছে</span></div>
      </div>`);
    const start = S.outro.start;
    tl.set(s, { autoAlpha: 1 }, start);

    // logo lands: particles release, the 3D mark takes over
    flash(start, 0.95, 0.6);
    shake(start, 1.2, 0.6);
    cue(start, 'impact', 1.1);
    cue(start, 'shimmer', 0.9);
    tl.set(P.uJitter, { value: 0.3 }, start);
    tl.to(P.wLogo, { value: 0, duration: 1.6, ease: 'power3.out' }, start);
    tl.to(P.wScatter, { value: 1, duration: 1.6, ease: 'power3.out' }, start);
    tl.to(P.uOpacity, { value: 0.35, duration: 1.2 }, start);
    tl.fromTo(st, { logo: 0 }, { logo: 1, duration: 1.0, ease: 'back.out(1.4)' }, start);
    tl.fromTo(st, { logoSpin: -Math.PI * 2.0 }, { logoSpin: 0, duration: 1.8, ease: 'expo.out' }, start);

    // wordmark: stroke draws on, then fills
    const wm = q(s, '.ou-wordmark');
    const { path } = await buildWordmark(wm);
    tl.fromTo(path, { drawSVG: '0%', fillOpacity: 0 }, { drawSVG: '100%', duration: 0.9, ease: 'power2.inOut' }, start + 0.1);
    tl.to(path, { fillOpacity: 1, duration: 0.5, ease: 'power2.out' }, start + 0.7);
    tl.fromTo(wm, { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6 }, start + 0.1);

    const tag = splitWords(q(s, '.ou-tag'));
    tag.forEach((wd, i) => tl.fromTo(wd, { yPercent: 110 }, { yPercent: 0, duration: 0.45 }, w('outro', 1 + i)));
    tl.fromTo(q(s, '.ou-cta'), { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6 }, S.outro.end + 0.1);
    cue(S.outro.end + 0.1, 'pop', 0.6);
  }

  tl.set({}, {}, END); // pad the timeline to the full length
  cues.sort((a, b) => a.t - b.t);
  return { tl, cues, frameHooks, END, segments: timing.segments };
}

// Wordmark only (no icon) from the brand lockup, re-framed to its own bounds.
async function buildWordmark(container) {
  const raw = await (await fetch(LOCKUP)).text();
  container.innerHTML = raw;
  const svg = container.querySelector('svg');
  const icon = svg.querySelector('g');
  icon.remove();
  const path = svg.querySelector('path');
  path.setAttribute('stroke', '#fff');
  path.setAttribute('stroke-width', '1.6');
  const wrap = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  path.replaceWith(wrap);
  wrap.appendChild(path);
  const b = wrap.getBBox();
  svg.setAttribute('viewBox', `${b.x - 4} ${b.y - 4} ${b.width + 8} ${b.height + 8}`);
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  return { svg, path };
}
