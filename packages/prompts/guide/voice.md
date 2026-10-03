# Voice — script.json and ElevenLabs

- `script.json` → `voice` settings + `segments: [{ id, text }]`, one segment per scene. `text` is what the **voice**
  says; on-screen text is written separately in the scene.
- `generate_voice` sends all segments as one request (natural flow) and writes `public/audio/voiceover.mp3` +
  `timing.json` (every word with start/end). `placeholder: true` = silent audio with evenly spaced words (no key needed).
- Changed one line? Edit that segment's text and call `patch_voice` with its id — never regenerate everything.
- `voice.tempo` 1.05–1.1 speeds the audio up beyond ElevenLabs' max `speed` (1.2); timestamps are rescaled for you.
- Bengali (`language_code: "bn"`): write English words in Bengali script for the voice (ইউটিউব, এনরোল) and numbers
  as words (দশজন), but show Latin/numerals on screen.
