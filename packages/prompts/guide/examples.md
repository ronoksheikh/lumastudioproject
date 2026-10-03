# Examples

Finished example projects ship with the engine. Read their files with `read_guide("examples/<name>/…")` to copy
patterns (a scene that already works is the fastest way to a good one):

| Example | What it shows |
|---|---|
| `examples/starter/` | 15 s English: impact hook (`00-title.js`), map zoom to a city pin (`01-map.js`), bar chart + counter (`02-chart.js`), 3D logo end card (`03-outro.js`); `scenes.css`, `script.json` |
| `examples/explainer/` | 30 s Bengali ad, fast pacing: rapid-cut hook montage → 2×2 grid → fly into a preview (`00-hook.js`), counters (`01-ten.js`), map (`02-map.js`), graph (`03-graph.js`), UI mockups (`04-youtube.js`), split screen (`05-paths.js`), stamp (`06-you.js`), end card (`08-end.js`) |

`npm run example <name>` replaces the project's scenes, styles, script and audio with an example — only when the
student asks to start from one.
