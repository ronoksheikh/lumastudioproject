import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertDialog, Card, Chip, Description, Input, Label, ProgressBar, Skeleton, Spinner, Tabs, TextField, toast } from '@heroui/react';
import { Button } from '../components/Button';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { ModelConfig, ReasoningEffort, TestResult, VoicePrefs } from '../api/types';
import { Icon } from '../components/Icon';
import { ModelPicker, ThinkingFields } from '../components/ModelFields';
import { AddonsTab } from '../components/Addons';
import { BuyRenderHours, fmtRenderTime } from '../components/BuyRenderHours';
import { useMe, useModels, useVoice } from '../lib/hooks';

const msg = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong');

/** Starting points, best first. Model ids change often: "Test connection" tells you right away if one is gone. */
const PRESETS: Array<{ name: string; baseUrl: string; model: string; vision: boolean; note: string }> = [
  { name: 'Claude Sonnet · OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-sonnet-4.5', vision: true, note: 'Best all-round choice: reliable tool calling, sees its own screenshots, strong at motion design.' },
  { name: 'GPT-4.1 · OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1', vision: true, note: 'Good tool calling and vision. A solid second choice.' },
  { name: 'gpt-oss-120b · Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b', vision: false, note: 'Very fast and cheap but cannot look at screenshots — Luma relies on its automatic layout checks, so expect more polish passes.' },
  { name: 'Qwen3 · Together', baseUrl: 'https://api.together.xyz/v1', model: 'Qwen/Qwen3-235B-A22B-Instruct-2507-tput', vision: false, note: 'Capable open model, no vision.' },
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', vision: false, note: 'Cheapest option, no vision. Fine for simple videos; check the result closely.' },
];

function Caps({ m }: { m: Pick<ModelConfig, 'supportsTools' | 'supportsVision' | 'supportsReasoningStream'> }) {
  const chip = (on: boolean, label: string) => (
    <Chip size="sm" color={on ? 'success' : 'default'}><Chip.Label>{on ? '✓' : '–'} {label}</Chip.Label></Chip>
  );
  return <div className="flex flex-wrap gap-1.5">{chip(m.supportsTools, 'Tool calling')}{chip(m.supportsVision, 'Vision')}{chip(m.supportsReasoningStream, 'Live thinking')}</div>;
}

function ResultBox({ r }: { r: TestResult }) {
  return (
    <div role="status" className={`rounded-xl border p-3 text-sm ${r.ok ? 'border-[#bfe3cc] bg-[#f1fbf5]' : 'border-[#f3c5c5] bg-[#fdf2f2]'}`}>
      <p className="font-semibold">{r.ok ? `Works — answered in ${(r.latencyMs / 1000).toFixed(1)} s` : 'This model can’t be used yet'}</p>
      {r.error && <p className="mt-1">{r.error}</p>}
      {r.notes.map((n) => <p key={n} className="mt-1 text-[#5b6b8f]">{n}</p>)}
      <div className="mt-2"><Caps m={r} /></div>
      {!r.supportsVision && r.ok && <p className="mt-2 text-xs text-[#5b6b8f]">Without vision, Luma can’t look at its own screenshots. A vision model gives better videos.</p>}
    </div>
  );
}

