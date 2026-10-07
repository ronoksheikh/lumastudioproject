# Design — how to make a video look intentional

This guide teaches a process, not a house style. The student's brief, brand, files and references decide the
look. Nothing here is a fixed colour, size or sound to reuse in every video.

## 1. Decide the look first (write it in your plan)
- **Palette:** from the student's brand/logo/reference (sample colours from their files), or derive one for the
  subject: a base (background), a text colour with strong contrast, and ONE accent. Put them in brand.json /
  CSS variables so every scene shares them. If the student gives nothing and it's a Lumademy video, the Lumademy
  palette is one good option (`--blue --sky --royal --deep --off --ice`).
- **Background:** any treatment — a flat colour (`ctx.setBackground(t, '#0E0E0E')`, or `initWorld({ background:
  '#F4F1EA', lines: false, vignette: false })`), the engine's animated gradient (`initWorld({ night })`, with or
  without its wave lines/vignette), white (`ctx.setStage(t, 'white')`), an image or video still in a scene, or
  your own DOM/canvas/SVG layer. Pick what fits the concept; change it between sections if that tells the story.
- **Type:** one display face + one text face at most (plus mono for code/labels). Any font works: download it
  (Google Fonts / Fontsource with curl), add an `@font-face` in scenes.css with a relative url, `share_asset` it.
  `.bn` for Bengali needs a Bengali font (Anek Bangla is bundled).
- **Sound palette:** decide the character (warm/organic, glitchy/tech, cinematic, playful, minimal) and design
  the sounds for it — your own `ctx.sound` synths or files — instead of reusing the same set every time.

## 2. Readability (measurable — the layout check reports these)
- Contrast: text must stand out from what is behind it at every moment (check over gradients and images).
- Size: on a 1920×1080 stage, body text below ~24px is hard to read on phones; headlines carry the message.
- Space: keep important content away from the edges (social UIs cover the top/bottom of 9:16).
- Density: few words on screen at a time; one focal point per moment.

## 3. Motion with intent
- Every change starts on its beat (a word with `w()`, or `at()` without a voice). Start ~0.03–0.05 s early so it
  reads on the syllable.
- Enter, land, settle. Fast-out-slow-in eases for entrances, quick accelerating exits that finish before the cut.
  Choose durations by energy: snappy for ads/reels, calmer for explainers.
- Transitions are motivated by the content (a shape that becomes the next scene, a camera move, a mask, a match
  cut). Avoid generic dissolves/slides unless the style calls for it.
- Vary rhythm: not every element should pop the same way.

## 4. Structure by video type (starting points, not formulas)
| Type | Typical shape |
|---|---|
| Ad | hook in the first seconds → value → proof → clear call to action |
| Explainer | question → steps, one visual idea each → recap |
| Reel (9:16) | text-led, fast cuts, loopable end |
| Logo sting / intro | one strong idea, a hit, a confident hold (`read_guide("logo")`) |
| Announcement | the news first → details → call to action |

## 5. Before you say "done"
Look at the frames as a designer: hierarchy, alignment, contrast, consistency of the palette and type, nothing
clipped, nothing that looks like a template. Invented numbers/prices/names are flagged as placeholders.
