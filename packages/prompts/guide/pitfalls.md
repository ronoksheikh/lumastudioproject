# Pitfalls — learned the hard way

1. **GSAP `fromTo` renders immediately at build time.** A `fromTo(camera, {z: 24}, …)` placed late in the
   timeline changed the camera for the whole video. One `from/fromTo` per property per element (the entrance);
   exits and later changes use `to`; shared objects (camera, uniforms, `ctx.BG`) start from a `tl.set(…, 0)`.
   Flash/shake use `immediateRender: false` for this reason.
2. **`show()` owns a scene's `visibility`.** It toggles visibility only (never opacity). Tween the scene's
   children or its opacity freely, but don't add your own `visibility`/`autoAlpha` sets on the same node at
   overlapping times. A scene's content must be hidden when the scene is not on (`show(s, start, end)`).
3. **Visibility vs opacity.** `opacity:0` elements still take space and still count for overlaps in your head;
   hidden (`visibility:hidden`) ones don't render. Initial states belong in `fromTo`, not CSS (`opacity:0` in CSS
   + a `to` tween works, but a `fromTo` is clearer and survives seeking backwards).
4. **CSS transforms on tweened elements.** `transform: translateY(150%)` in CSS + a GSAP `yPercent` tween left a
   label off-screen. Let GSAP own transforms; centre with `left/right` + `text-align`, or `margin-left: -w/2`.
5. **Descendant selectors hit word spans.** `.caption span { position: absolute }` also matched the `.w/.wi`
   spans that `splitWords` injects. Use child selectors (`.caption > span`).
6. **Unitless custom properties.** `calc(var(--h) * 3.8px)` with `--h: 22%` is invalid → zero-height bars.
7. **Bengali "traces".** Masked reveals let matras (ি, ী) peek above the mask early. The helpers fade opacity
   with the slide and `.w` pads the mask (`padding: .16em .05em .24em`) — keep both if you write your own.
8. **Never split Bengali by characters** (conjuncts and vowel signs break). `splitWords` only; `splitChars` throws.
9. **Fonts before measuring.** main.js waits for the vendored fonts before building scenes. If you add another
   font, `await document.fonts.load('700 100px "X"')` in an async scene before measuring or drawing text.
10. **Relative URLs only** (`assets/…`, `audio/…`). The Studio serves the project under `/p/<id>/<token>/`.
11. **Match cuts need exact geometry.** Use `stageRect(ctx, node)` at build time instead of guessing numbers.
12. **Map maths with `preserveAspectRatio="slice"`:** use `mapCamera().toPx` to place DOM over map points.
13. **Orange/coloured glows on blue go purple.** Keep glows white/blue.
14. **Word indices change when the text changes.** After editing a segment and re-recording, re-read the word
    list and fix every `w('seg', i)` (`npm run check` flags indices that no longer exist, not ones that moved).
15. **Long `write_file` calls can break JSON.** Keep each scene file small (one scene per file, ≤ ~150 lines);
    split helpers into another file instead of one giant file.
16. **`ctx.add` in the wrong order.** Later `add` calls sit on top. Add backgrounds first, text last, or use `z-index`.
17. **Recipe markup is absolutely positioned inside your block.** Give the wrapper a size (`width/height` or
    `inset`) or the recipe collapses to 0×0.
18. **ElevenLabs `mp3_44100_192` → 403** on lower plans; the engine always asks for `mp3_44100_128`.