function AddModel({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [contextWindow, setContextWindow] = useState<number | undefined>(undefined);
  const [thinking, setThinking] = useState<{ reasoningEffort: ReasoningEffort | null; thinkingBudget: number | null }>({ reasoningEffort: null, thinkingBudget: null });
  const [result, setResult] = useState<TestResult | null>(null);
  const [preset, setPreset] = useState<(typeof PRESETS)[number] | null>(null);
  const qc = useQueryClient();
  const ready = baseUrl && apiKey && model;

  const test = useMutation({ mutationFn: () => api.testModelValues({ baseUrl, apiKey, model }), onSuccess: (r) => setResult(r.result), onError: (e) => toast.danger(msg(e)) });
  const save = useMutation({
    mutationFn: async () => {
      const { model: saved } = await api.addModel({ name: name || model, baseUrl, apiKey, model, ...(contextWindow ? { contextWindow: Math.max(4096, contextWindow) } : {}), ...thinking });
      await api.testModel(saved.id); // stores what the model supports
      return saved;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['models'] });
      toast.success('Model saved');
      onDone();
    },
    onError: (e) => toast.danger(msg(e)),
  });

  return (
    <Card className="p-2">
      <Card.Header>
        <Card.Title>Add a model</Card.Title>
        <Card.Description>Any OpenAI-compatible endpoint works: OpenRouter, OpenAI, Together, Groq, DeepSeek, a self-hosted vLLM… It must support tool calling.</Card.Description>
      </Card.Header>
      <Card.Content className="flex flex-col gap-4">
        <div>
          <p className="mb-2 text-sm font-semibold text-[#1557d1]">Recommended starting points</p>
          <div className="flex flex-wrap gap-2" aria-label="Presets">
            {PRESETS.map((p) => (
              <Button key={p.name} size="sm" variant={preset === p ? 'primary' : 'secondary'} onPress={() => { setPreset(p); setName(p.name); setBaseUrl(p.baseUrl); setModel(p.model); setResult(null); }}>{p.name}</Button>
            ))}
          </div>
          {preset && (
            <p className="mt-2 text-sm text-[#5b6b8f]" role="note">
              <b>{preset.vision ? 'Sees images.' : 'No vision.'}</b> {preset.note}
            </p>
          )}
        </div>
        <TextField value={name} onChange={setName}><Label>Name</Label><Input placeholder="My OpenRouter model" /></TextField>
        <TextField value={baseUrl} onChange={(v) => { setBaseUrl(v); setResult(null); }} isRequired>
          <Label>Base URL</Label><Input placeholder="https://openrouter.ai/api/v1" autoComplete="off" />
          <Description>Usually ends in /v1</Description>
        </TextField>
        <TextField type="password" value={apiKey} onChange={(v) => { setApiKey(v); setResult(null); }} isRequired>
          <Label>API key</Label><Input placeholder="sk-…" autoComplete="off" />
          <Description>Stored encrypted. Only the last 4 characters are ever shown again.</Description>
        </TextField>
        <ModelPicker baseUrl={baseUrl} apiKey={apiKey} value={model} onChange={(v) => { setModel(v); setResult(null); }} onContext={setContextWindow} />
        <ThinkingFields effort={thinking.reasoningEffort} budget={thinking.thinkingBudget} onChange={setThinking} />
        {result && <ResultBox r={result} />}
      </Card.Content>
      <Card.Footer className="justify-end gap-2">
        <Button variant="tertiary" onPress={onDone}>Cancel</Button>
        <Button variant="secondary" isDisabled={!ready || test.isPending} onPress={() => test.mutate()}>{test.isPending ? <Spinner size="sm" /> : 'Test connection'}</Button>
        <Button variant="primary" isDisabled={!ready || save.isPending} onPress={() => save.mutate()}>{save.isPending ? <Spinner size="sm" color="current" /> : 'Save model'}</Button>
      </Card.Footer>
    </Card>
  );
}

