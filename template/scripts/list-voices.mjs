// Lists the ElevenLabs voices this account can use, plus its plan, as one JSON line. Luma Studio runs it for the
// agent's list_voices tool (key on stdin, never in argv/env of agent commands).
//
// Usage: node scripts/list-voices.mjs --key-stdin [--search <text>] [--language <bn|en|…>] [--root <project>]
//   → {"tier":"free","charactersLeft":9000,"voices":[{"voice_id":"…","name":"…","category":"premade",…,"usable":"yes"}]}
//
// usable: "yes" (premade or the account's own voices), "paid_only" (the library says free users can't use it),
// "maybe" (a library voice on the free plan: some owners restrict them — prefer a premade voice).

import { parseArgs, loadEnv, applyKeyFromStdin, projectRoot, ELEVEN_BASE } from './lib/common.mjs';

const { opts } = parseArgs();
await loadEnv(projectRoot(opts), opts);
await applyKeyFromStdin(opts);
const key = process.env.ELEVENLABS_API_KEY;
if (!key) {
  console.error('Missing ElevenLabs API key.');
  process.exit(1);
}

async function get(path) {
  const res = await fetch(`${ELEVEN_BASE()}${path}`, { headers: { 'xi-api-key': key, Accept: 'application/json' } });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { ok: res.ok, status: res.status, json, text: text.replaceAll(key, '***').slice(0, 400) };
}

const sub = await get('/v1/user/subscription');
if (sub.status === 401) {
  // a key restricted to text-to-speech only can't read the subscription; that's fine
  if (!/missing_permissions|permission/i.test(sub.text)) {
    console.error(`ElevenLabs rejected the API key (401): ${sub.json?.detail?.message ?? sub.text}`);
    process.exit(1);
  }
}
const tier = sub.ok ? String(sub.json?.tier ?? 'unknown') : 'unknown';
const charactersLeft = sub.ok && Number.isFinite(sub.json?.character_limit) ? Math.max(0, sub.json.character_limit - (sub.json.character_count ?? 0)) : null;
const free = tier === 'free';

const voices = [];
let token = '';
for (let page = 0; page < 4; page++) {
  const q = new URLSearchParams({ page_size: '100', include_total_count: 'false' });
  if (opts.search) q.set('search', String(opts.search));
  if (token) q.set('next_page_token', token);
  const r = await get(`/v2/voices?${q}`);
  if (!r.ok) {
    const msg = r.json?.detail?.message ?? r.text;
    if (r.status === 401 && /permission/i.test(String(msg))) {
      console.error('This ElevenLabs key may not read voices (missing "voices_read" permission). Give the key that permission in ElevenLabs, or pick a voice id the student gives you.');
    } else console.error(`ElevenLabs answered ${r.status} for the voice list: ${msg}`);
    process.exit(1);
  }
  for (const v of r.json?.voices ?? []) voices.push(v);
  token = r.json?.next_page_token ?? '';
  if (!r.json?.has_more || !token) break;
}

const lang = opts.language ? String(opts.language).toLowerCase() : null;
const out = voices.map((v) => {
  const labels = v.labels ?? {};
  const languages = [...new Set([...(v.verified_languages ?? []).map((l) => l.language), labels.language].filter(Boolean).map((l) => String(l).toLowerCase()))];
  const own = v.is_owner === true || ['cloned', 'generated'].includes(v.category) && v.sharing == null;
  const premade = v.category === 'premade';
  let usable = 'yes';
  if (!premade && !own && free) usable = v.sharing?.free_users_allowed === false ? 'paid_only' : 'maybe';
  return {
    voice_id: v.voice_id,
    name: v.name,
    category: v.category,
    gender: labels.gender ?? null,
    age: labels.age ?? null,
    accent: labels.accent ?? null,
    description: labels.descriptive ?? labels.description ?? null,
    use_case: labels.use_case ?? labels['use case'] ?? null,
    languages,
    models: v.high_quality_base_model_ids ?? [],
    usable,
  };
})
  // voices that match the wanted language first, then usable ones, then by name
  .sort((a, b) => (lang ? Number(b.languages.includes(lang)) - Number(a.languages.includes(lang)) : 0) || (a.usable === b.usable ? 0 : a.usable === 'yes' ? -1 : 1) || a.name.localeCompare(b.name));

console.log(JSON.stringify({ tier, charactersLeft, voices: out }));
