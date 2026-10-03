// Builds every scene's DOM and one master GSAP timeline, synced to the
// ElevenLabs word timestamps in audio/timing.json.

const ICON = 'assets/Lumademy_Icon_White.svg';
const LOCKUP = 'assets/Lumademy_All_White.svg';
const CLAUDE = 'assets/claude.svg';
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
function splitChars(node) {
  node.innerHTML = [...node.textContent].map((c) => (c === ' ' ? ' ' : `<span class="c">${c}</span>`)).join('');
  return [...node.querySelectorAll('.c')];
}
const rand = (i, k = 1) => {
  const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const I = {
  arrow: '<svg viewBox="0 0 24 24" class="ico"><path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  check: '<svg viewBox="0 0 24 24" class="ico"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  play: '<svg viewBox="0 0 24 24" class="ico"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>',
  spark: '<svg viewBox="0 0 24 24" class="ico"><path d="M12 1.5c.6 4.9 2.6 8.2 10.5 10.5C14.6 14.3 12.6 17.6 12 22.5 11.4 17.6 9.4 14.3 1.5 12 9.4 9.7 11.4 6.4 12 1.5Z" fill="currentColor"/></svg>',
  trophy: '<svg viewBox="0 0 48 48" class="ico"><path d="M15 6h18v10a9 9 0 0 1-18 0zM15 10H8v3a7 7 0 0 0 7 7M33 10h7v3a7 7 0 0 1-7 7M24 25v8M16 42h16M19 33h10l1 9H18z" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linejoin="round" stroke-linecap="round"/></svg>',
  book: '<svg viewBox="0 0 48 48" class="ico"><path d="M6 9c7-2 13-1 18 3 5-4 11-5 18-3v29c-7-2-13-1-18 3-5-4-11-5-18-3zM24 12v29" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linejoin="round"/></svg>',
  wand: '<svg viewBox="0 0 48 48" class="ico"><path d="M8 40 30 18M27 9v6M21 12h6M39 21v6M36 24h6M36 6v4M34 8h4" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/><path d="m27 15 6 6" stroke="currentColor" stroke-width="7" stroke-linecap="round"/></svg>',
  loop: '<svg viewBox="0 0 48 48" class="ico"><path d="M38 20a15 15 0 0 0-27-5M10 28a15 15 0 0 0 27 5M11 6v9h9M37 42v-9h-9" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  lock: '<svg viewBox="0 0 64 64" class="lock"><path class="shackle" d="M20 30V20a12 12 0 0 1 24 0v10" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/><rect x="12" y="28" width="40" height="30" rx="8" fill="currentColor"/><circle cx="32" cy="41" r="4" fill="#2970EC"/><path d="M32 44v6" stroke="#2970EC" stroke-width="4" stroke-linecap="round"/></svg>',
  user: '<svg viewBox="0 0 48 48" class="ico"><circle cx="24" cy="17" r="8" fill="currentColor"/><path d="M8 42c2-9 8-13 16-13s14 4 16 13z" fill="currentColor"/></svg>',
};

export async function buildTimeline({ timing, world, scenesRoot, fxRoot }) {
  const S = Object.fromEntries(timing.segments.map((s) => [s.id, s]));
  const w = (id, i) => S[id].words[i].start;
  const END = timing.duration + 2.4;

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
  const reveal = (words, id, offset = 0, extra = {}) =>
    words.forEach((wd, i) => tl.fromTo(wd, { yPercent: 130, opacity: 0, ...extra.from }, { yPercent: 0, opacity: 1, duration: 0.42, ...extra.to }, w(id, offset + i) - 0.03));

  // ---------- confetti (deterministic, driven by time) ----------
  const confettiLayer = el('<div class="confetti"></div>');
  fxRoot.prepend(confettiLayer);
  const COLORS = ['#ffffff', '#5DAEFF', '#2970EC', '#BFE2FF', '#D97757', '#ffffff'];
  const bits = Array.from({ length: 90 }, (_, i) => {
    const b = el(`<i style="background:${COLORS[i % COLORS.length]}"></i>`);
    confettiLayer.appendChild(b);
    return b;
  });
  const bursts = [];
  const confetti = (t, x = 960, y = 540, power = 1) => bursts.push({ t, x, y, power });
  onFrame((t) => {
    const b = bursts.filter((x) => x.t <= t && t - x.t < 2.6).at(-1);
    bits.forEach((bit, i) => {
      if (!b) return (bit.style.opacity = 0);
      const dt = t - b.t;
      const a = rand(i, 1) * Math.PI * 2;
      const v = (500 + rand(i, 2) * 1100) * b.power;
      const x = b.x + Math.cos(a) * v * dt * Math.exp(-dt * 1.6);
      const y = b.y + Math.sin(a) * v * dt * Math.exp(-dt * 1.6) + 520 * dt * dt;
      bit.style.opacity = Math.max(0, 1 - dt / 2.6);
      bit.style.transform = `translate(${x}px, ${y}px) rotate(${dt * (300 + rand(i, 3) * 900)}deg) scale(${0.6 + rand(i, 4)})`;
    });
  });

  // ---------- initial world state ----------
  tl.set(BG.uNight, { value: 1 }, 0);
  tl.set([P.wSphere, P.wTen, P.wClaude, P.wRing], { value: 0 }, 0);
  tl.set(P.wScatter, { value: 1 }, 0);
  tl.set(P.uJitter, { value: 0.04 }, 0);

  // ===========================================================================
  // 1. HOOK — "১০ জন পাবেন Claude Pro — একদম ফ্রি!"
  // ===========================================================================
  {
    const s = add(`
      <div class="scene s-hook">
        <div class="hk-sub bn">জন পাবেন</div>
        <div class="hk-title en"><span class="cl">Claude</span> <span class="pro">Pro</span><span class="acc mono">ACCOUNT</span></div>
        <div class="hk-free"><span class="bn">একদম</span><b class="bn">ফ্রি!</b></div>
      </div>`);
    const end = S.how.start;
    show(s, 0, end);

    // particles rush into a giant "10"
    tl.fromTo(P.uOpacity, { value: 0 }, { value: 1, duration: 0.25 }, 0);
    tl.to(P.wScatter, { value: 0, duration: 0.55, ease: 'expo.out' }, 0);
    tl.to(P.wTen, { value: 1, duration: 0.55, ease: 'expo.out' }, 0);
    tl.fromTo(P.uSize, { value: 3.2 }, { value: 3.6, duration: 0.3 }, 0);
    flash(0.02, 0.5, 0.35);
    shake(0.05, 1);
    cue(0, 'impact', 1);
    cue(0, 'whoosh', 0.6);

    const sub = q(s, '.hk-sub');
    tl.fromTo(sub, { y: 40, opacity: 0, letterSpacing: '0.3em' }, { y: 0, opacity: 1, letterSpacing: '0em', duration: 0.45 }, w('hook', 1) - 0.05);

    // "10" turns into the Claude mark — and the real 3D mark lands
    const tC = w('hook', 2);
    tl.to(P.wTen, { value: 0, duration: 0.35, ease: 'power3.inOut' }, tC - 0.2);
    tl.to(P.wClaude, { value: 1, duration: 0.35, ease: 'power3.inOut' }, tC - 0.2);
    tl.to(P.uWarm, { value: 1, duration: 0.3 }, tC - 0.2);
    tl.to(BG.uWarm, { value: 1, duration: 0.5 }, tC - 0.2);
    tl.fromTo(st, { claude: 0 }, { claude: 1, duration: 0.7, ease: 'back.out(1.6)' }, tC + 0.1);
    tl.fromTo(st, { claudeSpin: -Math.PI * 2 }, { claudeSpin: 0, duration: 1.1, ease: 'expo.out' }, tC + 0.1);
    tl.to(P.uOpacity, { value: 0.55, duration: 0.4 }, tC + 0.15);
    tl.to(sub, { y: -30, opacity: 0, duration: 0.25, ease: 'power2.in' }, tC - 0.25);
    const title = q(s, '.hk-title');
    tl.fromTo(q(s, '.cl'), { x: -120, opacity: 0, filter: 'blur(14px)' }, { x: 0, opacity: 1, filter: 'blur(0px)', duration: 0.45 }, tC);
    tl.fromTo(q(s, '.pro'), { scale: 2.2, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.4, ease: 'back.out(2.4)' }, w('hook', 3));
    flash(tC + 0.1, 0.4, 0.3);
    cue(tC, 'riser', 0.4);
    cue(tC + 0.1, 'shimmer', 0.8);
    cue(w('hook', 3), 'impact', 0.7);
    shake(w('hook', 3), 0.6);

    // ring of ten marks + particles form an orbit
    // "অ্যাকাউন্ট"
    const tAcc = w('hook', 4);
    tl.fromTo(q(s, '.acc'), { opacity: 0, letterSpacing: '1.1em', y: 10 }, { opacity: 1, letterSpacing: '0.6em', y: 0, duration: 0.5 }, tAcc - 0.05);
    cue(tAcc, 'tick', 0.8);

    const tO = w('hook', 5);
    tl.fromTo(st, { orbit: 0 }, { orbit: 1, duration: 0.5, ease: 'none' }, tO - 0.15);
    tl.fromTo(st, { orbitSpin: 0 }, { orbitSpin: Math.PI * 1.2, duration: 1.4, ease: 'expo.out' }, tO - 0.15);
    tl.to(P.wClaude, { value: 0, duration: 0.5 }, tO - 0.1);
    tl.to(P.wRing, { value: 1, duration: 0.5 }, tO - 0.1);
    tl.to(title, { y: 120, scale: 0.55, duration: 0.4, ease: 'power3.inOut' }, tO - 0.15);
    for (let i = 0; i < 10; i++) cue(tO - 0.15 + i * 0.05, 'pop', 0.35);

    // FREE stamp
    const tF = w('hook', 6);
    const free = q(s, '.hk-free');
    tl.fromTo(q(free, 'span'), { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3 }, tO);
    tl.fromTo(q(free, 'b'), { scale: 3.2, rotate: -22, opacity: 0 }, { scale: 1, rotate: -8, opacity: 1, duration: 0.35, ease: 'back.out(1.8)' }, tF - 0.05);
    flash(tF, 0.6, 0.35);
    shake(tF, 1.6, 0.6);
    confetti(tF, 960, 520, 1.1);
    cue(tF, 'impact', 1.1);
    cue(tF, 'shimmer', 0.6);

    // exit
    tl.to(s.children, { scale: 0.7, opacity: 0, filter: 'blur(12px)', duration: 0.22, ease: 'power3.in' }, end - 0.22);
    tl.to(st, { claude: 0, orbit: 0, duration: 0.22, ease: 'power3.in' }, end - 0.22);
    tl.to(P.uOpacity, { value: 0, duration: 0.2 }, end - 0.2);
    tl.to(BG.uWarm, { value: 0, duration: 0.2 }, end - 0.2);
  }

  // ===========================================================================
  // 2. HOW — "কীভাবে?"
  // ===========================================================================
  {
    const s = add(`
      <div class="scene s-how">
        <div class="hw-q en">?</div>
        <div class="hw-text bn">কীভাবে<b>?</b></div>
      </div>`);
    const t = S.how.start;
    const end = S.enroll.start;
    // The white lives in the DOM here, so the dark stage of the next scene can
    // already sit underneath in WebGL and be revealed by an iris.
    tl.set(BG.uWhite, { value: 0 }, t);
    tl.set(BG.uNight, { value: 1 }, t);
    tl.set(P.uWarm, { value: 0 }, t);
    flash(t, 0.9, 0.3);
    cue(t, 'whoosh', 0.8);
    cue(t + 0.05, 'glitch', 0.5);
    const bigQ = q(s, '.hw-q');
    const text = q(s, '.hw-text');
    tl.fromTo(bigQ, { scale: 0.3, rotate: -60, opacity: 0 }, { scale: 1, rotate: 12, opacity: 1, duration: 0.7 }, t);
    tl.fromTo(text, { scale: 1.8, opacity: 0, filter: 'blur(20px)' }, { scale: 1, opacity: 1, filter: 'blur(0px)', duration: 0.4 }, t);

    // iris out: the white screen collapses into the "?" and reveals the dark stage
    const qm = q(text, 'b');
    const cx = qm.offsetLeft + qm.offsetWidth / 2;
    const cy = qm.offsetTop + qm.offsetHeight * 0.62;
    const tI = end - 0.5;
    text.style.transformOrigin = `${cx}px ${cy}px`;
    show(s, t, end + 0.03);
    tl.fromTo(s, { clipPath: `circle(115% at ${cx}px ${cy}px)` }, { clipPath: `circle(0% at ${cx}px ${cy}px)`, duration: 0.52, ease: 'power3.inOut', immediateRender: false }, tI);
    tl.to(text, { scale: 0.8, duration: 0.52, ease: 'power3.inOut' }, tI);
    tl.to(bigQ, { scale: 2.4, rotate: 40, opacity: 0, duration: 0.52, ease: 'power3.inOut' }, tI);
    cue(tI + 0.1, 'whoosh', 0.7);
  }

  // ===========================================================================
  // 3. ENROLL — course card → enroll → unlock → private community
  // ===========================================================================
  {
    const chans = ['welcome', 'ai-motion-lab', 'prompts', 'submissions', 'showcase'];
    const msgs = [
      ['Rafi', '#5DAEFF', 'প্রথম 3D logo reveal বানালাম 🔥'],
      ['Nusrat', '#F0A584', 'Prompt → video, মাত্র ৫ মিনিটে 🤯'],
      ['Tanvir', '#BFE2FF', 'আজ রাতেই submit করছি!'],
      ['Mentor · Lumademy', '#2970EC', 'Competition শুরু 🏆 সেরা ১০ জন পাবেন Claude Pro'],
    ];
    const s = add(`
      <div class="scene s-enroll">
        <div class="en-stage">
          <div class="pm-brand"><i class="hl l"></i><img src="${LOCKUP}" alt="Lumademy"><i class="hl r"></i></div>
          <div class="pm-eyebrow mono">CRASH COURSE</div>
          <h3 class="pm-title en">
            <span class="ln"><span class="pw">AI</span> <span class="pw">Motion</span> <span class="pw">Graphics</span></span>
            <span class="ln two"><span class="pw">Crash</span> <span class="pw">Course</span></span>
          </h3>
          <div class="pm-btn en">
            <span class="lbl">Enroll</span><span class="go">${I.arrow}</span>
            <svg class="chk" viewBox="0 0 24 24"><path d="M6 12.5l4 4L18 8" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <i class="touch"></i>
          </div>
          <div class="pm-access mono">ACCESS UNLOCKED</div>
        </div>
        <i class="pm-ring"></i>
        <div class="community">
          <div class="cm-head"><span class="bn">প্রাইভেট ডিসকর্ড কমিউনিটি</span></div>
          <div class="cm-win">
            <div class="cm-rail"><img src="${ICON}" alt=""><i></i><i></i></div>
            <div class="cm-side">
              <div class="cm-server en">Lumademy Creators <span class="cm-lock mono">PRIVATE</span></div>
              ${chans.map((c, i) => `<div class="cm-chan en ${i === 1 ? 'on' : ''}"># ${c}</div>`).join('')}
              <div class="cm-chan en trophy">🏆 competition</div>
            </div>
            <div class="cm-main">
              <div class="cm-title en"># ai-motion-lab</div>
              ${msgs.map(([n, c, m]) => `<div class="msg"><b style="background:${c}"></b><div><strong class="en">${n}</strong><p class="bn">${m}</p></div></div>`).join('')}
              <div class="cm-typing en"><i></i><i></i><i></i> 12 people are typing…</div>
            </div>
          </div>
        </div>
      </div>`);
    const start = S.enroll.start;
    const end = S.make.start;
    show(s, start, end);
    tl.set(BG.uWhite, { value: 0 }, start);
    tl.set(BG.uNight, { value: 1 }, start);
    tl.to(P.uOpacity, { value: 0.14, duration: 0.8 }, start);
    tl.set(P.wRing, { value: 0 }, start);
    tl.set(P.wScatter, { value: 1 }, start);
    tl.set(P.uJitter, { value: 0.35 }, start);

    // brand mark + hairlines
    const brand = q(s, '.pm-brand');
    tl.fromTo(q(brand, 'img'), { opacity: 0, y: 14, filter: 'blur(8px)' }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: 0.8, ease: 'power3.out' }, start);
    tl.fromTo(qa(brand, '.hl'), { scaleX: 0 }, { scaleX: 1, duration: 1.1, ease: 'expo.inOut' }, start + 0.1);

    // title, word by word — masked, slow-settling
    const words = qa(s, '.pw');
    words.forEach((wd, i) => {
      const t = w('enroll', 1 + i) - 0.05;
      tl.fromTo(wd, { yPercent: 105, opacity: 0, filter: 'blur(10px)' }, { yPercent: 0, opacity: 1, filter: 'blur(0px)', duration: 0.7, ease: 'expo.out' }, t);
      cue(t + 0.03, 'tick', 0.35);
    });
    tl.fromTo(q(s, '.pm-eyebrow'), { opacity: 0, letterSpacing: '0.9em' }, { opacity: 1, letterSpacing: '0.5em', duration: 1.0, ease: 'expo.out' }, w('enroll', 4) - 0.05);
    // a single light sweep across the finished title
    tl.fromTo(q(s, '.pm-title'), { '--sweep': '-30%' }, { '--sweep': '130%', duration: 1.0, ease: 'power2.inOut' }, w('enroll', 5) + 0.15);

    // the button: press → morph into a circle → check
    const btn = q(s, '.pm-btn');
    const tE = w('enroll', 6);
    tl.fromTo(btn, { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: 'power3.out' }, w('enroll', 5) + 0.05);
    tl.fromTo(q(btn, '.touch'), { scale: 1.8, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.25, ease: 'power2.out' }, tE - 0.25);
    tl.to(q(btn, '.touch'), { scale: 0.6, opacity: 0, duration: 0.3, ease: 'power2.in' }, tE + 0.02);
    tl.to(btn, { keyframes: [{ scale: 0.95, duration: 0.08, ease: 'power2.out' }, { scale: 1, duration: 0.4, ease: 'expo.out' }] }, tE);
    cue(tE, 'click', 0.7);
    const tM = w('enroll', 7) - 0.12;
    tl.to(qa(btn, '.lbl, .go'), { opacity: 0, duration: 0.18, ease: 'power2.in' }, tM);
    tl.fromTo(btn, { width: 300, backgroundColor: '#ffffff' }, { width: 96, backgroundColor: '#2970EC', duration: 0.55, ease: 'expo.inOut' }, tM + 0.05);
    tl.fromTo(q(btn, '.chk path'), { drawSVG: '0%' }, { drawSVG: '100%', duration: 0.4, ease: 'power2.out' }, tM + 0.5);
    cue(tM + 0.5, 'shimmer', 0.5);

    // access: a hairline ring expands from the check, the stage recedes
    const tA = w('enroll', 8) - 0.05;
    const ring = q(s, '.pm-ring');
    tl.fromTo(ring, { scale: 0.2, opacity: 0 }, { keyframes: [{ scale: 1, opacity: 1, duration: 0.05 }, { scale: 26, opacity: 0, duration: 1.1, ease: 'expo.out' }] }, tA);
    tl.to([brand, q(s, '.pm-eyebrow'), q(s, '.pm-title')], { opacity: 0, y: -50, filter: 'blur(8px)', duration: 0.6, ease: 'power3.inOut', stagger: 0.04 }, tA);
    tl.to(btn, { y: -220, scale: 1.15, duration: 0.7, ease: 'expo.inOut' }, tA);
    tl.fromTo(q(s, '.pm-access'), { opacity: 0, letterSpacing: '1em' }, { opacity: 1, letterSpacing: '0.55em', duration: 0.8, ease: 'expo.out' }, tA + 0.2);
    cue(tA, 'whoosh', 0.6);

    // the community opens
    const tC = w('enroll', 10) - 0.1;
    const stage = q(s, '.en-stage');
    const comm = q(s, '.community');
    tl.to(stage, { scale: 1.6, opacity: 0, filter: 'blur(14px)', duration: 0.35, ease: 'power3.in' }, tC - 0.15);
    tl.fromTo(comm, { opacity: 0 }, { opacity: 1, duration: 0.01 }, tC + 0.1);
    tl.fromTo(q(s, '.cm-win'), { scale: 0.6, rotateX: 35, y: 200 }, { scale: 1, rotateX: 0, y: 0, duration: 0.6 }, tC + 0.1);
    flash(tC + 0.15, 0.35, 0.3);
    cue(tC + 0.1, 'whoosh', 0.8);
    const head = splitWords(q(s, '.cm-head .bn'));
    head.forEach((wd, i) => tl.fromTo(wd, { yPercent: 130, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.4 }, [w('enroll', 11), w('enroll', 12), w('enroll', 13)][i] - 0.05));
    tl.fromTo(q(s, '.cm-lock'), { scale: 0 }, { scale: 1, duration: 0.35, ease: 'back.out(3)' }, w('enroll', 11));
    tl.fromTo(qa(s, '.cm-chan'), { x: -40, opacity: 0 }, { x: 0, opacity: 1, duration: 0.3, stagger: 0.05 }, tC + 0.3);
    const m = qa(s, '.msg');
    m.forEach((x, i) => {
      const t = w('enroll', 12) + i * 0.22;
      tl.fromTo(x, { y: 40, opacity: 0, scale: 0.9 }, { y: 0, opacity: 1, scale: 1, duration: 0.35, ease: 'back.out(1.6)' }, t);
      cue(t, 'pop', 0.5);
    });
    tl.fromTo(q(s, '.cm-typing'), { opacity: 0 }, { opacity: 1, duration: 0.3 }, w('enroll', 13) + 0.4);
    tl.to(comm, { y: -200, opacity: 0, scale: 0.9, duration: 0.3, ease: 'power3.in' }, end - 0.3);
  }

  // ===========================================================================
  // 4. MAKE — build your best video with AI, submit to the competition
  // ===========================================================================
  {
    const s = add(`
      <div class="scene s-make">
        <div class="mk-head bn">সেখানে এআই দিয়ে বানাবেন</div>
        <div class="mk-prompt en">${I.spark}<span class="typed"></span><i class="caret"></i></div>
        <div class="mk-frame">
          <div class="mk-render">
            <div class="mk-art"><i></i><i></i><i></i><img src="${ICON}" alt=""><b class="en">MY BEST WORK</b></div>
            <div class="mk-scan"></div>
          </div>
          <div class="mk-bar"><i></i><span class="mono pct">0%</span></div>
          <div class="mk-best bn">সেরা ★</div>
          <div class="mk-label en">Motion Graphics · 1080p · 60fps</div>
        </div>
        <div class="mk-submit en"><span>Submit</span>${I.arrow}</div>
        <div class="comp">
          <div class="comp-ico">${I.trophy}</div>
          <div class="comp-txt"><b class="bn">কম্পিটিশন</b><span class="mono">ENTRY #0427 · SUBMITTED</span></div>
          <div class="comp-ok">${I.check}</div>
        </div>
      </div>`);
    const start = S.make.start;
    const end = S.win.start;
    show(s, start, end);
    tl.set(BG.uNight, { value: 1 }, start);
    tl.to(P.uOpacity, { value: 0.3, duration: 0.4 }, start);
    cue(start, 'whoosh', 0.6);

    const head = splitWords(q(s, '.mk-head'));
    reveal(head, 'make');
    const prompt = q(s, '.mk-prompt');
    tl.fromTo(prompt, { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4 }, start + 0.1);
    const text = 'Epic 3D logo reveal, glowing particles, bold kinetic type';
    const typed = q(s, '.typed');
    const tc = { n: 0 };
    tl.fromTo(tc, { n: 0 }, { n: text.length, duration: 1.0, ease: 'none', onUpdate: () => (typed.textContent = text.slice(0, Math.round(tc.n))) }, start + 0.2);
    for (let i = 0; i < 10; i++) cue(start + 0.2 + i * 0.1, 'tick', 0.45);

    // frame renders top-to-bottom
    const frame = q(s, '.mk-frame');
    const tR = w('make', 3);
    tl.fromTo(frame, { y: 120, opacity: 0, scale: 0.9 }, { y: 0, opacity: 1, scale: 1, duration: 0.5 }, tR - 0.2);
    const pc = { v: 0 };
    const pct = q(s, '.pct');
    const rDur = w('make', 8) - tR + 0.1;
    tl.fromTo(q(s, '.mk-render'), { clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0% 0)', duration: rDur, ease: 'power1.inOut' }, tR);
    tl.fromTo(q(s, '.mk-scan'), { top: '0%' }, { top: '100%', duration: rDur, ease: 'power1.inOut' }, tR);
    tl.fromTo(q(s, '.mk-bar i'), { scaleX: 0 }, { scaleX: 1, duration: rDur, ease: 'power1.inOut' }, tR);
    tl.fromTo(pc, { v: 0 }, { v: 100, duration: rDur, ease: 'power1.inOut', onUpdate: () => (pct.textContent = Math.round(pc.v) + '%') }, tR);
    tl.to(q(s, '.mk-scan'), { opacity: 0, duration: 0.2 }, tR + rDur);
    tl.fromTo(q(s, '.mk-best'), { scale: 0, rotate: -30 }, { scale: 1, rotate: 8, duration: 0.45, ease: 'back.out(2.5)' }, w('make', 5));
    cue(w('make', 5), 'pop', 0.9);
    tl.fromTo(q(s, '.mk-label'), { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.3 }, w('make', 8));
    cue(w('make', 8), 'shimmer', 0.5);
    const art = qa(s, '.mk-art i');
    const artImg = q(s, '.mk-art img');
    onFrame((t) => {
      if (t < start || t > end) return;
      art.forEach((a, i) => (a.style.transform = `translate(${Math.sin(t * (0.9 + i * 0.5) + i * 2) * 120}px, ${Math.cos(t * (0.7 + i * 0.4) + i) * 60}px) scale(${1 + Math.sin(t * 2 + i) * 0.15})`));
      artImg.style.transform = `rotate(${Math.sin(t * 1.5) * 8}deg) scale(${1 + Math.sin(t * 3) * 0.04})`;
    });

    // submit → flies into the competition
    const tS = w('make', 10);
    const sub = q(s, '.mk-submit');
    tl.to([q(s, '.mk-head'), prompt], { y: -40, opacity: 0, duration: 0.3, ease: 'power2.in' }, w('make', 9) - 0.2);
    tl.fromTo(sub, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35, ease: 'back.out(2)' }, w('make', 9) - 0.1);
    tl.to(sub, { keyframes: [{ scale: 0.88, duration: 0.06 }, { scale: 1.08, duration: 0.15 }, { scale: 0, opacity: 0, duration: 0.2 }] }, tS);
    cue(tS, 'click', 1);
    const comp = q(s, '.comp');
    tl.to(frame, { y: -60, scale: 0.08, rotate: 20, opacity: 0, duration: 0.4, ease: 'power3.in' }, tS + 0.1);
    tl.fromTo(comp, { scale: 0.2, opacity: 0, rotate: -12 }, { scale: 1, opacity: 1, rotate: 0, duration: 0.5, ease: 'back.out(1.7)' }, tS + 0.42);
    cue(tS + 0.15, 'whoosh', 0.9);
    const tK = w('make', 12);
    tl.to(comp, { keyframes: [{ scale: 1.12, duration: 0.1 }, { scale: 1, duration: 0.3, ease: 'back.out(3)' }] }, tK - 0.05);
    tl.fromTo(q(s, '.comp-ok'), { scale: 0 }, { scale: 1, duration: 0.35, ease: 'back.out(3)' }, tK);
    tl.fromTo(q(s, '.comp-txt .mono'), { opacity: 0 }, { opacity: 1, duration: 0.3 }, tK);
    confetti(tK + 0.05, 960, 540, 0.8);
    shake(tK, 0.8);
    cue(tK, 'impact', 0.8);
    tl.to(comp, { scale: 0.6, opacity: 0, duration: 0.25, ease: 'power3.in' }, end - 0.25);
  }

  // ===========================================================================
  // 5. WIN — best 10 videos → each creator wins Claude Pro
  // ===========================================================================
  {
    const tiles = Array.from({ length: 20 }, (_, i) => `
      <div class="tile g${i % 6}" data-i="${i}">
        <i class="shape"></i><span class="pl">${I.play}</span>
        <b class="rank mono"></b>
        <span class="who">${I.user}</span>
        <img class="prize" src="${CLAUDE}" alt="">
      </div>`).join('');
    const s = add(`
      <div class="scene s-win">
        <div class="wn-head bn">সবচেয়ে ভালো <b>১০টি</b> ভিডিওর ক্রিয়েটর</div>
        <div class="wn-grid">${tiles}</div>
        <div class="wn-prize">
          <div class="wn-x en">Claude Pro <span>× ১০</span></div>
          <div class="wn-sub bn">প্রত্যেকে জিতবেন একটি করে Claude Pro অ্যাকাউন্ট</div>
        </div>
      </div>`);
    const start = S.win.start;
    const end = S.more.start;
    show(s, start, end);
    tl.set(BG.uNight, { value: 0 }, start);
    flash(start, 0.45, 0.3);
    cue(start, 'whoosh', 0.7);

    const head = q(s, '.wn-head');
    tl.fromTo(head, { y: -60, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45 }, start);
    const tiles$ = qa(s, '.tile');
    // a deterministic "best 10"
    const top = [1, 3, 4, 6, 8, 10, 12, 15, 17, 18];
    tl.fromTo(tiles$, { scale: 0, rotate: (i) => (rand(i) - 0.5) * 40 }, { scale: 1, rotate: 0, duration: 0.45, stagger: { each: 0.025, from: 'random' }, ease: 'back.out(1.8)' }, start + 0.05);
    for (let i = 0; i < 8; i++) cue(start + 0.05 + i * 0.06, 'tick', 0.6);

    const tTen = w('win', 2);
    const losers = tiles$.filter((_, i) => !top.includes(i));
    const winners = top.map((i) => tiles$[i]);
    tl.to(losers, { opacity: 0.18, scale: 0.86, filter: 'grayscale(1) blur(2px)', duration: 0.35 }, tTen - 0.05);
    tl.to(winners, { boxShadow: '0 0 0 6px #fff, 0 20px 50px rgba(3,20,70,.5)', duration: 0.3 }, tTen - 0.05);
    tl.fromTo(q(head, 'b'), { color: '#ffffff' }, { color: '#BFE2FF', scale: 1.15, duration: 0.3 }, tTen);
    winners.forEach((tile, k) => {
      const r = q(tile, '.rank');
      r.textContent = '#' + (k + 1);
      tl.fromTo(r, { scale: 0 }, { scale: 1, duration: 0.3, ease: 'back.out(3)' }, tTen + k * 0.045);
      tl.fromTo(q(tile, '.who'), { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3 }, w('win', 4) + k * 0.03);
      tl.fromTo(q(tile, '.prize'), { scale: 0, rotate: -180, y: -200 }, { scale: 1, rotate: 0, y: 0, duration: 0.45, ease: 'back.out(2)' }, w('win', 5) + k * 0.05);
      cue(w('win', 5) + k * 0.05, 'pop', 0.45);
    });
    cue(tTen, 'impact', 0.7);

    // the prize: big 3D Claude mark with an orbit of ten
    const tP = w('win', 9);
    tl.to(BG.uWarm, { value: 0.8, duration: 0.4 }, tP - 0.3);
    tl.to([head, q(s, '.wn-grid')], { scale: 0.6, opacity: 0, filter: 'blur(10px)', duration: 0.3, ease: 'power3.in' }, tP - 0.3);
    tl.fromTo(st, { claude: 0 }, { claude: 1, duration: 0.6, ease: 'back.out(1.6)' }, tP - 0.05);
    tl.fromTo(st, { claudeSpin: Math.PI * 2 }, { claudeSpin: 0, duration: 1.0, ease: 'expo.out' }, tP - 0.05);
    tl.set(st, { claudeY: 1.9 }, tP - 0.05);
    tl.set(st, { orbitY: 1.9, orbitTilt: 0.3, orbitR: 5 }, tP - 0.05);
    tl.fromTo(st, { orbit: 0 }, { orbit: 1, duration: 0.45, ease: 'none' }, tP + 0.05);
    flash(tP, 0.6, 0.4);
    shake(tP, 1.2);
    cue(tP, 'impact', 1);
    cue(tP, 'shimmer', 0.9);
    const prize = q(s, '.wn-prize');
    tl.fromTo(q(prize, '.wn-x'), { scale: 1.6, opacity: 0, filter: 'blur(16px)' }, { scale: 1, opacity: 1, filter: 'blur(0px)', duration: 0.4 }, w('win', 10));
    tl.fromTo(q(prize, '.wn-sub'), { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4 }, w('win', 11));
    tl.to(P.uWarm, { value: 1, duration: 0.3 }, tP);
    tl.to(P.uOpacity, { value: 0.6, duration: 0.3 }, tP);
    tl.to(P.uExplode, { keyframes: [{ value: 2, duration: 0.5, ease: 'expo.out' }, { value: 0, duration: 0.8, ease: 'power2.inOut' }] }, tP);
    confetti(tP + 0.05, 960, 420, 1);
    tl.to(prize, { opacity: 0, y: 40, duration: 0.25, ease: 'power2.in' }, end - 0.25);
    tl.to(st, { orbit: 0, duration: 0.25, ease: 'power3.in' }, end - 0.25);
  }

  // ===========================================================================
  // 6. MORE — Claude Pro → many more high-quality videos; 1 account → 20+
  // ===========================================================================
  {
    const reel = Array.from({ length: 7 }, (_, i) => `<div class="rc g${i % 6}"><i class="shape"></i><span class="pl">${I.play}</span><em class="mono">4K · 60FPS</em></div>`).join('');
    const grid = Array.from({ length: 48 }, (_, i) => `<div class="gt g${(i * 5) % 6}"><i class="shape"></i></div>`).join('');
    const s = add(`
      <div class="scene s-more">
        <div class="mo-head bn">আরও অনেক <b>হাই-কোয়ালিটি</b> মোশন গ্রাফিক্স ভিডিও</div>
        <div class="mo-reel">${reel}</div>
        <div class="mo-grid">${grid}</div>
        <div class="mo-acc">
          <img src="${CLAUDE}" alt="">
          <div><span class="mono">১টি অ্যাকাউন্ট</span><b class="en">Claude Pro</b></div>
        </div>
        <div class="mo-count"><b class="bn n">১</b><span class="bn">ভিডিও</span></div>
        <div class="mo-stamp bn">৪০–৫০টা ভিডিও সম্ভব!</div>
      </div>`);
    const start = S.more.start;
    const end = S.learn.start;
    show(s, start, end);
    tl.set(BG.uNight, { value: 1 }, start);
    tl.to(BG.uWarm, { value: 0.35, duration: 0.4 }, start);
    tl.to(P.uWarm, { value: 0, duration: 0.4 }, start);
    tl.to(P.uOpacity, { value: 0.3, duration: 0.4 }, start);

    // Claude mark glides to the left and "produces" videos
    tl.to(st, { claudeX: -6.4, claudeY: 0.3, claude: 0.85, duration: 0.6, ease: 'power3.inOut' }, start - 0.05);
    const head = splitWords(q(s, '.mo-head'));
    head.forEach((wd, i) => tl.fromTo(wd, { yPercent: 130, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.4 }, w('more', 7 + i) - 0.05));
    const cards = qa(s, '.rc');
    const tStart = w('more', 5);
    cards.forEach((c, i) => {
      const t = tStart + i * ((w('more', 12) - tStart) / cards.length);
      tl.fromTo(c, { x: -560, y: 0, scale: 0.2, rotateY: 70, opacity: 0 }, { x: 0, scale: 1, rotateY: 0, opacity: 1, duration: 0.5 }, t);
      cue(t, 'pop', 0.4);
    });
    // reel scrolls like a carousel
    const reelEl = q(s, '.mo-reel');
    onFrame((t) => {
      if (t < start || t > end) return;
      const k = Math.max(0, t - tStart);
      reelEl.style.transform = `translateX(${-k * 70}px)`;
    });
    tl.fromTo(qa(s, '.rc em'), { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.3, stagger: 0.04 }, w('more', 9));
    cue(w('more', 9), 'shimmer', 0.6);

    // one account → 20+
    const tA = w('more2', 0);
    tl.to([q(s, '.mo-head'), reelEl], { opacity: 0, y: -60, duration: 0.3, ease: 'power2.in' }, tA - 0.35);
    tl.to(st, { claude: 0, duration: 0.3, ease: 'power3.in' }, tA - 0.35);
    const acc = q(s, '.mo-acc');
    tl.fromTo(acc, { scale: 0.4, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.45, ease: 'back.out(1.8)' }, tA - 0.1);
    cue(tA, 'whoosh', 0.7);
    const count = q(s, '.mo-count');
    const nEl = q(count, '.n');
    tl.fromTo(count, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.3 }, w('more2', 2));
    const gts = qa(s, '.gt');
    const tB = w('more2', 3);
    const grow = w('more2', 9) - tB;
    tl.to(acc, { scale: 0.78, y: -40, duration: 0.4, ease: 'power3.inOut' }, tB - 0.2);
    tl.fromTo(gts, { scale: 0, opacity: 0, x: 0, y: 0 }, { scale: 1, opacity: 0.8, duration: 0.35, ease: 'back.out(2)', stagger: { each: grow / gts.length, from: 'center', grid: [6, 8] } }, tB);
    const cnt = { v: 1 };
    const setN = () => (nEl.textContent = bnNum(Math.round(cnt.v)));
    // "চল্লিশ থেকে" → rolls to ৪০, "পঞ্চাশটা" → on to ৫০
    tl.fromTo(cnt, { v: 1 }, { v: 40, duration: w('more2', 4) - tB + 0.2, ease: 'power2.in', onUpdate: setN }, tB);
    tl.to(cnt, { v: 50, duration: 0.5, ease: 'power3.out', onUpdate: setN }, w('more2', 5));
    cue(w('more2', 5), 'pop', 0.8);
    for (let i = 0; i < 12; i++) cue(tB + grow * Math.sqrt(i / 12), 'tick', 0.7);
    const tStamp = w('more2', 9);
    const stamp = q(s, '.mo-stamp');
    tl.fromTo(stamp, { scale: 3, rotate: 14, opacity: 0 }, { scale: 1, rotate: -6, opacity: 1, duration: 0.35, ease: 'back.out(1.6)' }, tStamp);
    tl.to(count, { opacity: 0, duration: 0.2 }, tStamp);
    flash(tStamp, 0.45, 0.35);
    shake(tStamp, 1.3);
    cue(tStamp, 'impact', 1);
    confetti(tStamp + 0.02, 960, 600, 0.9);
    tl.to(BG.uWarm, { value: 0, duration: 0.3 }, end - 0.3);
    tl.to([...s.children], { scale: 1.3, opacity: 0, filter: 'blur(12px)', duration: 0.28, ease: 'power3.in' }, end - 0.28);
    tl.set(st, { claudeX: 0, claudeY: 0 }, end);
  }

  // ===========================================================================
  // 7. LOOP — শিখবেন → বানাবেন → জিতবেন → আরও বানাবেন
  // ===========================================================================
  {
    const nodes = [
      ['শিখবেন', 'LEARN', I.book],
      ['বানাবেন', 'BUILD', I.wand],
      ['জিতবেন', 'WIN', I.trophy],
      ['আরও বানাবেন', 'BUILD MORE', I.loop],
    ];
    const s = add(`
      <div class="scene s-loop">
        <div class="lp-mane bn">মানে,</div>
        <div class="lp-ring">
          <svg class="lp-arc" viewBox="0 0 700 700"><circle cx="350" cy="350" r="335"/></svg>
          ${nodes.map(([bn, en, ico], i) => `<div class="lp-node n${i}"><div class="dot">${ico}</div><span class="en mono">${String(i + 1).padStart(2, '0')} · ${en}</span></div>`).join('')}
          <div class="lp-center">${nodes.map(([bn]) => `<div class="lp-word bn">${bn}</div>`).join('')}</div>
          <div class="lp-step bn"></div>
        </div>
      </div>`);
    const start = S.learn.start;
    const end = S.question.start;
    show(s, start, end);
    tl.set(BG.uNight, { value: 0 }, start);
    flash(start, 0.7, 0.35);
    cue(start, 'whoosh', 0.7);
    tl.set(P.wScatter, { value: 0 }, start);
    tl.set(P.wRing, { value: 1 }, start);
    tl.set(P.uJitter, { value: 0.04 }, start);
    tl.set(P.uWarm, { value: 0 }, start);
    tl.to(P.uOpacity, { value: 0.85, duration: 0.4 }, start);
    tl.fromTo(P.uSpin, { value: 0 }, { value: 2.2, duration: S.again.start - start, ease: 'none' }, start);
    tl.to(P.uSpin, { value: 9, duration: end - S.again.start, ease: 'power2.in' }, S.again.start);

    tl.fromTo(q(s, '.lp-mane'), { opacity: 0, scale: 1.4 }, { opacity: 1, scale: 1, duration: 0.3 }, start);
    tl.to(q(s, '.lp-mane'), { opacity: 0, y: -40, duration: 0.25 }, w('learn', 1) - 0.2);
    tl.fromTo(q(s, '.lp-ring'), { scale: 0.6, rotate: -40, opacity: 0 }, { scale: 1, rotate: 0, opacity: 1, duration: 0.6 }, start + 0.15);

    const beats = [w('learn', 2), w('build', 1), w('winloop', 1), w('again', 2)];
    const nodeEls = qa(s, '.lp-node');
    const words = qa(s, '.lp-word');
    tl.fromTo(nodeEls, { scale: 0 }, { scale: 1, duration: 0.4, stagger: 0.06, ease: 'back.out(2)' }, start + 0.3);
    const arc = q(s, '.lp-arc circle');
    tl.fromTo(arc, { drawSVG: '0% 0%' }, { drawSVG: '0% 0%', duration: 0.01 }, start);
    beats.forEach((t, i) => {
      const n = nodeEls[i];
      tl.to(n, { '--on': 1, duration: 0.01 }, t - 0.06);
      tl.fromTo(q(n, '.dot'), { scale: 1 }, { keyframes: [{ scale: 1.35, duration: 0.12 }, { scale: 1.12, duration: 0.3 }] }, t - 0.06);
      tl.fromTo(words[i], { scale: 1.8, opacity: 0, filter: 'blur(16px)' }, { scale: 1, opacity: 1, filter: 'blur(0px)', duration: 0.35 }, t - 0.06);
      if (i < 3) tl.to(words[i], { scale: 0.7, opacity: 0, duration: 0.18, ease: 'power2.in' }, beats[i + 1] - 0.24);
      tl.to(arc, { drawSVG: `0% ${(i + 1) * 25}%`, duration: 0.4, ease: 'power3.out' }, t - 0.06);
      cue(t - 0.04, 'impact', i === 2 ? 1 : 0.7);
      shake(t - 0.04, i === 2 ? 1.2 : 0.6);
      if (i === 2) {
        confetti(t, 960, 540, 0.8);
        tl.to(BG.uWarm, { keyframes: [{ value: 0.7, duration: 0.15 }, { value: 0, duration: 0.8 }] }, t - 0.05);
      }
    });
    // "আরও বানাবেন" → the loop spins up: it never ends
    const ring = q(s, '.lp-ring');
    tl.to(ring, { rotate: 360, duration: end - beats[3] - 0.05, ease: 'power2.in' }, beats[3] + 0.15);
    tl.to(q(s, '.lp-center'), { rotate: -360, duration: end - beats[3] - 0.05, ease: 'power2.in' }, beats[3] + 0.15);
    cue(beats[3] + 0.1, 'riser', 0.6);
    tl.to(ring, { scale: 2.6, opacity: 0, filter: 'blur(18px)', duration: 0.3, ease: 'power3.in' }, end - 0.3);
    tl.to(P.uOpacity, { value: 0, duration: 0.3 }, end - 0.3);
  }

  // ===========================================================================
  // 8. QUESTION — "সেই ১০ জনের একজন কি আপনি হবেন?"
  // ===========================================================================
  {
    const seats = Array.from({ length: 10 }, (_, i) => `<div class="seat ${i === 9 ? 'you' : ''}"><div class="av">${i === 9 ? '<b class="bn">?</b>' : I.user}</div><img class="sp" src="${CLAUDE}" alt=""></div>`).join('');
    const s = add(`
      <div class="scene s-question">
        <div class="qs-1 bn">এখন প্রশ্ন একটাই—</div>
        <div class="qs-seats">${seats}</div>
        <div class="qs-2 bn">সেই ১০ জনের একজন কি <b>আপনি</b> হবেন?</div>
      </div>`);
    const start = S.question.start;
    const end = S.cta.start;
    show(s, start, end);
    tl.set(BG.uNight, { value: 1 }, start);
    tl.set(BG.uGlow.value, { x: 0.5, y: 0.62 }, start);
    tl.set(P.wRing, { value: 0 }, start);
    tl.set(P.wScatter, { value: 1 }, start);
    tl.set(P.uSpin, { value: 0 }, start);
    tl.to(P.uOpacity, { value: 0.25, duration: 0.5 }, start);
    flash(start, 0.6, 0.35);
    cue(start, 'impact', 0.6);

    const q1 = splitWords(q(s, '.qs-1'));
    reveal(q1, 'question');
    tl.to(q(s, '.qs-1'), { y: -80, opacity: 0, scale: 0.8, duration: 0.3, ease: 'power2.in' }, w('question', 3) - 0.3);

    const seatEls = qa(s, '.seat');
    const tSeats = w('question', 3) - 0.15;
    tl.fromTo(seatEls, { y: 80, opacity: 0, scale: 0.6 }, { y: 0, opacity: 1, scale: 1, duration: 0.35, stagger: 0.04, ease: 'back.out(1.8)' }, tSeats);
    seatEls.slice(0, 9).forEach((x, i) => {
      tl.fromTo(q(x, '.sp'), { scale: 0 }, { scale: 1, duration: 0.25, ease: 'back.out(3)' }, w('question', 4) + i * 0.05);
      cue(w('question', 4) + i * 0.05, 'tick', 0.6);
    });
    // zoom on the empty 10th seat
    const you = seatEls[9];
    const row = q(s, '.qs-seats');
    const tZ = w('question', 5);
    tl.to(seatEls.slice(0, 9), { opacity: 0.25, filter: 'blur(3px)', duration: 0.35 }, tZ);
    tl.to(row, { scale: 1.9, x: -560, y: -70, duration: 0.7, ease: 'power3.inOut' }, tZ - 0.05);
    tl.fromTo(you, { '--pulse': 0 }, { '--pulse': 1, duration: 0.3 }, tZ + 0.3);
    cue(tZ, 'whoosh', 0.7);
    const q2 = q(s, '.qs-2');
    const q2w = splitWords(q2);
    tl.fromTo(q2, { opacity: 0 }, { opacity: 1, duration: 0.01 }, w('question', 3) - 0.05);
    const spoken = [3, 4, 4, 5, 6, 7, 8]; // display word -> spoken word ("১০ জনের" = "দশজনের")
    q2w.forEach((wd, i) => tl.fromTo(wd, { yPercent: 130, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.38 }, w('question', spoken[i]) - 0.03 + (i === 2 ? 0.12 : 0)));
    const tYou = w('question', 7);
    tl.fromTo(q(q2, 'b'), { color: '#ffffff' }, { color: '#BFE2FF', duration: 0.2 }, tYou);
    tl.fromTo(q(you, '.av b'), { scale: 1 }, { keyframes: [{ scale: 1.6, duration: 0.12 }, { scale: 1, duration: 0.35, ease: 'back.out(3)' }] }, tYou);
    shake(tYou, 1);
    flash(tYou, 0.3, 0.3);
    cue(tYou, 'impact', 0.9);
    cue(w('question', 8), 'shimmer', 0.6);
    tl.to([row, q2], { opacity: 0, scale: 0.9, duration: 0.25, ease: 'power2.in' }, end - 0.25);
  }

  // ===========================================================================
  // 9. CTA — "এখনই Lumademy AI Motion Graphics Crash Course-এ Enroll করুন।"
  // ===========================================================================
  {
    const s = add(`
      <div class="scene s-cta">
        <div class="ct-now bn">এখনই</div>
        <div class="ct-course en"><span>AI</span> <span>Motion</span> <span>Graphics</span> <span>Crash</span> <span>Course</span></div>
        <div class="ct-big bn">Enroll করুন</div>
        <div class="ct-row">
          <div class="ct-btn en"><span>Enroll Now</span>${I.arrow}<i class="ring"></i></div>
          <div class="ct-prize"><img src="${CLAUDE}" alt=""><span class="bn">সেরা ১০ জন পাবেন <b class="en">Claude Pro</b></span></div>
        </div>
        <svg class="cursor" viewBox="0 0 24 24"><path d="M4 2.5l15 8.2-6.6 1.6 3.9 7.3-2.7 1.4-3.9-7.3L4.9 18z" fill="#fff" stroke="#10234B" stroke-width="1.4" stroke-linejoin="round"/></svg>
      </div>`);
    const start = S.cta.start;
    tl.set(s, { autoAlpha: 1 }, start);
    tl.set(BG.uNight, { value: 0 }, start);
    tl.to(P.uOpacity, { value: 0.3, duration: 0.5 }, start);
    flash(start, 0.8, 0.4);
    cue(start, 'impact', 0.9);

    const now = q(s, '.ct-now');
    tl.fromTo(now, { scale: 2.4, opacity: 0, filter: 'blur(18px)' }, { scale: 1, opacity: 1, filter: 'blur(0px)', duration: 0.4 }, start);
    shake(start + 0.05, 1);
    tl.to(now, { y: -330, scale: 0.42, duration: 0.45, ease: 'power3.inOut' }, w('cta', 1) - 0.2);

    // 3D Lumademy mark spins in on "লুমাডেমি"
    const tL = w('cta', 1);
    tl.set(st, { logoY: 2.3, logoX: 0 }, tL - 0.1);
    tl.fromTo(st, { logo: 0 }, { logo: 0.62, duration: 0.7, ease: 'back.out(1.5)' }, tL - 0.1);
    tl.fromTo(st, { logoSpin: -Math.PI * 2 }, { logoSpin: 0, duration: 1.4, ease: 'expo.out' }, tL - 0.1);
    cue(tL - 0.1, 'shimmer', 0.8);

    const course = qa(s, '.ct-course span');
    course.forEach((sp, i) => {
      tl.fromTo(sp, { yPercent: 110, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.35 }, w('cta', 2 + i) - 0.04);
      cue(w('cta', 2 + i), 'tick', 0.6);
    });
    const big = q(s, '.ct-big');
    tl.fromTo(big, { scale: 1.6, opacity: 0, filter: 'blur(14px)' }, { scale: 1, opacity: 1, filter: 'blur(0px)', duration: 0.4 }, w('cta', 7) - 0.05);
    cue(w('cta', 7), 'impact', 0.8);
    shake(w('cta', 7), 0.8);
    const btn = q(s, '.ct-btn');
    const prize = q(s, '.ct-prize');
    tl.fromTo(btn, { y: 50, opacity: 0, scale: 0.8 }, { y: 0, opacity: 1, scale: 1, duration: 0.4, ease: 'back.out(2)' }, w('cta', 8) - 0.1);
    tl.fromTo(prize, { x: 80, opacity: 0 }, { x: 0, opacity: 1, duration: 0.45 }, w('cta', 8));
    const cursor = q(s, '.cursor');
    const tClick = S.cta.end + 0.25;
    tl.fromTo(cursor, { x: 380, y: 240, opacity: 0 }, { x: 0, y: 0, opacity: 1, duration: 0.4, ease: 'power3.out' }, tClick - 0.42);
    tl.to(btn, { keyframes: [{ scale: 0.92, duration: 0.06 }, { scale: 1.06, duration: 0.18 }, { scale: 1, duration: 0.3 }] }, tClick);
    tl.to(cursor, { keyframes: [{ scale: 0.82, duration: 0.06 }, { scale: 1, duration: 0.12 }] }, tClick);
    tl.fromTo(q(s, '.ring'), { scale: 1, opacity: 0.9 }, { scale: 1.7, opacity: 0, duration: 0.6, ease: 'power2.out' }, tClick);
    cue(tClick, 'click', 1);
    confetti(tClick + 0.02, 760, 820, 1.2);
    cue(tClick + 0.05, 'shimmer', 0.7);
    // gentle "breathing" on the button for the hold
    onFrame((t) => {
      if (t < tClick + 0.6) return;
      btn.style.boxShadow = `0 30px 70px rgba(3,20,70,.45), 0 0 0 ${8 + Math.sin(t * 4) * 6}px rgba(255,255,255,.18)`;
    });
  }

  tl.set({}, {}, END);
  cues.sort((a, b) => a.t - b.t);
  return { tl, cues, frameHooks, END, segments: timing.segments };
}
