import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertDialog, Button, Card, Chip, Description, Input, Label, ProgressBar, Skeleton, Spinner, Tabs, TextField, toast } from '@heroui/react';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { ModelConfig, TestResult, VoicePrefs } from '../api/types';
import { Icon } from '../components/Icon';
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
  const [result, setResult] = useState<TestResult | null>(null);
  const [preset, setPreset] = useState<(typeof PRESETS)[number] | null>(null);
  const qc = useQueryClient();
  const ready = baseUrl && apiKey && model;

  const test = useMutation({ mutationFn: () => api.testModelValues({ baseUrl, apiKey, model }), onSuccess: (r) => setResult(r.result), onError: (e) => toast.danger(msg(e)) });
  const save = useMutation({
    mutationFn: async () => {
      const { model: saved } = await api.addModel({ name: name || model, baseUrl, apiKey, model });
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
        <TextField value={model} onChange={(v) => { setModel(v); setResult(null); }} isRequired>
          <Label>Model</Label><Input placeholder="anthropic/claude-sonnet-4.5" autoComplete="off" />
        </TextField>
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

function Num({ label, value, onChange, min, max, step, hint }: { label: string; value: number; onChange: (n: number) => void; min: number; max: number; step: number; hint?: string }) {
  return (
    <TextField value={String(value)} onChange={(v) => onChange(Math.min(max, Math.max(min, Number(v) || min)))} type="number">
      <Label>{label}</Label>
      <Input min={min} max={max} step={step} inputMode="decimal" />
      {hint && <Description>{hint}</Description>}
    </TextField>
  );
}

function VoiceTab() {
  const voice = useVoice();
  const qc = useQueryClient();
  const [key, setKey] = useState('');
  const [prefs, setPrefs] = useState<VoicePrefs | null>(null);
  const [test, setTest] = useState<string | null>(null);
  const p = prefs ?? voice.data?.prefs;
  const save = useMutation({
    mutationFn: () => api.saveVoice({ ...(key ? { apiKey: key } : {}), ...(prefs ? { prefs } : {}) }),
    onSuccess: (r) => { qc.setQueryData(['voice'], r); setKey(''); setPrefs(null); toast.success('Voice settings saved'); },
    onError: (e) => toast.danger(msg(e)),
  });
  const check = useMutation({ mutationFn: () => api.testVoice(), onSuccess: (r) => setTest(r.ok ? `Key works${r.tier ? ` (${r.tier} plan)` : ''}.` : r.error ?? 'The key was rejected.'), onError: (e) => setTest(msg(e)) });
  const removeKey = useMutation({ mutationFn: () => api.deleteVoiceKey(), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['voice'] }); setTest(null); } });
  if (!voice.data || !p) return <Skeleton className="h-64 rounded-2xl" />;

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
        </Card.Footer>
      </Card>

      <Card className="p-2">
        <Card.Header><Card.Title>Voice defaults</Card.Title><Card.Description>New projects start with these. You can always ask Luma to change a voice.</Card.Description></Card.Header>
        <Card.Content className="grid gap-4 sm:grid-cols-2">
          <TextField value={p.voiceId} onChange={(v) => setPrefs({ ...p, voiceId: v })}><Label>Voice ID</Label><Input className="mono" /><Description>Default: Sarah</Description></TextField>
          <TextField value={p.modelId} onChange={(v) => setPrefs({ ...p, modelId: v })}><Label>Model</Label><Input className="mono" /></TextField>
          <Num label="Speed" value={p.speed} onChange={(n) => setPrefs({ ...p, speed: n })} min={0.7} max={1.2} step={0.05} hint="ElevenLabs allows 0.7 – 1.2" />
          <Num label="Extra tempo" value={p.tempo} onChange={(n) => setPrefs({ ...p, tempo: n })} min={1} max={1.5} step={0.05} hint="1.05–1.1 for fast ads (time-stretch)" />
          <Num label="Stability" value={p.stability} onChange={(n) => setPrefs({ ...p, stability: n })} min={0} max={1} step={0.05} />
          <Num label="Similarity" value={p.similarityBoost} onChange={(n) => setPrefs({ ...p, similarityBoost: n })} min={0} max={1} step={0.05} />
        </Card.Content>
        <Card.Footer className="justify-end"><Button variant="primary" isDisabled={(!key && !prefs) || save.isPending} onPress={() => save.mutate()}>Save</Button></Card.Footer>
      </Card>
    </div>
  );
}

const fmtBytes = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1024 ** 2))} MB`);

function UsageCard() {
  const q = useQuery({ queryKey: ['usage'], queryFn: () => api.usage().then((r) => r.usage), staleTime: 30_000 });
  const u = q.data;
  if (!u) return null;
  const bar = (label: string, used: number, limit: number | null, text: string) => (
    <div>
      <div className="mb-1 flex justify-between text-sm"><span>{label}</span><span className="mono text-[#5b6b8f]">{text}</span></div>
      {limit ? (
        <ProgressBar value={Math.min(100, (used / limit) * 100)} aria-label={label} color={used / limit > 0.9 ? 'danger' : 'accent'}>
          <ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track>
        </ProgressBar>
      ) : null}
    </div>
  );
  return (
    <Card className="max-w-lg p-2">
      <Card.Header><Card.Title>Your allowance</Card.Title><Card.Description>Projects, uploads and renders share one storage allowance. Render time refills over 24 hours.</Card.Description></Card.Header>
      <Card.Content className="flex flex-col gap-4">
        {bar('Storage', u.diskBytes, u.diskLimitBytes, `${fmtBytes(u.diskBytes)}${u.diskLimitBytes ? ` of ${fmtBytes(u.diskLimitBytes)}` : ''}`)}
        {bar('Render time today', u.renderSecondsToday, u.renderSecondsLimit, `${Math.round(u.renderSecondsToday / 60)} min${u.renderSecondsLimit ? ` of ${Math.round(u.renderSecondsLimit / 60)} min` : ''}`)}
      </Card.Content>
    </Card>
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
  ['account', 'Account', <AccountTab key="a" />],
];

export function SettingsPage() {
  const { tab = 'models' } = useParams();
  const nav = useNavigate();
  return (
    <div className="scroll-y h-full">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <Link to="/" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-[#5b6b8f] hover:text-[#2970ec]"><Icon name="chevron" size={14} className="rotate-180" /> Your videos</Link>
        <h1 className="mb-4 text-2xl font-bold text-[#1557d1]">Settings</h1>
        <Tabs selectedKey={tab} onSelectionChange={(k) => nav(`/settings/${String(k)}`)} variant="secondary">
          <Tabs.ListContainer>
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
