// Sound layer: synthesized sound design (whooshes, impacts, ticks — WebAudio, no files), sounds a video
// defines itself in code (Sfx.register / ctx.sound), and audio files (music, recorded sounds, a voice from
// another provider — ctx.cueFile). The same cues play live and are rendered offline into the MP4's mix.

const custom = new Map(); // name -> fn(audioCtx, destination, t, gain)
const fileBytes = new Map(); // url -> ArrayBuffer

export class Sfx {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.buffers = new Map(); // url -> AudioBuffer (decoded for this context)
    this.playingFiles = [];
    this.ready = Promise.resolve();
  }

  /** A sound designed in code: fn(audioCtx, destination, t, gain) builds WebAudio nodes that start at t. */
  static register(name, fn) {
    if (typeof fn !== 'function') throw new Error(`sound("${name}") needs a function (audioCtx, destination, t, gain) => void`);
    custom.set(name, fn);
  }

  /** Fetch every audio file the cues use (once). Missing files are reported, not fatal. */
  static async prefetch(cues) {
    const urls = [...new Set(cues.filter((c) => c.type === 'file').map((c) => c.url))].filter((u) => !fileBytes.has(u));
    await Promise.all(urls.map(async (u) => {
      const r = await fetch(u).catch(() => null);
      if (!r?.ok) return console.error(`cueFile: audio file not found: ${u}`);
      fileBytes.set(u, await r.arrayBuffer());
    }));
  }

  init(ctx = new AudioContext()) {
    if (this.ctx) return;
    this.ctx = ctx;
    // decode the prefetched files for this context (copies: decodeAudioData detaches its input)
    this.ready = Promise.all([...fileBytes].map(async ([u, bytes]) => {
      try {
        this.buffers.set(u, await ctx.decodeAudioData(bytes.slice(0)));
      } catch {
        console.error(`cueFile: could not decode ${u}`);
      }
    }));
    this.master = ctx.createGain();
    this.master.gain.value = 0.42;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    // one second of white noise, reused by every noisy sound
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  async resume() {
    await this.ctx?.resume();
    await this.ready;
  }

  play(type, gain = 1, when = this.ctx?.currentTime, cue = null) {
    if (!this.ctx || !this.enabled) return;
    if (type === 'file') return cue && this.playFile(cue, when, cue.offset ?? 0);
    if (custom.has(type)) {
      try {
        custom.get(type)(this.ctx, this.master, when, gain);
      } catch (e) {
        console.error(`sound "${type}" failed: ${e.message}`);
      }
      return;
    }
    const fn = this[type];
    if (fn) fn.call(this, when, gain);
    else console.error(`cue: unknown sound "${type}" — use a built-in one or register it with ctx.sound()`);
  }

  /** Start an audio-file cue at `when` (context time), `offset` seconds into the file. */
  playFile(cue, when, offset = 0) {
    const buf = this.buffers.get(cue.url);
    if (!buf || offset >= buf.duration) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = cue.gain ?? 1;
    src.connect(g).connect(this.ctx.destination); // files bypass the sfx compressor: music keeps its own mix
    src.start(when, offset);
    this.playingFiles.push(src);
    src.onended = () => (this.playingFiles = this.playingFiles.filter((x) => x !== src));
  }

  /** Live playback starting at timeline time t: start the file cues that are already under way. */
  syncFiles(cues, t) {
    if (!this.ctx) return;
    this.stopFiles();
    for (const c of cues) {
      if (c.type !== 'file' || c.t > t) continue;
      const buf = this.buffers.get(c.url);
      const into = t - c.t + (c.offset ?? 0);
      if (buf && into < buf.duration && into > 0.02) this.playFile(c, this.ctx.currentTime, into);
    }
  }

  stopFiles() {
    for (const s of this.playingFiles) {
      try { s.stop(); } catch { /* already stopped */ }
    }
    this.playingFiles = [];
  }

  // Renders every cue offline into a WAV (used by the MP4 exporter).
  static async renderWav(cues, duration) {
    await Sfx.prefetch(cues);
    const ctx = new OfflineAudioContext(2, Math.ceil(Math.max(duration, 0.1) * 48000), 48000);
    const sfx = new Sfx();
    sfx.init(ctx);
    await sfx.ready;
    for (const c of cues) sfx.play(c.type, c.gain, c.t, c);
    const buf = await ctx.startRendering();
    return encodeWav(buf);
  }

  // --- helpers ---
  env(node, t, a, peak, d) {
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(peak, t + a);
    node.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  noiseSrc(t, dur) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.start(t);
    s.stop(t + dur + 0.05);
    return s;
  }

  // --- sounds ---
  whoosh(t, g) {
    const ctx = this.ctx;
    const src = this.noiseSrc(t, 0.6);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(4200, t + 0.32);
    bp.frequency.exponentialRampToValueAtTime(900, t + 0.55);
    const amp = ctx.createGain();
    this.env(amp, t, 0.18, 0.55 * g, 0.38);
    src.connect(bp).connect(amp).connect(this.master);
  }

  impact(t, g) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.35);
    const amp = ctx.createGain();
    this.env(amp, t, 0.005, 0.9 * g, 0.55);
    o.connect(amp).connect(this.master);
    o.start(t);
    o.stop(t + 0.7);

    const src = this.noiseSrc(t, 0.25);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    const na = ctx.createGain();
    this.env(na, t, 0.002, 0.35 * g, 0.16);
    src.connect(lp).connect(na).connect(this.master);
  }

  pop(t, g) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(520, t);
    o.frequency.exponentialRampToValueAtTime(1200, t + 0.06);
    const amp = ctx.createGain();
    this.env(amp, t, 0.004, 0.32 * g, 0.12);
    o.connect(amp).connect(this.master);
    o.start(t);
    o.stop(t + 0.2);
  }

  tick(t, g) {
    const ctx = this.ctx;
    const src = this.noiseSrc(t, 0.04);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3500;
    const amp = ctx.createGain();
    this.env(amp, t, 0.001, 0.22 * g, 0.03);
    src.connect(hp).connect(amp).connect(this.master);
  }

  click(t, g) {
    this.tick(t, g * 1.6);
    this.pop(t + 0.01, g * 0.6);
  }

  riser(t, g) {
    const ctx = this.ctx;
    const dur = 0.9;
    const src = this.noiseSrc(t, dur);
    const hp = ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.Q.value = 2;
    hp.frequency.setValueAtTime(400, t);
    hp.frequency.exponentialRampToValueAtTime(7000, t + dur);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(0.4 * g, t + dur * 0.95);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.04);
    src.connect(hp).connect(amp).connect(this.master);
  }

  shimmer(t, g) {
    const ctx = this.ctx;
    [880, 1318.5, 1760, 2637].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const amp = ctx.createGain();
      this.env(amp, t + i * 0.035, 0.01, 0.09 * g, 1.1);
      o.connect(amp).connect(this.master);
      o.start(t + i * 0.035);
      o.stop(t + 1.4);
    });
  }

  glitch(t, g) {
    const ctx = this.ctx;
    for (let i = 0; i < 5; i++) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = 180 + Math.random() * 900;
      const amp = ctx.createGain();
      const s = t + i * 0.035;
      this.env(amp, s, 0.002, 0.08 * g, 0.03);
      o.connect(amp).connect(this.master);
      o.start(s);
      o.stop(s + 0.06);
    }
  }
}

function encodeWav(buf) {
  const ch = buf.numberOfChannels;
  const len = buf.length;
  const view = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const str = (o, t) => [...t].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); view.setUint32(4, 36 + len * ch * 2, true); str(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, ch, true);
  view.setUint32(24, buf.sampleRate, true); view.setUint32(28, buf.sampleRate * ch * 2, true);
  view.setUint16(32, ch * 2, true); view.setUint16(34, 16, true); str(36, 'data'); view.setUint32(40, len * ch * 2, true);
  const data = [...Array(ch)].map((_, i) => buf.getChannelData(i));
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++, o += 2) view.setInt16(o, Math.max(-1, Math.min(1, data[c][i])) * 0x7fff, true);
  return new Uint8Array(view.buffer);
}
