# Logo animation — stings, intros, outros (usually no voice)

For "animate this logo in a 5 sec video", a channel intro, an outro sting… The student's logo is usually an upload
(`assets/uploads/<name>.svg` or `.png`). Read it first (`read_file` the SVG: how many paths, groups, strokes vs
fills, viewBox, colours) — the structure decides the animation.

## 1. Time base without a voice
No script.json, no generate_voice. Give the video a timeline in `project.json`:
```json
{ "title": "Logo sting", "aspect": "16:9", "fps": 60, "tail": 0,
  "timeline": [ { "id": "build", "duration": 2.6 }, { "id": "hold", "duration": 2.4 } ] }
```
Scenes play back to back. Use `ctx.range('build')` for a scene and `ctx.at('build', 0.8)` for "0.8 s into build".
`w()` does not exist without words. The total length = sum of durations (+ `tail`). 5 s means 5 s: hit it exactly.

## 2. Pick a concept (don't default to "fade + scale")
Choose one idea that fits the brand's personality and commit to it. Some directions:
- **Draw-on → fill**: strokes draw with DrawSVG (`tl.fromTo(paths, {drawSVG: '0%'}, {drawSVG: '100%', stagger: .06})`),
  then the fills fade in on a shimmer. Needs paths: inline the SVG markup (not `<img>`). Fill-only paths: give them
  a temporary `stroke` of the same colour + `fill-opacity` 0 → 1.
- **Assemble**: each path/group flies in from a different direction or depth (`x/y/rotation/scale`, `stagger`,
  `back.out`) and snaps together on an impact cue. Great for multi-part marks.
- **Particles → logo**: set `brand.json` → `logo.icon` to the upload's path, then `morph(ctx, t, 'logo')`
  (`recipes/particles.js`): the particle cloud forms the mark; cross to the crisp SVG on top as it settles.
- **3D**: the same `logo.icon` drives the extruded 3D logo (`recipes/logo3d.js` `logoIn`/`logoOut`, project.json
  `features.logo3d`). Spin-in, then hand over to the flat logo + wordmark.
- **Mask reveal**: a shape (circle, the logo's own silhouette, a light sweep) uncovers it; or a line that becomes
  the logo's underline, then the wordmark rises out of a mask (`maskedWords`/`wordIn`).
- **Kinetic wordmark**: letters (Latin: `splitChars`) drop/flip/scale in sequence, the icon pops on the last letter.
- Finish with a confident **hold** (≥ 1 s of stillness with a subtle drift or a light sweep) — the end frame is
  the thumbnail.

Raster logos (PNG/JPG) can't be drawn path by path: use masks, light sweeps, scale/blur, particles from a shape,
or trace a simple SVG yourself only if asked.

## 3. Sound design (made in code)
A sting lives on sound. Built-ins: `cue(t, 'whoosh'|'impact'|'shimmer'|'riser'|'pop'|'tick'|'click'|'glitch', gain)`.
Make your own with WebAudio (deterministic, also rendered offline into the MP4):
```js
ctx.sound('chime', (ac, out, t, gain) => {
  for (const [f, d] of [[880, 0], [1320, 0.08], [1760, 0.16]]) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0, t + d); g.gain.linearRampToValueAtTime(0.4 * gain, t + d + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d + 1.2);
    o.connect(g).connect(out); o.start(t + d); o.stop(t + d + 1.3);
  }
});
cue(ctx.at('build', 2.2), 'chime', 0.8);
```
Use noise buffers (fill a buffer with `rand(i, k) * 2 - 1`, never `Math.random`) for whooshes/hits, filters and
envelopes for character. Or a sound/music file: `ctx.cueFile(t, 'assets/uploads/sting.mp3', { gain: 0.8 })`.
Land the big sound exactly on the visual hit; a riser 1–1.5 s before it.

## 4. Brand
Their logo keeps its own colours. Put it on a stage that suits it: the brand-blue stage for white/light marks,
`ctx.setStage(0, 'white', 0)` for dark or coloured marks. If the logo is not Lumademy's, the student's brand wins
over Lumademy blue — set `brand.json` colours to theirs if they gave them.

## 5. Check
`npm run check`, then `preview_frames` at ~0.1, the key moments of the build, the hit, and the last frame. The
layout check may report "no readable text" for a logo-only frame — that's fine for logos.
