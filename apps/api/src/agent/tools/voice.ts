import fs from 'node:fs';
import path from 'node:path';
import type { ToolArgs } from '@luma/shared';
import { fail, ok, type ToolContext, type ToolResult } from './types.js';
import { runPristineScript } from './scripts.js';
import { describeOverrides, getVoicePrefs, voiceOverrides } from '../../settings/service.js';

/**
 * Settings → Voice overrides the student set win over the agent's choice: write them into script.json before
 * every generation and tell the model what was applied. Returns a note (or '').
 */
function applyOverrides(ctx: ToolContext, scriptFile: string): string {
  const prefs = getVoicePrefs(ctx.db, ctx.userId);
  const o = voiceOverrides(prefs);
  if (!o.voice && !o.settings) return '';
  const script = readJson<{ voice?: Record<string, unknown> & { voice_settings?: Record<string, unknown> } }>(scriptFile);
  const voice = { ...(script.voice ?? {}), ...(o.voice ?? {}) };
  if (o.settings) voice.voice_settings = { ...(script.voice?.voice_settings ?? {}), ...o.settings };
  script.voice = voice;
  fs.writeFileSync(scriptFile, JSON.stringify(script, null, 2) + '\n');
  if (typeof process.getuid === 'function' && process.getuid() === 0 && ctx.project.uid != null) fs.chownSync(scriptFile, ctx.project.uid, ctx.project.uid);
  return `The student's Settings → Voice overrides were applied to script.json (they win over your choice): ${describeOverrides(prefs)}.`;
}

interface VoiceList {
  tier: string;
  charactersLeft: number | null;
  voices: Array<{ voice_id: string; name: string; category: string; gender: string | null; age: string | null; accent: string | null; description: string | null; use_case: string | null; languages: string[]; models: string[]; usable: 'yes' | 'maybe' | 'paid_only' }>;
}

export async function listVoices(ctx: ToolContext, a: ToolArgs<'list_voices'>): Promise<ToolResult> {
  const key = ctx.elevenKey();
  if (!key) return fail('No ElevenLabs API key is saved for this student. Tell them to add it in Settings → Voice; meanwhile use generate_voice with placeholder:true.');
  const args = ['--key-stdin', ...(a.language ? ['--language', a.language] : []), ...(a.search ? ['--search', a.search] : [])];
  const r = await runPristineScript(ctx.project, 'list-voices.mjs', args, { stdin: key, signal: ctx.signal, secrets: ctx.secrets, timeoutMs: 60_000 });
  const line = r.output.trim().split('\n').filter((l) => l.startsWith('{')).pop();
  if (r.code !== 0 || !line) return fail(`Could not list voices:\n${r.output.slice(-800)}`);
  const list = JSON.parse(line) as VoiceList;
  const shown = list.voices.slice(0, 60);
  const rows = shown.map((v) => {
    const traits = [v.gender, v.age, v.accent, v.description, v.use_case].filter(Boolean).join(', ');
    const usable = v.usable === 'yes' ? '' : v.usable === 'paid_only' ? '  [NOT on this plan]' : '  [library voice: may be refused on the free plan]';
    return `- ${v.name} — ${v.voice_id} — ${v.category}${traits ? ` — ${traits}` : ''}${v.languages.length ? ` — languages: ${v.languages.join('/')}` : ''}${usable}`;
  });
  const plan = `ElevenLabs plan: ${list.tier}${list.charactersLeft != null ? `, ${list.charactersLeft.toLocaleString('en-US')} characters left this period` : ''}.`;
  const freeNote = list.tier === 'free' ? '\nFree plan: prefer "premade" voices; some library voices and features are paid-only. Keep the script short — characters are limited.' : '';
  const prefs = describeOverrides(getVoicePrefs(ctx.db, ctx.userId));
  const overrideNote = prefs ? `\nThe student set voice overrides in Settings (applied automatically when you generate): ${prefs}.` : '';
  const more = list.voices.length > shown.length ? `\n…and ${list.voices.length - shown.length} more (use search).` : '';
  return ok(`${plan}${freeNote}${overrideNote}\n${rows.join('\n') || '(no voices)'}${more}`, `${list.voices.length} voices · ${list.tier} plan`);
}

interface Timing {
  duration: number;
  placeholder?: boolean;
  segments: Array<{ id: string; text: string; start: number; end: number; words: Array<{ w: string; start: number; end: number }> }>;
}

const readJson = <T>(file: string): T => JSON.parse(fs.readFileSync(file, 'utf8')) as T;