function ModelRow({ m }: { m: ModelConfig }) {
  const qc = useQueryClient();
  const [result, setResult] = useState<TestResult | null>(null);
  const [confirm, setConfirm] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['models'] });
  const test = useMutation({ mutationFn: () => api.testModel(m.id), onSuccess: (r) => { setResult(r.result); void refresh(); }, onError: (e) => toast.danger(msg(e)) });
  const makeDefault = useMutation({ mutationFn: () => api.updateModel(m.id, { isDefault: true }), onSuccess: () => void refresh() });
  const saveThinking = useMutation({
    mutationFn: (v: { reasoningEffort: ReasoningEffort | null; thinkingBudget: number | null }) => api.updateModel(m.id, v),
    onSuccess: () => void refresh(),
    onError: (e) => toast.danger(msg(e)),
  });
  const remove = useMutation({ mutationFn: () => api.deleteModel(m.id), onSuccess: () => void refresh(), onError: (e) => toast.danger(msg(e)) });
  return (
    <Card className="p-2">
      <Card.Header className="flex-row items-start justify-between gap-3">
        <div className="min-w-0">
          <Card.Title className="flex items-center gap-2">{m.name}{m.isDefault && <Chip size="sm" color="accent"><Chip.Label>Default</Chip.Label></Chip>}</Card.Title>
          <Card.Description className="truncate"><span className="mono">{m.model}</span> · {m.baseUrl}</Card.Description>
          <p className="mono mt-1 text-xs text-[#5b6b8f]">key {m.apiKeyHint}</p>
        </div>
        <Caps m={m} />
      </Card.Header>
      {!m.supportsTools && !result && <Card.Content><p className="text-sm text-[#7a4a00]">Not tested yet — press “Test” before using this model.</p></Card.Content>}
      <Card.Content>
        <details>
          <summary className="cursor-pointer text-sm font-medium text-[#1557d1]">Thinking: {m.reasoningEffort ? `effort ${m.reasoningEffort}` : 'provider default'}{m.thinkingBudget != null ? ` · budget ${m.thinkingBudget.toLocaleString()} tokens` : ''}</summary>
          <div className="mt-3">
            <ThinkingFields
              effort={m.reasoningEffort}
              budget={m.thinkingBudget}
              onChange={(v) => saveThinking.mutate(v)}
            />
          </div>
        </details>
      </Card.Content>
      {result && <Card.Content><ResultBox r={result} /></Card.Content>}
      <Card.Footer className="justify-end gap-2">
        {!m.isDefault && <Button size="sm" variant="tertiary" onPress={() => makeDefault.mutate()}>Make default</Button>}
        <Button size="sm" variant="secondary" isDisabled={test.isPending} onPress={() => test.mutate()}>{test.isPending ? <Spinner size="sm" /> : 'Test'}</Button>
        <Button size="sm" variant="danger-soft" onPress={() => setConfirm(true)}>Delete</Button>
      </Card.Footer>
      <AlertDialog.Backdrop isOpen={confirm} onOpenChange={setConfirm}>
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-[400px]">
            <AlertDialog.Header><AlertDialog.Icon status="danger" /><AlertDialog.Heading>Remove “{m.name}”?</AlertDialog.Heading></AlertDialog.Header>
            <AlertDialog.Body><p>The saved key is deleted from Luma Studio.</p></AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="tertiary">Cancel</Button>
              <Button slot="close" variant="danger" onPress={() => remove.mutate()}>Remove</Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </Card>
  );
}

function ModelsTab() {
  const models = useModels();
  const [adding, setAdding] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[#5b6b8f]">Luma uses <b>your</b> model. It needs tool calling and a long context; a vision model is strongly recommended.</p>
        {!adding && <Button variant="primary" onPress={() => setAdding(true)}><Icon name="plus" /> Add model</Button>}
      </div>
      {adding && <AddModel onDone={() => setAdding(false)} />}
      {models.isLoading && <Skeleton className="h-32 rounded-2xl" />}
      {models.data?.map((m) => <ModelRow key={m.id} m={m} />)}
      {models.data?.length === 0 && !adding && <p className="rounded-2xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[#5b6b8f]">No models yet. Add one to start making videos.</p>}
    </div>
  );
}

/** An optional number: empty = not set (Luma chooses). */
function OptNum({ label, value, onChange, min, max, step, hint }: { label: string; value: number | null; onChange: (n: number | null) => void; min: number; max: number; step: number; hint?: string }) {
  return (
    <TextField value={value == null ? '' : String(value)} onChange={(v) => onChange(v.trim() === '' ? null : Math.min(max, Math.max(min, Number(v) || min)))} type="number">
      <Label>{label}</Label>
      <Input min={min} max={max} step={step} inputMode="decimal" placeholder="Luma chooses" />
      {hint && <Description>{hint}</Description>}
    </TextField>
  );
}

const MODELS: Array<[string, string]> = [
  ['', 'Let Luma choose'],
  ['eleven_v4', 'eleven_v4 — newest, 90+ languages incl. Bengali'],
  ['eleven_v3', 'eleven_v3 — expressive, 70+ languages incl. Bengali'],
  ['eleven_multilingual_v2', 'eleven_multilingual_v2 — stable, 29 languages (no Bengali)'],
  ['eleven_flash_v2_5', 'eleven_flash_v2_5 — fastest, cheapest'],
];

