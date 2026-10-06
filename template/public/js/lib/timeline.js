// makeContext() builds the object every scene receives: the master GSAP timeline plus the
// helpers scenes use to put motion on spoken words. See LUMA.md for the full catalogue.

import { el, q, qa } from './core.js';
import { Sfx } from '../sfx.js';

export function makeContext({ timing, world, scenesRoot, fxRoot, project, brand, size }) {
  const S = Object.fromEntries(timing.segments.map((s) => [s.id, s]));
  const ids = timing.segments.map((s) => s.id);
  // a voiced video keeps a short tail after the last word; a timeline-only video ends with its last scene
  const tail = project.tail ?? (timing.silent ? 0 : 2.4);
  const END = timing.duration + tail;

  const tl = gsap.timeline({ paused: true, defaults: { ease: 'expo.out', duration: 0.6 } });
  const cues = [];
  const frameHooks = [];

  const seg = (id) => {
    if (!S[id]) throw new Error(`Unknown segment "${id}". Segments in timing.json: ${ids.join(', ')}`);
    return S[id];
  };

  /** Start time (s) of word `i` of segment `id`. Negative i counts from the end. */
  const w = (id, i = 0) => {
    const s = seg(id);
    const n = s.words.length;
    const k = i < 0 ? n + i : i;
    if (!s.words[k]) {
      if (!n) throw new Error(`w('${id}', ${i}): segment "${id}" has no words (this video has no voice) — use ctx.at('${id}', seconds) or ctx.range('${id}') instead`);
      throw new Error(`w('${id}', ${i}): segment "${id}" has ${n} words (0-${n - 1}): ${s.words.map((x, j) => `${j}:${x.w}`).join(' ')}`);
    }
    return s.words[k].start;
  };
  /** End time (s) of word `i` of segment `id`. */
  const wEnd = (id, i = 0) => {
    const s = seg(id);
    const k = i < 0 ? s.words.length + i : i;
    if (!s.words[k]) throw new Error(`wEnd('${id}', ${i}): no such word`);
    return s.words[k].end;
  };
  /** [start, end] of a scene: from this segment's start to the next segment's start (END for the last). */
  const range = (id) => {
    const k = ids.indexOf(seg(id).id);
    return [S[id].start, k + 1 < ids.length ? timing.segments[k + 1].start : END];
  };

  /** `seconds` after the start of segment `id` (videos without a voice time their beats this way). */
  const at = (id, seconds = 0) => seg(id).start + seconds;
  const cue = (t, type, gain = 1) => cues.push({ t, type, gain });
  /** Play an audio file (music bed, recorded sfx, a voice from another provider…) from time t. Relative URL, e.g. 'assets/music.mp3'. */
  const cueFile = (t, url, { gain = 1, offset = 0 } = {}) => cues.push({ t, type: 'file', url, gain, offset });
  /** Register a sound you synthesize yourself with WebAudio: fn(audioCtx, destination, t, gain). Then cue(t, name). */
  const sound = (name, fn) => Sfx.register(name, fn);
  const onFrame = (fn) => frameHooks.push(fn);

  const flashEl = fxRoot.querySelector('.flash');
  const flash = (t, peak = 0.85, dur = 0.45) =>
    tl.fromTo(flashEl, { opacity: peak }, { opacity: 0, duration: dur, ease: 'power2.out', immediateRender: false }, t);
  const shake = (t, amt = 1, dur = 0.45) =>
    tl.fromTo(world.state, { shake: amt }, { shake: 0, duration: dur, ease: 'power2.out', immediateRender: false }, t);

  /** Make a scene (or any node) visible from `from` until `to`. Only toggles `visibility`, so you can still tween the node's opacity. */
  const show = (node, from, to) => {
    tl.set(node, { visibility: 'visible' }, from);
    // a scene that runs to the end stays on the very last frame (hiding it AT END left the final frame blank)
    if (to != null && to < END - 1e-6) tl.set(node, { visibility: 'hidden' }, to);
  };
  const add = (html) => scenesRoot.appendChild(el(html));
  const vignette = fxRoot.querySelector('.vignette');
  /** Switch the stage background at time t: 'white' (white stage, no vignette) or 'blue' (the brand gradient). */
  const setStage = (t, mode = 'white', dur = 0.5) => {
    const white = mode === 'white';
    tl.to(world.bg.uWhite, { value: white ? 1 : 0, duration: dur, ease: 'power2.inOut' }, t);
    if (vignette) tl.to(vignette, { opacity: white ? 0 : 1, duration: dur, ease: 'power2.inOut' }, t);
  };

  /**
   * Any background colour or look, not just the brand gradient: setBackground(t, '#0E0E0E') fades to a flat colour;
   * setBackground(t, null) goes back to the gradient. Options: lines/vignette (on/off), dur.
   */
  const setBackground = (t, color, { dur = 0.5, lines, vignette: vig } = {}) => {
    const B = world.bg;
    if (color) {
      // the colour switches at t (while uFlat fades in); fading from one flat colour to another tweens it
      const c = new world.THREE.Color(color);
      tl.to(B.cFlat.value, { r: c.r, g: c.g, b: c.b, duration: dur, ease: 'power2.inOut' }, t);
    }
    tl.to(B.uFlat, { value: color ? 1 : 0, duration: dur, ease: 'power2.inOut' }, t);
    if (lines != null) tl.to(B.uLines, { value: lines ? 1 : 0, duration: dur }, t);
    if (vig != null) {
      tl.to(B.uVig, { value: vig ? 1 : 0, duration: dur }, t);
      if (vignette) tl.to(vignette, { opacity: vig ? 1 : 0, duration: dur }, t);
    }
  };

  // masked word reveal; opacity keeps Bengali matras from peeking out early
  const wordIn = (wd, t, d = 0.42) => tl.fromTo(wd, { yPercent: 130, opacity: 0 }, { yPercent: 0, opacity: 1, duration: d }, t - 0.03);
  const reveal = (words, id, offset = 0) => words.forEach((wd, i) => wordIn(wd, w(id, offset + i)));
  const wordsOut = (node, t) => tl.to(node, { y: -40, opacity: 0, filter: 'blur(8px)', duration: 0.28, ease: 'power2.in' }, t);

  const ctx = {
    gsap,
    tl, cues, frameHooks, timing, segments: timing.segments, S, END,
    world, st: world.state, P: world.particles, BG: world.bg,
    project, brand, size, W: size.W, H: size.H,
    scenesRoot, fxRoot,
    w, wEnd, seg, range, at, cue, cueFile, sound, onFrame, flash, shake, show, add, setStage, setBackground, q, qa, el, wordIn, reveal, wordsOut,
    /** Build-time memory shared by recipes (e.g. which particle target is currently active). */
    memo: { particleTarget: 'scatter' },
    /** Set the world's starting state at t=0. Call once from scenes/index.js. */
    initWorld({ night = 0, jitter = 0.35, particles = 0.14, particlesFade = 1, background = null, lines = true, vignette: vig = true } = {}) {
      const { tl: T, BG, P } = ctx;
      T.set(BG.uNight, { value: night }, 0);
      // starting look: the brand gradient, or any flat colour; wave lines and vignette can be switched off
      if (background) {
        const c = new world.THREE.Color(background);
        T.set(BG.cFlat.value, { r: c.r, g: c.g, b: c.b }, 0);
      }
      T.set(BG.uFlat, { value: background ? 1 : 0 }, 0);
      T.set(BG.uLines, { value: lines ? 1 : 0 }, 0);
      T.set(BG.uVig, { value: vig ? 1 : 0 }, 0);
      if (vignette) T.set(vignette, { opacity: vig ? 1 : 0 }, 0);
      T.set(BG.uWhite, { value: 0 }, 0); // setStage() tweens from here
      T.set([P.wSphere, P.wLogo, P.wRing, P.wText], { value: 0 }, 0);
      T.set(P.wScatter, { value: 1 }, 0);
      T.set(P.uJitter, { value: jitter }, 0);
      T.fromTo(P.uOpacity, { value: 0 }, { value: particles, duration: particlesFade }, 0);
    },
    /** Called by scenes/index.js after all scenes are built. */
    finish() {
      tl.set({}, {}, END);
      cues.sort((a, b) => a.t - b.t);
      return { tl, cues, frameHooks, END, segments: timing.segments };
    },
  };
  return ctx;
}
