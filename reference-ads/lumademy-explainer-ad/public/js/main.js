import { createWorld, W, H } from './world.js';
import { buildTimeline } from './scenes.js';
import { Sfx } from './sfx.js';

gsap.registerPlugin(DrawSVGPlugin, CustomEase);

const params = new URLSearchParams(location.search);
const stage = document.getElementById('stage');
const scenesRoot = document.getElementById('scenes');
const fxRoot = document.getElementById('fx');
const captionsEl = document.getElementById('captions');
const audio = document.getElementById('vo');
const startBtn = document.getElementById('start');
const hud = document.getElementById('hud');
const hudFill = hud.querySelector('.fill');
const hudTime = hud.querySelector('.time');

// ---------- load ----------
const timing = await fetch('audio/timing.json').then((r) => {
  if (!r.ok) throw new Error('audio/timing.json missing — run `npm run voice` first.');
  return r.json();
});
await Promise.all([
  document.fonts.load('800 100px "Anek Bangla"'),
  document.fonts.load('600 100px "Anek Bangla"'),
  document.fonts.load('900 100px Inter'),
  document.fonts.load('700 100px Inter'),
  document.fonts.load('500 20px "JetBrains Mono"'),
]);
await document.fonts.ready;

const world = await createWorld(document.getElementById('gl'));
const { tl, cues, frameHooks, END, segments } = await buildTimeline({ timing, world, scenesRoot, fxRoot });
const sfx = new Sfx();

// ---------- layout ----------
const maxPR = Number(params.get('pr')) || 1.5;
function fit() {
  const s = Math.min(innerWidth / W, innerHeight / H);
  stage.style.transform = `translate(-50%, -50%) scale(${s})`;
  world.resize(Math.min(devicePixelRatio * s, maxPR));
}
addEventListener('resize', fit);
fit();

// ---------- captions ----------
let captionsOn = params.has('captions');
const capWords = [];
segments.forEach((seg, si) => seg.words.forEach((wd) => capWords.push({ ...wd, si })));
let capSeg = -1;
function renderCaptions(t) {
  captionsEl.style.display = captionsOn ? '' : 'none';
  if (!captionsOn) return;
  const seg = segments.findIndex((s, i) => t >= s.start - 0.05 && t < (segments[i + 1]?.start ?? s.end + 1.2));
  if (seg !== capSeg) {
    capSeg = seg;
    captionsEl.innerHTML = seg < 0 ? '' : segments[seg].words.map((wd) => `<span>${wd.w}</span>`).join(' ');
  }
  if (seg < 0) return;
  [...captionsEl.children].forEach((sp, i) => sp.classList.toggle('on', t >= segments[seg].words[i].start));
}

// ---------- clock ----------
// Visuals follow a performance.now() clock that is continuously re-synced to the
// audio element, so frames stay smooth while never drifting from the voice.
let playing = false;
let base = 0; // timeline time at `perf0`
let perf0 = 0;
let lastT = 0;

const now = () => (playing ? base + (performance.now() - perf0) / 1000 : base);

function seek(t) {
  base = gsap.utils.clamp(0, END, t);
  perf0 = performance.now();
  lastT = base;
  if (base < audio.duration) audio.currentTime = base;
  if (playing && base < (audio.duration || timing.duration)) audio.play().catch(() => {});
  if (!playing) draw(base);
}

async function play() {
  sfx.init();
  await sfx.resume();
  if (now() >= END - 0.01) base = 0;
  playing = true;
  perf0 = performance.now();
  lastT = base;
  if (base < (audio.duration || timing.duration)) {
    audio.currentTime = base;
    try {
      await audio.play();
    } catch (e) {
      console.warn('Audio play blocked:', e);
    }
  }
  startBtn.classList.add('hidden');
}

function pause() {
  base = now();
  playing = false;
  audio.pause();
}

function draw(t) {
  tl.time(t, false);
  for (const fn of frameHooks) fn(t);
  const sh = world.state.shake;
  scenesRoot.style.transform = sh > 0.001 ? `translate(${Math.sin(t * 71) * 9 * sh}px, ${Math.cos(t * 63) * 9 * sh}px)` : '';
  renderCaptions(t);
  world.render(t);
  hudFill.style.transform = `scaleX(${t / END})`;
  hudTime.textContent = `${t.toFixed(1)}s / ${END.toFixed(1)}s`;
}

function loop() {
  requestAnimationFrame(loop);
  if (!playing) return;
  let t = now();

  // keep the clock locked to the audio
  if (!audio.paused && !audio.ended) {
    const drift = audio.currentTime - t;
    if (Math.abs(drift) > 0.06) {
      base = audio.currentTime;
      perf0 = performance.now();
      t = base;
    }
  }
  if (t >= END) {
    t = END;
    pause();
    base = END;
  }

  // fire sound cues that the playhead crossed this frame
  if (t > lastT && t - lastT < 0.5) {
    for (const c of cues) if (c.t > lastT && c.t <= t) sfx.play(c.type, c.gain);
  }
  lastT = t;
  draw(t);
}
requestAnimationFrame(loop);

// ---------- controls ----------
startBtn.addEventListener('click', () => {
  seek(0);
  play();
});
stage.addEventListener('click', () => {
  if (startBtn.classList.contains('hidden')) (playing ? pause() : play());
});
addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    if (startBtn.classList.contains('hidden')) (playing ? pause() : play());
    else startBtn.click();
  } else if (e.key === 'r' || e.key === 'R') {
    seek(0);
    if (!playing) play();
  } else if (e.key === 'ArrowRight') seek(now() + 2);
  else if (e.key === 'ArrowLeft') seek(now() - 2);
  else if (e.key === 'c' || e.key === 'C') {
    captionsOn = !captionsOn;
    draw(now());
  } else if (e.key === 'f' || e.key === 'F') {
    document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
  } else if (e.key === 'm' || e.key === 'M') sfx.enabled = !sfx.enabled;
});
hud.querySelector('.bar').addEventListener('click', (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  seek(((e.clientX - r.left) / r.width) * END);
});

// Poster frame behind the play button (or a specific time via ?t=12.5)
seek(params.has('t') ? Number(params.get('t')) : timing.segments.at(-1).start + 2.6);
document.body.classList.add('ready');

// Deterministic hook for frame-by-frame capture tools.
window.ad = { seek: (t) => { pause(); seek(t); }, play, pause, duration: END, world,
  async sfxWavBase64() {
    const bytes = await Sfx.renderWav(cues, END);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  },
};