function VoiceTab() {
  const voice = useVoice();
  const qc = useQueryClient();
  const [key, setKey] = useState('');
  const [prefs, setPrefs] = useState<VoicePrefs | null>(null);
  const [test, setTest] = useState<string | null>(null);
  const p = prefs ?? voice.data?.prefs;
  const save = useMutation({
    mutationFn: (next?: VoicePrefs) => api.saveVoice({ ...(key ? { apiKey: key } : {}), ...(next ?? prefs ? { prefs: (next ?? prefs)! } : {}) }),
    onSuccess: (r) => { qc.setQueryData(['voice'], r); setKey(''); setPrefs(null); toast.success('Voice settings saved'); },
    onError: (e) => toast.danger(msg(e)),
  });
  const check = useMutation({
    mutationFn: () => api.testVoice(),
    onSuccess: (r) => setTest(r.ok
      ? `Key works${r.tier ? ` — ${r.tier} plan` : ''}${r.characterLimit ? `, ${Math.max(0, r.characterLimit - (r.charactersUsed ?? 0)).toLocaleString()} characters left` : ''}.${r.tier === 'free' ? ' On the free plan Luma sticks to premade voices.' : ''}${r.note ? ` ${r.note}` : ''}`
      : r.error ?? 'The key was rejected.'),
    onError: (e) => setTest(msg(e)),
  });
  const removeKey = useMutation({ mutationFn: () => api.deleteVoiceKey(), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['voice'] }); setTest(null); } });
  if (!voice.data || !p) return <Skeleton className="h-64 rounded-2xl" />;
  const set = (patch: Partial<VoicePrefs>) => setPrefs({ ...p, ...patch });
  const anySet = Object.values(voice.data.prefs).some((v) => v != null);
  const text = (v: string) => (v.trim() === '' ? null : v.trim());

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-2">
        <Card.Header><Card.Title>ElevenLabs API key</Card.Title><Card.Description>Used for voiceovers. It stays on the server and is never shown to the model or sent to your browser.</Card.Description></Card.Header>
        <Card.Content className="flex flex-col gap-3">
          {voice.data.hasKey && <p className="text-sm">Saved key: <span className="mono rounded bg-[#eff5ff] px-1.5 py-0.5">{voice.data.keyHint}</span></p>}
          <TextField type="password" value={key} onChange={setKey}>
            <Label>{voice.data.hasKey ? 'Replace key' : 'API key'}</Label>
            <Input placeholder="Paste your ElevenLabs key" autoComplete="off" />
          </TextField>
          {test && <p role="status" className="text-sm text-[#5b6b8f]">{test}</p>}
        </Card.Content>
        <Card.Footer className="justify-end gap-2">
          {voice.data.hasKey && <Button size="sm" variant="danger-soft" onPress={() => removeKey.mutate()}>Remove key</Button>}
          {voice.data.hasKey && <Button size="sm" variant="secondary" isDisabled={check.isPending} onPress={() => check.mutate()}>Test key</Button>}
          <Button size="sm" variant="primary" isDisabled={!key || save.isPending} onPress={() => save.mutate(undefined)}>Save</Button>
        </Card.Footer>
      </Card>

      <Card className="p-2">
        <Card.Header>
          <Card.Title>Voice overrides <span className="text-sm font-normal text-[#5b6b8f]">(optional)</span></Card.Title>
          <Card.Description>Leave these empty and Luma picks a voice and model that fit each video’s language and tone, from the voices your ElevenLabs account can use. Anything you fill in here is used for all your videos instead.</Card.Description>
        </Card.Header>
        <Card.Content className="grid gap-4 sm:grid-cols-2">
          <TextField value={p.voiceId ?? ''} onChange={(v) => set({ voiceId: text(v) })}><Label>Voice ID</Label><Input className="mono" placeholder="Luma chooses" /><Description>From your ElevenLabs voices page</Description></TextField>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium" htmlFor="voice-model">Model</label>
            <select id="voice-model" value={p.modelId ?? ''} onChange={(e) => set({ modelId: e.target.value || null })} className="h-10 rounded-xl border border-[var(--border)] bg-white px-3 text-sm outline-none focus:border-[#2970ec]">
              {MODELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <TextField value={p.languageCode ?? ''} onChange={(v) => set({ languageCode: text(v) })}><Label>Language code</Label><Input className="mono" placeholder="Luma chooses (e.g. bn, en)" /></TextField>
          <OptNum label="Speed" value={p.speed} onChange={(n) => set({ speed: n })} min={0.7} max={1.2} step={0.05} hint="0.7 – 1.2" />
          <OptNum label="Extra tempo" value={p.tempo} onChange={(n) => set({ tempo: n })} min={1} max={1.5} step={0.05} hint="1.05–1.1 makes fast ads snappier" />
          <OptNum label="Stability" value={p.stability} onChange={(n) => set({ stability: n })} min={0} max={1} step={0.05} />
        </Card.Content>
        <Card.Footer className="justify-end gap-2">
          {anySet && <Button variant="tertiary" isDisabled={save.isPending} onPress={() => save.mutate({ voiceId: null, modelId: null, languageCode: null, speed: null, tempo: null, stability: null, similarityBoost: null, style: null })}>Clear all — let Luma choose</Button>}
          <Button variant="primary" isDisabled={!prefs || save.isPending} onPress={() => save.mutate(undefined)}>Save overrides</Button>
        </Card.Footer>
      </Card>
    </div>
  );
}

