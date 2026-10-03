# Recipes — ready-made motion blocks

Import from `../lib/recipes/<file>.js` inside a scene. All take `ctx` first and put their tweens on the master
timeline at the times you pass — pass word times (`w(...)`), not guesses. Recipe markup uses `rc-*` classes from the
engine's `recipes.css`; **position and size the block with your own class** in `scenes.css` (don't restyle `rc-*`
internals unless you must). Read a recipe's source with `read_guide("public/js/lib/recipes/<file>.js")`.

## kinetic-type.js — words on spoken words
```js
import { maskedWords, punchWords, stamp, stampMarkup } from '../lib/recipes/kinetic-type.js';
maskedWords(ctx, q(s, '.title'), 'benefits', 0);   // word i slides up through a mask on spoken word (0 + i)
punchWords(ctx, q(s, '.hook'), 'hook', 0);          // hooks: each word slams in (scale 1.3 → 1)
const st = add(stampMarkup(icons.check, 'Free', { cls: 'my-stamp', lang: 'en' }));
stamp(ctx, st, w('offer', 3));                      // slam + flash + shake + impact on the key word
```
The node's text must be the same words, in order, as the segment words starting at `offset` (one span per word).
If the on-screen text differs from the spoken text, use `splitWords(node)` + `wordIn(span, w(id, k))` per span.

## counter.js — numbers that roll on the number word
```js
import { countUp, fmt, progressBar } from '../lib/recipes/counter.js';
countUp(ctx, q(s, '.num'), { to: 2.4, at: w('learners', 3), dur: 0.9, format: fmt.millions(1) }); // 0 → 2.4M
countUp(ctx, q(s, '.num'), { to: 128000, at: t, format: fmt.thousands });                          // 128,000
countUp(ctx, q(s, '.bn-num'), { to: 10, at: t, format: (v) => bnNum(Math.round(v)) });              // ১০
progressBar(ctx, q(s, '.fill'), { at: t, dur: 1.2, from: 0.1, to: 0.8 });                          // .fill { transform-origin: left }
```
Write the `from` value (e.g. `0`) as the element's initial text so the first frame of the scene is right.

## bar-chart.js — bars + trend line + headline chip
```js
import { barChart } from '../lib/recipes/bar-chart.js';
const chart = barChart({ title: 'Monthly views', chip: '+320%', lang: 'en', cls: 'c-card',
  values: [22, 31, 28, 46, 63, 92], labels: ['Jan','Feb','Mar','Apr','May','Jun'], valueFmt: (v) => `${v / 10}M` });
const s = add(`<div class="scene s-chart">${chart.html}</div>`);           // .s-chart .c-card { position:absolute; left:310px; top:250px; width:1300px }
chart.animate(ctx, s, { at: w('chart', 2), trendAt: w('chart', 4), focusAt: w('chart', 6) });
```
`values` are 0–100 (relative bar heights); `valueFmt` turns them into labels. Mark invented data as placeholders.

## map-zoom.js — world → country → city with a pin
```js
import { loadMap, mapMarkup, pinMarkup, mapCamera, mapPoints } from '../lib/recipes/map-zoom.js';
const map = await loadMap(ctx);                       // the scene function must be async
const { box, city } = mapPoints(map);                 // highlighted country box, city point
const s = add(`<div class="scene">${mapMarkup(map)}${pinMarkup()}</div>`);
const cam = mapCamera(ctx, q(s, '.rc-map'), map, { from: start, to: end, overlays: [{ nodes: [q(s, '.rc-pin')], at: city }] });
tl.fromTo(cam.vb, { ...cam.world() }, { ...cam.view(70, city[0], city[1]), duration: 1.2, ease: 'power3.inOut' }, w('map', 4));
```
The bundled map highlights Bangladesh with Dhaka. Another country: `npm run map -- --highlight <iso numeric> --city <lon>,<lat>`
(writes the project's own `assets/world-map.json`). Full working scene: `read_guide("examples/starter/scenes/01-map.js")`.

## transitions.js — designed scene changes
```js
import { iris, pushIn, gridSnap, flyInto, matchCut, stageRect } from '../lib/recipes/transitions.js';
pushIn(ctx, s, { at: end - 0.3 });                                    // outgoing scene zooms + blurs away
iris(ctx, next, { at: start, cx: 960, cy: 540, dir: 'open' });         // circle opens on the next scene
gridSnap(ctx, [a, b, c, d], { at: w('grid', 2) });                     // 4 full frames snap into a 2×2 grid
flyInto(ctx, s, stageRect(ctx, q(next, '.screen')), { at: start });   // whole frame flies into a screen (match cut)
```
`stageRect` must be called at build time on laid-out nodes. Prefer one strong transition per scene change; hide
cuts with motion (push-in out, iris/scale-in in) rather than cross-dissolves.

## ui-mockups.js — "this is how it's made"
```js
import { ideWindow, animateIde, videoPlayer, channelRow } from '../lib/recipes/ui-mockups.js';
const s = add(`<div class="scene">${ideWindow({ title: 'scene.js', lines: [['c', '// hook'], ['k', "tl.to('.title', …)"]], prompt: 'Make it pop' })}</div>`);
animateIde(ctx, s, { at: w('code', 1) });
```

## callouts.js — a device with leader lines
`calloutsMarkup({ items })` + `animateCallouts(ctx, root, { at })`. `items: [{ text, d, left, top }]` where `d` is an
SVG path in a 1000×560 box. `PHONE_CALLOUTS` is a ready example.

## particles.js — the 9,000-point cloud
```js
import { morph, particlesTo } from '../lib/recipes/particles.js';
particlesTo(ctx, start, 0.5);                                   // brightness 0–1
morph(ctx, w('hook', 2), 'sphere', { dur: 0.6, opacity: 0.7, spin: { to: 1.2 } });
await ctx.world.setTextTarget('AI'); morph(ctx, t, 'text');     // particles form a word (async scene)
morph(ctx, t, 'logo');                                          // particles form brand.logo.icon
```
Targets: `scatter sphere logo ring text`. Scenes are built in order, so morphs chain naturally.

## logo3d.js — the extruded brand mark
`logoIn(ctx, t, { x: 0, y: 2.3, size: 0.62 })`, `logoOut(ctx, t)`. Uses `brand.logo.icon`. Best on the end card.

## confetti.js — celebrations only
`const burst = createConfetti(ctx); burst(w('win', 2), 960, 540, 1);` Never in serious or premium moments.
