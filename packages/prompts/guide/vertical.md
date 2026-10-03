# 9:16 (Reels, Shorts, Stories)

- Stage is **1080×1920** (`project.json` `aspect: "9:16"`; `ctx.W = 1080`, `ctx.H = 1920`). Never reuse 16:9 px
  layouts — re-lay out every scene as a single column.
- Safe area: 72px left/right, **220px top** (status bar, profile row), **300px bottom** (caption, buttons). Keep
  every word inside x 72–1008, y 220–1620.
- Type is bigger relative to width: hero 120–170px (2–4 words per line), headlines 84–110px, support 48–64px.
  Centre text vertically around y ≈ 760–1000 (upper-middle), not at the very bottom.
- Structure: the hook in the first second (often the title text itself, punching in word by word), a cut every
  1–3 words, a numbered list (১, ২, ৩ / 1, 2, 3) with one big number + one short line per item, a final
  CTA ("Follow for more" / "ফলো করুন") that stays ≥ 1.5 s. Loopable endings feel native.
- Recipes still work; size their wrapper for portrait (bar chart ≤ 940px wide; a map fills the frame — the camera
  aspect follows the stage automatically). 3D logo/particles fit automatically.
- Worked structure: `read_guide("examples")` → "9:16 reel".
