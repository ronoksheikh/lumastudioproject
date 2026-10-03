# Voice — script.json, choosing a voice, ElevenLabs

A voice is optional. Logo stings, intros, music-only or silent videos use a `project.json` timeline instead, and
a voice from another TTS provider or the student's own recording goes in with `import-voice`: `read_guide("sound")`.

## 1. Write script.json
```json
{
  "voice": {
    "voice_id": "<from list_voices>",
    "model_id": "eleven_multilingual_v2",
    "language_code": "bn",
    "voice_settings": { "stability": 0.5, "similarity_boost": 0.8, "style": 0.2, "use_speaker_boost": true, "speed": 1.1 },
    "tempo": 1
  },
  "segments": [ { "id": "hook", "text": "…what the voice says…" } ]
}
```
- One segment per scene, ids `[A-Za-z0-9_-]+`, short (2–8 s of speech). `text` is what the **voice** says.
- If the student gave an exact script, keep their words verbatim (you may only split it into segments).

## 2. Choose the voice (unless the student's Settings override it)
The system prompt says whether the student set overrides in Settings → Voice. If they did, those values are applied
to script.json automatically every time you call generate_voice — don't fight them. Otherwise **you** choose:

1. Call `list_voices` (pass `language`, e.g. `"bn"`). It returns the plan (`free`, `starter`, `creator`…), characters
   left, and each voice with gender/age/accent, languages and whether it is usable on this plan.
2. Pick a voice whose **language** matches (or a multilingual premade voice) and whose **tone** fits:
   ads/announcements → confident, energetic, clear; explainers → warm, calm narrator; reels → young, upbeat.
   Match the gender/age the student asked for. Never pick one marked `[NOT on this plan]`; on the free plan
   prefer `premade` voices (library voices may be refused).
3. Pick the model:

| Language | Model | `language_code` |
|---|---|---|
| Bengali (and anything else not in the list below) | `eleven_v3` (or `eleven_v4` if the account has it) | `"bn"` etc. |
| English, Hindi, Arabic, Spanish, French, German, Portuguese, Japanese, Chinese, Korean and the other 29 multilingual-v2 languages | `eleven_multilingual_v2` (stable, best default) | **omit** — this model doesn't take it |
| Very long or draft voiceovers, tight credits | `eleven_flash_v2_5` | optional |

4. Settings: `stability` 0.4–0.6 (lower = livelier), `similarity_boost` 0.75–0.85, `style` 0–0.3,
   `use_speaker_boost: true`, `speed` 1.0–1.2 (ElevenLabs max 1.2). Ads: speed 1.15–1.2, and `tempo` 1.05–1.1 for
   "fast-paced" (an ffmpeg time-stretch; timestamps are rescaled for you). Explainers: speed 1.0–1.1, tempo 1.
5. Say which voice/model you chose (and why, in a few words) in your report.

**If generation fails**, read the reason (the tool explains it and says what to try): a voice not available on the
plan → a `premade` voice from list_voices; a model refused → `eleven_v3` (any language) or `eleven_multilingual_v2`;
out of characters → tell the student and continue with `placeholder: true`; no key → `placeholder: true` and tell the
student to add the key in Settings → Voice. Don't retry the same failing request more than once.

## 3. TTS text vs screen text
- Bengali (`bn`): write English words in **Bengali script** for the voice (ইউটিউব, এনরোল, ক্লায়েন্ট, ওয়ার্কফ্লো) and
  numbers as **words** (দশজন, চল্লিশ থেকে পঞ্চাশটা), but show Latin names/numerals on screen ("YouTube", "10").
- Any language: spell out symbols and abbreviations the way they should be spoken ("320 percent", "A I").
- Punctuation shapes delivery: a full stop = a beat; an em dash or comma = a short pause; "?" lifts the tone.

## 4. After generating
- `generate_voice` returns every word as `index:word@start`. Plan all visual beats on these times (`w('seg', i)`).
- Changed one line? Edit that segment's text in script.json, then `patch_voice` with its id — never regenerate
  everything for one line (it re-times the whole video). Word indices of that segment change: fix its `w()` calls.
- `placeholder: true` = silent audio with evenly spaced words — fine for building visuals, never the final render.
- Pacing: ~2.2–2.6 spoken words/second for ads, 2.0–2.3 for explainers.