const fmtBytes = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1024 ** 2))} MB`);

function UsageCard() {
  const q = useQuery({ queryKey: ['usage'], queryFn: () => api.usage().then((r) => r.usage), staleTime: 30_000 });
  const u = q.data;
  if (!u) return null;
  return (
    <Card className="max-w-lg p-2">
      <Card.Header><Card.Title>Your storage</Card.Title><Card.Description>Projects, uploads and renders share one storage allowance.</Card.Description></Card.Header>
      <Card.Content className="flex flex-col gap-4">
        <div>
          <div className="mb-1 flex justify-between text-sm"><span>Storage</span><span className="mono text-[#5b6b8f]">{fmtBytes(u.diskBytes)}{u.diskLimitBytes ? ` of ${fmtBytes(u.diskLimitBytes)}` : ''}</span></div>
          {u.diskLimitBytes ? (
            <ProgressBar value={Math.min(100, (u.diskBytes / u.diskLimitBytes) * 100)} aria-label="Storage" color={u.diskBytes / u.diskLimitBytes > 0.9 ? 'danger' : 'accent'}>
              <ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track>
            </ProgressBar>
          ) : null}
        </div>
      </Card.Content>
    </Card>
  );
}

/** Paid hours on the fast render servers. Payment processing comes later: a purchase is saved as pending. */
function FastRenderCard() {
  const q = useQuery({ queryKey: ['usage'], queryFn: () => api.usage().then((r) => r.usage), staleTime: 30_000 });
  const u = q.data;
  if (!u) return null;
  const free = u.freeRender;
  const fast = u.fastRender;
  return (
    <Card className="max-w-lg p-2" id="render-time">
      <Card.Header>
        <Card.Title className="flex items-center gap-2"><Icon name="lightning" /> Render time</Card.Title>
        <Card.Description>Every day you get free render time on our server. Fast render hours run on powerful render servers and never expire. When you have both, Luma asks which one to use.</Card.Description>
      </Card.Header>
      <Card.Content className="flex flex-col gap-4 text-sm">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-[#eff5ff] p-3">
            <p className="text-xs text-[#5b6b8f]">Free today</p>
            <p className="text-lg font-bold text-[#1557d1]">{free.secondsLeft == null ? 'Unlimited' : fmtRenderTime(free.secondsLeft)}</p>
            {free.secondsPerDay && <p className="text-xs text-[#5b6b8f]">of {fmtRenderTime(free.secondsPerDay)} per 24 h</p>}
          </div>
          <div className="rounded-xl bg-[#eff5ff] p-3">
            <p className="text-xs text-[#5b6b8f]">Fast hours</p>
            <p className="text-lg font-bold text-[#1557d1]">{fmtRenderTime(fast.secondsLeft)}</p>
            <p className="text-xs text-[#5b6b8f]">left, no expiry</p>
          </div>
        </div>
        <BuyRenderHours pricePerHourBdt={fast.pricePerHourBdt} maxHours={fast.maxHours} paymentsEnabled={fast.paymentsEnabled} returnTo="/settings/account" />
      </Card.Content>
    </Card>
  );
}

/** Settings → Agent: the student's own instructions for Luma — added to Luma's prompt, or replacing it. */
function AgentTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['agent-prompt'], queryFn: () => api.agentPrompt() });
  const [draft, setDraft] = useState<{ mode: 'append' | 'replace'; text: string } | null>(null);
  const [showDefault, setShowDefault] = useState(false);
  const save = useMutation({
    mutationFn: (p: { mode: 'append' | 'replace'; text: string } | null) => api.saveAgentPrompt(p),
    onSuccess: (r) => { qc.setQueryData(['agent-prompt'], r); setDraft(null); toast.success(r.prompt ? 'Saved — used from the next message on' : 'Back to Luma’s own prompt'); },
    onError: (e) => toast.danger(msg(e)),
  });
  const savePrefs = useMutation({
    mutationFn: (frameChecks: 'full' | 'light' | 'off') => api.saveAgentPrefs({ frameChecks }),
    onSuccess: (r) => { qc.setQueryData(['agent-prompt'], r); toast.success('Saved — used from the next message on'); },
    onError: (e) => toast.danger(msg(e)),
  });
  if (!q.data) return <Skeleton className="h-40 max-w-2xl rounded-2xl" />;
  const cur = draft ?? q.data.prompt ?? { mode: 'append' as const, text: '' };
  const set = (patch: Partial<typeof cur>) => setDraft({ ...cur, ...patch });
  const modeBtn = (m: 'append' | 'replace', label: string) => (
    <Button size="sm" variant={cur.mode === m ? 'primary' : 'tertiary'} onPress={() => set({ mode: m })}>{label}</Button>
  );
  return (
    <div className="flex flex-col gap-4">
      <Card className="max-w-2xl p-2">
        <Card.Header>
          <Card.Title className="flex items-center gap-2"><Icon name="image" /> Frame checks</Card.Title>
          <Card.Description>Luma takes screenshots of the video to check its own work. That gives the best results but uses a lot of your model’s tokens. Turn it down to save tokens — then you watch the preview and tell Luma what to fix.</Card.Description>
        </Card.Header>
        <Card.Content className="flex flex-col gap-2">
          {([
            ['full', 'Full', 'Luma checks every scene with screenshots (best quality).'],
            ['light', 'Light', 'One round of screenshots per message.'],
            ['off', 'Off', 'No screenshots. Luma runs quick code checks, then asks you to watch the preview.'],
          ] as const).map(([v, label, hint]) => (
            <label key={v} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${q.data.prefs.frameChecks === v ? 'border-[#2970EC] bg-[#eff5ff]' : 'border-[#d6e2f5]'}`}>
              <input type="radio" name="frame-checks" className="mt-1 accent-[#2970EC]" checked={q.data.prefs.frameChecks === v} disabled={savePrefs.isPending} onChange={() => savePrefs.mutate(v)} />
              <span><span className="font-semibold">{label}</span><span className="block text-sm text-[#5b6b8f]">{hint}</span></span>
            </label>
          ))}
        </Card.Content>
      </Card>
      <Card className="max-w-2xl p-2">
        <Card.Header>
          <Card.Title className="flex items-center gap-2"><Icon name="robot" /> Your instructions for Luma</Card.Title>
          <Card.Description>Tell Luma how you like to work: your style, language, brand habits, things to always or never do. Applies to all your projects from the next message on.</Card.Description>
        </Card.Header>
        <Card.Content className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">{modeBtn('append', 'Add to Luma’s prompt')}{modeBtn('replace', 'Replace Luma’s prompt')}</div>
          {cur.mode === 'replace' && <p className="text-sm text-[#5b6b8f]">Your text becomes the whole system prompt. The project facts, tools and engine guides are still provided. Start from Luma’s prompt below if you only want to change parts. Placeholders {'{aspect} {width} {height} {brand_summary} {attachments_summary}'} are filled in.</p>}
          <textarea
            className="mono min-h-56 w-full rounded-xl border border-[#d6e2f5] bg-white p-3 text-[13px] leading-relaxed outline-none focus:border-[#2970EC] max-md:text-base"
            placeholder={cur.mode === 'append' ? 'e.g. Always make 9:16 reels. Write on-screen text in English, voice in Bengali. Prefer white stages with blue type.' : 'Your full system prompt…'}
            value={cur.text}
            onChange={(e) => set({ text: e.target.value })}
            aria-label="Your instructions for Luma"
          />
        </Card.Content>
        <Card.Footer className="flex-wrap justify-end gap-2">
          {cur.mode === 'replace' && !cur.text.trim() && <Button variant="tertiary" onPress={() => set({ text: q.data.defaultPrompt })}>Start from Luma’s prompt</Button>}
          {q.data.prompt && <Button variant="tertiary" isDisabled={save.isPending} onPress={() => save.mutate(null)}>Reset to Luma’s prompt</Button>}
          <Button variant="primary" isDisabled={save.isPending || !draft} onPress={() => save.mutate(cur.text.trim() ? cur : null)}>Save</Button>
        </Card.Footer>
      </Card>
      <Card className="max-w-2xl p-2">
        <Card.Header>
          <button type="button" className="flex items-center gap-2 text-left font-semibold" onClick={() => setShowDefault((v) => !v)} aria-expanded={showDefault}>
            <Icon name={showDefault ? 'down' : 'chevron'} /> Luma’s built-in prompt
          </button>
        </Card.Header>
        {showDefault && <Card.Content><pre className="mono max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-xl bg-[#f5f8fe] p-3 text-xs">{q.data.defaultPrompt}</pre></Card.Content>}
      </Card>
    </div>
  );
}