/** Every word with its start time — what the model needs to put visuals on words. */
export function timingForModel(t: Timing, maxChars = 24_000): string {
  const lines = [`duration: ${t.duration}s${t.placeholder ? ' (PLACEHOLDER: silent audio with evenly spaced words)' : ''}`, 'Use ctx.w(segmentId, wordIndex) → start time (s). Format: index:word@start'];
  for (const s of t.segments) {
    lines.push(`\n[${s.id}] ${s.start.toFixed(2)}–${s.end.toFixed(2)}s  ${s.words.length} words`);
    lines.push(s.words.map((w, i) => `${i}:${w.w}@${w.start.toFixed(2)}`).join('  '));
  }
  const text = lines.join('\n');
  return text.length > maxChars ? text.slice(0, maxChars) + '\n…[truncated — read public/audio/timing.json for the rest]' : text;
}

function emitReady(ctx: ToolContext, t: Timing) {
  ctx.bus.emit('voice.ready', {
    duration: t.duration,
    segments: t.segments.map((s) => ({ id: s.id, start: s.start, end: s.end })),
    audioUrl: 'audio/voiceover.mp3',
    ...(t.placeholder ? { placeholder: true } : {}),
  });
}

export async function generateVoice(ctx: ToolContext, a: ToolArgs<'generate_voice'>): Promise<ToolResult> {
  const scriptFile = path.join(ctx.project.dir, 'script.json');
  if (a.segments) {
    try {
      // a new project has no script.json yet: start one (the voice settings are chosen separately)
      const script = fs.existsSync(scriptFile) ? readJson<{ segments: unknown; voice?: unknown }>(scriptFile) : { voice: {}, segments: [] as unknown };
      script.segments = a.segments;
      fs.writeFileSync(scriptFile, JSON.stringify(script, null, 2) + '\n');
      if (typeof process.getuid === 'function' && process.getuid() === 0 && ctx.project.uid != null) fs.chownSync(scriptFile, ctx.project.uid, ctx.project.uid);
    } catch (e) {
      return fail(`Could not update script.json: ${(e as Error).message}`);
    }
  }
  if (!fs.existsSync(scriptFile)) return fail('script.json does not exist yet. Write it first (voice settings + one segment per scene — read_guide("voice")), or pass segments.');
  let note = '';
  try {
    note = applyOverrides(ctx, scriptFile);
  } catch (e) {
    return fail(`Could not read script.json: ${(e as Error).message}`);
  }
  const key = ctx.elevenKey();
  if (!key && !a.placeholder) {
    return fail('No ElevenLabs API key is saved for this student. Tell them to add it in Settings → Voice, and meanwhile call generate_voice with placeholder:true (silent audio with evenly spaced word timings) so the visuals can be built and previewed.');
  }
  const args = a.placeholder ? ['--placeholder'] : ['--key-stdin'];
  const r = await runPristineScript(ctx.project, 'generate-voice.mjs', args, {
    stdin: a.placeholder ? '' : key!,
    signal: ctx.signal,
    secrets: ctx.secrets,
    timeoutMs: 240_000,
    onOutput: (text) => ctx.bus.delta('tool.output.delta', { callId: ctx.callId, stream: 'stdout', text }),
  });
  ctx.bus.flushDeltas();
  if (r.code !== 0) return fail(`Voice generation failed:\n${r.output}`);
  try {
    const t = readJson<Timing>(path.join(ctx.project.dir, 'public/audio/timing.json'));
    emitReady(ctx, t);
    return ok(`${note ? `${note}\n` : ''}${timingForModel(t)}`, `${t.duration}s, ${t.segments.reduce((n, s) => n + s.words.length, 0)} words${t.placeholder ? ' (placeholder)' : ''}`);
  } catch (e) {
    return fail(`Voice was generated but timing.json could not be read: ${(e as Error).message}`);
  }
}

export async function patchVoice(ctx: ToolContext, a: ToolArgs<'patch_voice'>): Promise<ToolResult> {
  const key = ctx.elevenKey();
  if (!key) return fail('No ElevenLabs API key is saved for this student — ask them to add it in Settings → Voice.');
  // no Settings overrides here: a patched line must sound like the rest, which was recorded with script.json's voice
  const r = await runPristineScript(ctx.project, 'patch-voice.mjs', [a.segment_id, '--key-stdin'], {
    stdin: key,
    signal: ctx.signal,
    secrets: ctx.secrets,
    timeoutMs: 240_000,
    onOutput: (text) => ctx.bus.delta('tool.output.delta', { callId: ctx.callId, stream: 'stdout', text }),
  });
  ctx.bus.flushDeltas();
  if (r.code !== 0) return fail(`Patching the voice failed:\n${r.output}`);
  try {
    const t = readJson<Timing>(path.join(ctx.project.dir, 'public/audio/timing.json'));
    emitReady(ctx, t);
    return ok(`${r.output.trim()}\n\n${timingForModel(t)}`, `patched ${a.segment_id}`);
  } catch (e) {
    return fail(`Patched, but timing.json could not be read: ${(e as Error).message}`);
  }
}
