# Assets — logos, student files, icons, images, packages

## Brand + logos
- `brand.json` has the palette and `logo.icon` / `logo.lockup` (defaults: the Lumademy white logos served by the
  engine at `assets/Lumademy_Icon_White.svg`, `assets/Lumademy_All_White.svg`; `assets/Lumademy_Icon_Blue.svg` for
  white stages). Use `ctx.brand.logo.lockup` in markup: `<img class="o-lockup" src="${brand.logo.lockup}" alt="">`.
- If the student brings their own brand, put their logo path(s) and colours in `brand.json` (keep keys: `sky blue
  royal deep nightA nightB off`) and say so in the report.

## Files the student attached
- They are already in the project under `assets/uploads/` (the message lists the paths). Reference them with a
  relative URL: `<img src="assets/uploads/logo.svg">`. SVG logos: inline the SVG text into your markup if you need to
  animate parts (read it with read_file), else use `<img>`.
- PDFs come with `<name>.txt` (extracted text) and `<name>-page-N.png` (page images) next to them.
- Never delete or rename a student's file unless asked.

## "Use this as a reference"
Uploads are either **material** (put it in the video: their logo, product screenshot, photo) or a **reference**
(match its style: a moodboard, a competitor ad frame, a brand book PDF, a storyboard sketch). If unclear, decide
from the wording ("use this logo" = material; "make it look like this" / "use as reference" = reference) and say
which you assumed. For a reference, look (read_file the image if you have vision; the PDF's text + page images
otherwise) and write down what to borrow in 3–5 concrete points — palette, type weight/scale, layout grid, motion
energy, transitions, texture — then build your own scenes in that spirit. Don't trace it. A brand book's colours,
fonts and logo go into brand.json (the student's brand wins over Lumademy's for their own videos).
A logo the student wants animated: `read_guide("logo")`.

## Icons (Phosphor)
The engine bundles the Phosphor icon set (MIT). In an **async** scene:
```js
import { phosphor } from '../lib/icons.js';
const rocket = await phosphor('rocket-launch', 'bold');        // inline <svg class="ico">, colour = currentColor
const s = add(`<div class="scene"><div class="feat">${rocket}<span>Launch faster</span></div></div>`);
```
Weights: `thin light regular bold fill duotone`. Names are Phosphor's kebab-case names (`chart-line-up`,
`lightning`, `users-three`, `video-camera`, `sparkle`, `check-circle`, `globe-hemisphere-east`, `currency-dollar`,
`play-circle`, `brain`, `code`, `palette`, `timer`, `trophy`, `megaphone`…). `phosphor` throws with a hint if a
name doesn't exist. Size icons with `font-size` (the svg is 1em) and colour with `color`. Prefer one weight per video
(`bold` or `fill` on blue stages reads best). Never draw your own clip-art icons.

## Images and video
- Raster images: `<img>` with explicit width/height in stage px; `object-fit: cover` inside rounded cards.
- Don't hot-link images from the web at render time (renders are offline and must be deterministic): download them
  into `assets/` with `curl -L -o assets/x.jpg <url>` first, and only if the student allowed using them.
- `<video>` elements are not frame-accurate in renders — avoid them.

## npm packages
`three`, `gsap` (+ DrawSVG, CustomEase), `d3-geo`, `topojson-client`, `world-atlas` are preinstalled. For more:
`npm install <pkg>` (lands in the project), then copy the engine's `public/index.html` into the project
(`cp "$LUMA_ENGINE/public/index.html" public/`) and add `"<pkg>": "./vendor/<pkg>/<entry>.js"` to its import map.

## Shared library (all projects)
Your prompt lists the shared library: fonts, sounds, data and snippets earlier runs added. `use_asset(id)` copies
one into `assets/library/` (or `to`). Fonts: then add an `@font-face` for it in scenes.css. When you download a
font or a sound, or build a reusable file (a country map from `npm run map`, a reusable effect), `share_asset` it
— the next project gets it without downloading or rebuilding. Skip the student's own logo, photos and personal
content.