function AccountTab() {
  const me = useMe();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const change = useMutation({ mutationFn: () => api.changePassword(cur, next), onSuccess: () => { toast.success('Password changed. Other devices were signed out.'); setCur(''); setNext(''); }, onError: (e) => toast.danger(msg(e)) });
  return (
    <div className="flex flex-col gap-4">
    <UsageCard />
    <FastRenderCard />
    <Card className="max-w-lg p-2">
      <Card.Header><Card.Title>Account</Card.Title><Card.Description>Signed in as <b>{me.data?.user?.email}</b></Card.Description></Card.Header>
      <Card.Content className="flex flex-col gap-4">
        <TextField type="password" value={cur} onChange={setCur}><Label>Current password</Label><Input autoComplete="current-password" /></TextField>
        <TextField type="password" value={next} onChange={setNext} isInvalid={next.length > 0 && next.length < 8}><Label>New password</Label><Input autoComplete="new-password" /><Description>At least 8 characters</Description></TextField>
      </Card.Content>
      <Card.Footer className="justify-end"><Button variant="primary" isDisabled={!cur || next.length < 8 || change.isPending} onPress={() => change.mutate()}>Change password</Button></Card.Footer>
    </Card>
    </div>
  );
}

const TABS: Array<[string, string, ReactNode]> = [
  ['models', 'Models', <ModelsTab key="m" />],
  ['voice', 'Voice', <VoiceTab key="v" />],
  ['agent', 'Agent', <AgentTab key="g" />],
  ['addons', 'Add-ons', <AddonsTab key="d" />],
  ['account', 'Account', <AccountTab key="a" />],
];

export function SettingsPage() {
  const { tab = 'models' } = useParams();
  const nav = useNavigate();
  return (
    <div className="scroll-y h-full">
      <div className="mx-auto max-w-3xl px-4 py-6 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-8">
        <Link to="/" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-[#5b6b8f] hover:text-[#2970ec]"><Icon name="chevron" size={14} className="rotate-180" /> Your videos</Link>
        <h1 className="mb-4 text-2xl font-bold text-[#1557d1]">Settings</h1>
        <Tabs selectedKey={tab} onSelectionChange={(k) => nav(`/settings/${String(k)}`)} variant="secondary">
          <Tabs.ListContainer className="scroll-x overflow-x-auto">
            <Tabs.List aria-label="Settings sections">
              {TABS.map(([id, label]) => <Tabs.Tab key={id} id={id}>{label}<Tabs.Indicator /></Tabs.Tab>)}
            </Tabs.List>
          </Tabs.ListContainer>
          {TABS.map(([id, , body]) => <Tabs.Panel key={id} id={id} className="pt-5">{body}</Tabs.Panel>)}
        </Tabs>
      </div>
    </div>
  );
}
