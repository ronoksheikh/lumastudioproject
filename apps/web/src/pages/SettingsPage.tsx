import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertDialog, Description, Input, Label, ProgressBar, Skeleton, Spinner, TextField, toast } from '@heroui/react';
import { Button } from '../components/Button';
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError, type AgentPromptSettings } from '../api/client';
import type { ModelConfig, ReasoningEffort, TestResult, VoicePrefs } from '../api/types';
import { Icon, type IconName } from '../components/Icon';
import { ModelPicker, ThinkingFields } from '../components/ModelFields';
import { AddonsTab } from '../components/Addons';
import { BuyRenderHours, fmtRenderTime } from '../components/BuyRenderHours';
import { useMe, useModels, useVoice } from '../lib/hooks';

const msg = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong');

/** Layout pieces shared by every section: a white panel with an icon, a title, a description and an optional action. */
export function Panel({ icon, title, description, action, children, footer, id }: { icon?: IconName; title: ReactNode; description?: ReactNode; action?: ReactNode; children?: ReactNode; footer?: ReactNode; id?: string }) {
  return (
    <section id={id} className="overflow-hidden rounded-2xl border border-[var(--border)] bg-white shadow-[0_1px_3px_rgba(21,87,209,0.06)]">
      <header className="flex items-start gap-3 px-5 pt-5">
        {icon && <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#eff5ff] text-[#2970ec]"><Icon name={icon} size={18} /></span>}
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-[#1f2937]">{title}</h2>
          {description && <p className="mt-0.5 text-sm leading-relaxed text-[#5b6b8f]">{description}</p>}
        </div>
        {action}
      </header>
      {children && <div className="px-5 pb-5 pt-4">{children}</div>}
      {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--separator)] bg-[#fafcff] px-5 py-3">{footer}</footer>}
    </section>
  );
}

/** A row of radio cards (one choice). */
function Choices<T extends string>({ name, value, options, onChange, disabled }: { name: string; value: T; options: ReadonlyArray<readonly [T, string, string]>; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div className={`grid gap-2 ${options.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`} role="radiogroup" aria-label={name}>
      {options.map(([v, label, hint]) => {
        const on = value === v;
        return (
          <label key={v} className={`relative flex cursor-pointer flex-col gap-1 rounded-xl border p-3 transition-colors ${on ? 'border-[#2970ec] bg-[#eff5ff] ring-1 ring-[#2970ec]' : 'border-[var(--border)] hover:border-[#9cc2ff] hover:bg-[#fafcff]'}`}>
            <input type="radio" name={name} className="sr-only" checked={on} disabled={disabled} onChange={() => onChange(v)} />
            <span className="flex items-center justify-between text-sm font-semibold">{label}{on && <Icon name="ok" size={16} weight="fill" className="text-[#2970ec]" />}</span>
            <span className="text-xs leading-relaxed text-[#5b6b8f]">{hint}</span>
          </label>
        );
      })}
    </div>
  );
}

const selectCls = 'h-10 w-full rounded-xl border border-[var(--border)] bg-white px-3 text-sm outline-none focus:border-[#2970ec] sm:w-80';

// ---------------------------------------------------------------- Models

interface Provider {
  id: string;
  name: string;
  mark: string;
  tint: string;
  baseUrl: string;
  keyUrl?: string;
  blurb: string;
  /** starting points; the provider's own list is loaded once the key is in */
  suggested: Array<{ model: string; label: string; vision: boolean }>;
}

/** Model ids change often: the list is loaded from the provider, and "Test connection" says right away if one is gone. */
const PROVIDERS: Provider[] = [
  { id: 'openrouter', name: 'OpenRouter', mark: 'OR', tint: '#2970ec', baseUrl: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/keys', blurb: 'One key, hundreds of models. Recommended.', suggested: [
    { model: 'anthropic/claude-sonnet-4.5', label: 'Claude Sonnet — best all-round, sees screenshots', vision: true },
    { model: 'openai/gpt-4.1', label: 'GPT-4.1 — solid, sees screenshots', vision: true },
    { model: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro — long context, vision', vision: true },
  ] },
  { id: 'anthropic', name: 'Anthropic', mark: 'A', tint: '#c2410c', baseUrl: 'https://api.anthropic.com/v1', keyUrl: 'https://console.anthropic.com/settings/keys', blurb: 'Claude, direct.', suggested: [
    { model: 'claude-sonnet-4-5', label: 'Claude Sonnet — strong at motion design', vision: true },
  ] },
  { id: 'openai', name: 'OpenAI', mark: 'AI', tint: '#0f766e', baseUrl: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys', blurb: 'GPT models, direct.', suggested: [
    { model: 'gpt-4.1', label: 'GPT-4.1 — good tools and vision', vision: true },
  ] },
  { id: 'gemini', name: 'Google Gemini', mark: 'G', tint: '#4f46e5', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyUrl: 'https://aistudio.google.com/apikey', blurb: 'Free tier available.', suggested: [
    { model: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro — vision, long context', vision: true },
    { model: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash — fast and cheap', vision: true },
  ] },
  { id: 'groq', name: 'Groq', mark: 'GQ', tint: '#b45309', baseUrl: 'https://api.groq.com/openai/v1', keyUrl: 'https://console.groq.com/keys', blurb: 'Very fast, no vision.', suggested: [
    { model: 'openai/gpt-oss-120b', label: 'gpt-oss-120b — fast and cheap, no vision', vision: false },
  ] },
  { id: 'deepseek', name: 'DeepSeek', mark: 'DS', tint: '#1d4ed8', baseUrl: 'https://api.deepseek.com/v1', keyUrl: 'https://platform.deepseek.com/api_keys', blurb: 'Cheapest, no vision.', suggested: [
    { model: 'deepseek-chat', label: 'DeepSeek Chat — check results closely', vision: false },
  ] },
  { id: 'together', name: 'Together', mark: 'TG', tint: '#0369a1', baseUrl: 'https://api.together.xyz/v1', keyUrl: 'https://api.together.xyz/settings/api-keys', blurb: 'Open models.', suggested: [
    { model: 'Qwen/Qwen3-235B-A22B-Instruct-2507-tput', label: 'Qwen3 235B — capable, no vision', vision: false },
  ] },
  { id: 'custom', name: 'Other', mark: '+', tint: '#5b6b8f', baseUrl: '', blurb: 'Any OpenAI-compatible URL (vLLM, LM Studio…).', suggested: [] },
];

const hostOf = (url: string) => { try { return new URL(url).hostname; } catch { return url; } };
const providerOf = (baseUrl: string) => {
  const host = hostOf(baseUrl);
  return PROVIDERS.find((p) => p.baseUrl && host === hostOf(p.baseUrl)) ?? PROVIDERS[PROVIDERS.length - 1]!;
};

function Mark({ p, size = 36 }: { p: Provider; size?: number }) {
  return <span className="grid shrink-0 place-items-center rounded-xl text-[11px] font-bold text-white" style={{ width: size, height: size, background: p.tint }} aria-hidden>{p.mark}</span>;
}

function Caps({ m }: { m: Pick<ModelConfig, 'supportsTools' | 'supportsVision' | 'supportsReasoningStream'> }) {
  const chip = (on: boolean, label: string) => (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${on ? 'bg-[#e8f7ee] text-[#1a7f45]' : 'bg-[#f1f4f9] text-[#8a97b3]'}`}>
      <Icon name={on ? 'check' : 'x'} size={11} weight="bold" />{label}
    </span>
  );
  return <div className="flex flex-wrap gap-1">{chip(m.supportsTools, 'Tools')}{chip(m.supportsVision, 'Vision')}{chip(m.supportsReasoningStream, 'Live thinking')}</div>;
}

function ResultBox({ r }: { r: TestResult }) {
  return (
    <div role="status" className={`rounded-xl border p-3 text-sm ${r.ok ? 'border-[#bfe3cc] bg-[#f1fbf5]' : 'border-[#f3c5c5] bg-[#fdf2f2]'}`}>
      <p className="flex items-center gap-1.5 font-semibold"><Icon name={r.ok ? 'ok' : 'warn'} size={16} />{r.ok ? `Connected — answered in ${(r.latencyMs / 1000).toFixed(1)} s` : 'This model can’t be used yet'}</p>
      {r.error && <p className="mt-1">{r.error}</p>}
      {r.notes.map((n) => <p key={n} className="mt-1 text-[#5b6b8f]">{n}</p>)}
      <div className="mt-2"><Caps m={r} /></div>
      {!r.supportsVision && r.ok && <p className="mt-2 text-xs text-[#5b6b8f]">Without vision, Luma can’t look at its own screenshots. A vision model gives better videos.</p>}
    </div>
  );
}

/** Connect a provider in three steps: key → model → test & save. */
function ConnectModel({ provider, onDone }: { provider: Provider; onDone: () => void }) {
  const custom = provider.id === 'custom';
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(provider.suggested[0]?.model ?? '');
  const [name, setName] = useState('');
  const [contextWindow, setContextWindow] = useState<number | undefined>(undefined);
  const [thinking, setThinking] = useState<{ reasoningEffort: ReasoningEffort | null; thinkingBudget: number | null }>({ reasoningEffort: null, thinkingBudget: null });
  const [result, setResult] = useState<TestResult | null>(null);
  const qc = useQueryClient();
  const ready = !!(baseUrl && apiKey && model);
  const finalName = name.trim() || `${provider.id === 'custom' ? hostOf(baseUrl) : provider.name} · ${model.split('/').pop()}`;

  const test = useMutation({ mutationFn: () => api.testModelValues({ baseUrl, apiKey, model }), onSuccess: (r) => setResult(r.result), onError: (e) => toast.danger(msg(e)) });
  const save = useMutation({
    mutationFn: async () => {
      const { model: saved } = await api.addModel({ name: finalName, baseUrl, apiKey, model, ...(contextWindow ? { contextWindow: Math.max(4096, contextWindow) } : {}), ...thinking });
      await api.testModel(saved.id); // stores what the model supports
      return saved;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['models'] });
      toast.success(`${finalName} connected`);
      onDone();
    },
    onError: (e) => toast.danger(msg(e)),
  });

  const step = (n: number, title: string, done: boolean, body: ReactNode) => (
    <li className="relative flex gap-3 pb-5 last:pb-0">
      <span className={`z-10 grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold ${done ? 'bg-[#2970ec] text-white' : 'bg-[#eff5ff] text-[#2970ec] ring-1 ring-[#cfe0ff]'}`}>{done ? <Icon name="check" size={12} weight="bold" /> : n}</span>
      <div className="min-w-0 flex-1">
        <p className="mb-2 text-sm font-semibold">{title}</p>
        {body}
      </div>
    </li>
  );

  return (
    <Panel
      icon="plug"
      title={<span className="flex items-center gap-2">Connect {provider.name}</span>}
      description={provider.blurb + ' It must support tool calling.'}
      action={<Button size="sm" variant="tertiary" isIconOnly aria-label="Close" onPress={onDone}><Icon name="x" /></Button>}
      footer={<>
        <Button variant="tertiary" onPress={onDone}>Cancel</Button>
        <Button variant="secondary" isDisabled={!ready || test.isPending} onPress={() => test.mutate()}>{test.isPending ? <Spinner size="sm" /> : 'Test connection'}</Button>
        <Button variant="primary" isDisabled={!ready || save.isPending} onPress={() => save.mutate()}>{save.isPending ? <Spinner size="sm" color="current" /> : 'Save and connect'}</Button>
      </>}
    >
      <ol className="relative before:absolute before:bottom-3 before:left-3 before:top-3 before:w-px before:bg-[var(--border)]">
        {step(1, 'Your API key', !!(apiKey && baseUrl), (
          <div className="flex flex-col gap-3">
            {custom && (
              <TextField value={baseUrl} onChange={(v) => { setBaseUrl(v); setResult(null); }} isRequired>
                <Label>Base URL</Label><Input placeholder="https://my-server.example.com/v1" autoComplete="off" />
                <Description>OpenAI-compatible, usually ends in /v1</Description>
              </TextField>
            )}
            <TextField type="password" value={apiKey} onChange={(v) => { setApiKey(v); setResult(null); }} isRequired>
              <Label>API key</Label><Input placeholder="Paste your key" autoComplete="off" />
              <Description>
                Stored encrypted; only the last 4 characters are shown again.{' '}
                {provider.keyUrl && <a className="font-medium text-[#2970ec] hover:underline" href={provider.keyUrl} target="_blank" rel="noreferrer">Get a {provider.name} key ↗</a>}
              </Description>
            </TextField>
          </div>
        ))}
        {step(2, 'Choose a model', !!model, (
          <div className="flex flex-col gap-3">
            {provider.suggested.length > 0 && (
              <div className="flex flex-col gap-1.5" aria-label="Suggested models">
                {provider.suggested.map((s) => (
                  <button key={s.model} type="button" onClick={() => { setModel(s.model); setResult(null); }} className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm ${model === s.model ? 'border-[#2970ec] bg-[#eff5ff]' : 'border-[var(--border)] hover:bg-[#fafcff]'}`}>
                    <span className="min-w-0"><span className="mono block truncate text-[13px]">{s.model}</span><span className="block truncate text-xs text-[#5b6b8f]">{s.label}</span></span>
                    {s.vision && <Icon name="eye" className="shrink-0 text-[#2970ec]" aria-label="vision" />}
                  </button>
                ))}
              </div>
            )}
            <ModelPicker baseUrl={baseUrl} apiKey={apiKey} value={model} onChange={(v) => { setModel(v); setResult(null); }} onContext={setContextWindow} />
          </div>
        ))}
        {step(3, 'Test and save', !!result?.ok, (
          <div className="flex flex-col gap-3">
            <TextField value={name} onChange={setName}><Label>Name (optional)</Label><Input placeholder={finalName} /></TextField>
            <details className="rounded-xl border border-[var(--border)] px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium text-[#1557d1]">Thinking (advanced)</summary>
              <div className="mt-3"><ThinkingFields effort={thinking.reasoningEffort} budget={thinking.thinkingBudget} onChange={setThinking} /></div>
            </details>
            {result ? <ResultBox r={result} /> : <p className="text-xs text-[#5b6b8f]">“Test connection” sends one tiny request to check the key, tool calling and vision.</p>}
          </div>
        ))}
      </ol>
    </Panel>
  );
}

function ModelRow({ m }: { m: ModelConfig }) {
  const qc = useQueryClient();
  const [result, setResult] = useState<TestResult | null>(null);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const p = providerOf(m.baseUrl);
  const refresh = () => qc.invalidateQueries({ queryKey: ['models'] });
  const test = useMutation({ mutationFn: () => api.testModel(m.id), onSuccess: (r) => { setResult(r.result); void refresh(); }, onError: (e) => toast.danger(msg(e)) });
  const makeDefault = useMutation({ mutationFn: () => api.updateModel(m.id, { isDefault: true }), onSuccess: () => void refresh() });
  const saveThinking = useMutation({
    mutationFn: (v: { reasoningEffort: ReasoningEffort | null; thinkingBudget: number | null }) => api.updateModel(m.id, v),
    onSuccess: () => void refresh(),
    onError: (e) => toast.danger(msg(e)),
  });
  const remove = useMutation({ mutationFn: () => api.deleteModel(m.id), onSuccess: () => void refresh(), onError: (e) => toast.danger(msg(e)) });
  const status = !m.supportsTools ? { c: '#d97706', t: 'Not tested' } : { c: '#16a34a', t: 'Connected' };
  return (
    <div className={`rounded-2xl border bg-white transition-shadow ${m.isDefault ? 'border-[#9cc2ff] shadow-[0_0_0_3px_rgba(41,112,236,0.08)]' : 'border-[var(--border)]'}`}>
      <div className="flex items-center gap-3 p-4">
        <Mark p={p} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            <span className="truncate">{m.name}</span>
            {m.isDefault && <span className="inline-flex items-center gap-1 rounded-full bg-[#2970ec] px-2 py-0.5 text-[11px] font-semibold text-white"><Icon name="star" size={11} weight="fill" />Default</span>}
            <span className="inline-flex items-center gap-1 text-[11px] font-medium" style={{ color: status.c }}><span className="size-1.5 rounded-full" style={{ background: status.c }} />{status.t}</span>
          </p>
          <p className="mono truncate text-xs text-[#5b6b8f]">{m.model} · {hostOf(m.baseUrl)} · key {m.apiKeyHint}</p>
        </div>
        <div className="hidden md:block"><Caps m={m} /></div>
        <Button size="sm" variant="tertiary" isIconOnly aria-label={open ? 'Less' : 'More'} aria-expanded={open} onPress={() => setOpen((v) => !v)}><Icon name={open ? 'down' : 'chevron'} /></Button>
      </div>
      {!m.supportsTools && !result && <p className="mx-4 mb-3 rounded-lg bg-[#fff7e6] px-3 py-2 text-xs text-[#7a4a00]">Press “Test” once before using this model.</p>}
      {result && <div className="px-4 pb-3"><ResultBox r={result} /></div>}
      {open && (
        <div className="flex flex-col gap-3 border-t border-[var(--separator)] px-4 py-3">
          <div className="md:hidden"><Caps m={m} /></div>
          <p className="text-xs text-[#5b6b8f]">Context window: {Math.round(m.contextWindow / 1000)}k tokens</p>
          <ThinkingFields effort={m.reasoningEffort} budget={m.thinkingBudget} onChange={(v) => saveThinking.mutate(v)} />
        </div>
      )}
      <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--separator)] bg-[#fafcff] px-4 py-2.5">
        {!m.isDefault && <Button size="sm" variant="tertiary" onPress={() => makeDefault.mutate()}><Icon name="star" /> Make default</Button>}
        <Button size="sm" variant="secondary" isDisabled={test.isPending} onPress={() => test.mutate()}>{test.isPending ? <Spinner size="sm" /> : 'Test'}</Button>
        <Button size="sm" variant="danger-soft" onPress={() => setConfirm(true)}>Remove</Button>
      </div>
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
    </div>
  );
}

function ModelsTab() {
  const models = useModels();
  const [connecting, setConnecting] = useState<Provider | null>(null);
  const list = models.data ?? [];
  return (
    <div className="flex flex-col gap-6">
      {connecting && <ConnectModel key={connecting.id} provider={connecting} onDone={() => setConnecting(null)} />}

      <div>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold">Your models</h2>
            <p className="text-sm text-[#5b6b8f]">Luma runs on <b>your</b> model. The default one is used for every message.</p>
          </div>
        </div>
        {models.isLoading && <Skeleton className="h-24 rounded-2xl" />}
        <div className="flex flex-col gap-3">{list.map((m) => <ModelRow key={m.id} m={m} />)}</div>
        {models.data && list.length === 0 && (
          <div className="rounded-2xl border border-dashed border-[#9cc2ff] bg-[#f7faff] p-6 text-center">
            <span className="mx-auto mb-2 grid size-10 place-items-center rounded-xl bg-white text-[#2970ec] shadow-sm"><Icon name="plug" size={20} /></span>
            <p className="font-semibold">Connect a model to start making videos</p>
            <p className="text-sm text-[#5b6b8f]">Pick a provider below. Not sure? OpenRouter with Claude Sonnet is the best all-round choice.</p>
          </div>
        )}
      </div>

      <div>
        <h2 className="text-[15px] font-semibold">Connect a provider</h2>
        <p className="mb-3 text-sm text-[#5b6b8f]">Tool calling is required; a model with vision (it can look at its own screenshots) makes better videos.</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => { setConnecting(p); window.scrollTo?.({ top: 0, behavior: 'smooth' }); }}
              className={`flex flex-col items-start gap-2 rounded-2xl border bg-white p-3 text-left transition hover:-translate-y-0.5 hover:border-[#9cc2ff] hover:shadow-[0_4px_14px_rgba(41,112,236,0.10)] ${connecting?.id === p.id ? 'border-[#2970ec] ring-1 ring-[#2970ec]' : 'border-[var(--border)]'}`}
            >
              <Mark p={p} size={32} />
              <span className="text-sm font-semibold">{p.name}</span>
              <span className="text-xs leading-snug text-[#5b6b8f]">{p.blurb}</span>
            </button>
          ))}
        </div>
      </div>
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
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const p = prefs ?? voice.data?.prefs;
  const save = useMutation({
    mutationFn: (next?: VoicePrefs) => api.saveVoice({ ...(key ? { apiKey: key } : {}), ...(next ?? prefs ? { prefs: (next ?? prefs)! } : {}) }),
    onSuccess: (r) => { qc.setQueryData(['voice'], r); setKey(''); setPrefs(null); toast.success('Voice settings saved'); },
    onError: (e) => toast.danger(msg(e)),
  });
  const check = useMutation({
    mutationFn: () => api.testVoice(),
    onSuccess: (r) => setTest(r.ok
      ? { ok: true, text: `Key works${r.tier ? ` — ${r.tier} plan` : ''}${r.characterLimit ? `, ${Math.max(0, r.characterLimit - (r.charactersUsed ?? 0)).toLocaleString()} characters left` : ''}.${r.tier === 'free' ? ' On the free plan Luma sticks to premade voices.' : ''}${r.note ? ` ${r.note}` : ''}` }
      : { ok: false, text: r.error ?? 'The key was rejected.' }),
    onError: (e) => setTest({ ok: false, text: msg(e) }),
  });
  const removeKey = useMutation({ mutationFn: () => api.deleteVoiceKey(), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['voice'] }); setTest(null); } });
  if (!voice.data || !p) return <Skeleton className="h-64 rounded-2xl" />;
  const set = (patch: Partial<VoicePrefs>) => setPrefs({ ...p, ...patch });
  const anySet = Object.values(voice.data.prefs).some((v) => v != null);
  const text = (v: string) => (v.trim() === '' ? null : v.trim());

  return (
    <div className="flex flex-col gap-4">
      <Panel
        icon="key"
        title="ElevenLabs"
        description="Used for voiceovers. The key stays on the server — it is never shown to the model or sent back to your browser."
        action={voice.data.hasKey
          ? <span className="inline-flex items-center gap-1 rounded-full bg-[#e8f7ee] px-2.5 py-1 text-xs font-semibold text-[#1a7f45]"><span className="size-1.5 rounded-full bg-[#16a34a]" />Connected</span>
          : <span className="inline-flex items-center gap-1 rounded-full bg-[#f1f4f9] px-2.5 py-1 text-xs font-semibold text-[#5b6b8f]">Not connected</span>}
        footer={<>
          {voice.data.hasKey && <Button size="sm" variant="danger-soft" onPress={() => removeKey.mutate()}>Remove key</Button>}
          {voice.data.hasKey && <Button size="sm" variant="secondary" isDisabled={check.isPending} onPress={() => check.mutate()}>{check.isPending ? <Spinner size="sm" /> : 'Test key'}</Button>}
          <Button size="sm" variant="primary" isDisabled={!key || save.isPending} onPress={() => save.mutate(undefined)}>{voice.data.hasKey ? 'Replace key' : 'Save key'}</Button>
        </>}
      >
        <div className="flex flex-col gap-3">
          {voice.data.hasKey && <p className="text-sm">Saved key <span className="mono rounded bg-[#eff5ff] px-1.5 py-0.5">{voice.data.keyHint}</span></p>}
          <TextField type="password" value={key} onChange={setKey}>
            <Label>{voice.data.hasKey ? 'New key' : 'API key'}</Label>
            <Input placeholder="Paste your ElevenLabs key" autoComplete="off" />
            <Description><a className="font-medium text-[#2970ec] hover:underline" href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noreferrer">Get an ElevenLabs key ↗</a></Description>
          </TextField>
          {test && <p role="status" className={`rounded-lg px-3 py-2 text-sm ${test.ok ? 'bg-[#f1fbf5] text-[#1a7f45]' : 'bg-[#fdf2f2] text-[#b42318]'}`}>{test.text}</p>}
        </div>
      </Panel>

      <Panel
        icon="sliders"
        title={<>Voice overrides <span className="text-sm font-normal text-[#5b6b8f]">(optional)</span></>}
        description="Leave these empty and Luma picks a voice and model that fit each video’s language and tone. Anything you fill in is used for all your videos instead."
        footer={<>
          {anySet && <Button variant="tertiary" isDisabled={save.isPending} onPress={() => save.mutate({ voiceId: null, modelId: null, languageCode: null, speed: null, tempo: null, stability: null, similarityBoost: null, style: null })}>Clear all — let Luma choose</Button>}
          <Button variant="primary" isDisabled={!prefs || save.isPending} onPress={() => save.mutate(undefined)}>Save overrides</Button>
        </>}
      >
        <div className="grid gap-4 sm:grid-cols-2">
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
        </div>
      </Panel>
    </div>
  );
}

const fmtBytes = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1024 ** 2))} MB`);

function UsageCard() {
  const q = useQuery({ queryKey: ['usage'], queryFn: () => api.usage().then((r) => r.usage), staleTime: 30_000 });
  const u = q.data;
  if (!u) return <Skeleton className="h-28 rounded-2xl" />;
  return (
    <Panel icon="folder" title="Storage" description="Projects, uploads and renders share one storage allowance.">
      <div className="mb-1 flex justify-between text-sm"><span>Used</span><span className="mono text-[#5b6b8f]">{fmtBytes(u.diskBytes)}{u.diskLimitBytes ? ` of ${fmtBytes(u.diskLimitBytes)}` : ''}</span></div>
      {u.diskLimitBytes ? (
        <ProgressBar value={Math.min(100, (u.diskBytes / u.diskLimitBytes) * 100)} aria-label="Storage" color={u.diskBytes / u.diskLimitBytes > 0.9 ? 'danger' : 'accent'}>
          <ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track>
        </ProgressBar>
      ) : null}
    </Panel>
  );
}

/** Free daily render time + paid fast render hours (PayStation). */
function FastRenderCard() {
  const q = useQuery({ queryKey: ['usage'], queryFn: () => api.usage().then((r) => r.usage), staleTime: 30_000 });
  const u = q.data;
  if (!u) return null;
  const free = u.freeRender;
  const fast = u.fastRender;
  return (
    <Panel id="render-time" icon="lightning" title="Render time" description="Free render time every day on our server. Fast render hours run on powerful render servers and never expire. With both, Luma asks which one to use.">
      <div className="flex flex-col gap-4 text-sm">
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
      </div>
    </Panel>
  );
}

type Prefs = AgentPromptSettings['prefs'];

/** Settings → Agent: how Luma works (scope, step limit, frame checks, memory) and the student's own instructions. */
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
    mutationFn: (p: Partial<Prefs>) => api.saveAgentPrefs(p),
    onSuccess: (r) => { qc.setQueryData(['agent-prompt'], r); toast.success('Saved — used from the next message on'); },
    onError: (e) => toast.danger(msg(e)),
  });
  if (!q.data) return <Skeleton className="h-40 rounded-2xl" />;
  const prefs = q.data.prefs;
  const cur = draft ?? q.data.prompt ?? { mode: 'append' as const, text: '' };
  const set = (patch: Partial<typeof cur>) => setDraft({ ...cur, ...patch });
  const modeBtn = (m: 'append' | 'replace', label: string) => (
    <Button size="sm" variant={cur.mode === m ? 'primary' : 'tertiary'} onPress={() => set({ mode: m })}>{label}</Button>
  );
  return (
    <div className="flex flex-col gap-4">
      <Panel icon="target" title="How far Luma goes" description="Luma does what you ask, then stops and reports. Choose how much it may do beyond that on its own.">
        <div className="flex flex-col gap-4">
          <Choices
            name="Scope"
            value={prefs.scope}
            disabled={savePrefs.isPending}
            onChange={(v) => savePrefs.mutate({ scope: v })}
            options={[
              ['exact', 'Only what I ask', 'Does exactly the request, checks it once and stops. Ideas are suggested, not done.'],
              ['balanced', 'Balanced', 'The request plus fixing what it breaks or finds blocking. Recommended.'],
              ['thorough', 'Thorough', 'Also polishes every scene, timing and sound. Uses more tokens and time.'],
            ]}
          />
          <div>
            <label className="text-sm font-medium" htmlFor="max-steps">Most tool steps per message</label>
            <select id="max-steps" className={`mt-1 ${selectCls}`} value={prefs.maxSteps ?? ''} disabled={savePrefs.isPending} onChange={(e) => savePrefs.mutate({ maxSteps: e.target.value ? Number(e.target.value) : null })}>
              <option value="">No extra limit (server maximum)</option>
              {[10, 20, 30, 50, 80].map((n) => <option key={n} value={n}>{n} steps</option>)}
            </select>
            <p className="mt-1 text-xs text-[#5b6b8f]">A step is one round of tool calls. When the limit is reached Luma stops and tells you what is done and what is left — say “continue” to go on. A new video usually needs 25–60 steps, a small change 3–10.</p>
          </div>
        </div>
      </Panel>

      <Panel icon="frame" title="Frame checks" description="Luma takes screenshots of the video to check its own work. Best results, but it uses a lot of your model’s tokens. Turn it down to save tokens — then you watch the preview and tell Luma what to fix.">
        <Choices
          name="Frame checks"
          value={prefs.frameChecks}
          disabled={savePrefs.isPending}
          onChange={(v) => savePrefs.mutate({ frameChecks: v })}
          options={[
            ['full', 'Full', 'Checks every scene with screenshots (best quality).'],
            ['light', 'Light', 'One round of screenshots per message.'],
            ['off', 'Off', 'Quick code checks only; you watch the preview.'],
          ]}
        />
      </Panel>

      <Panel icon="brain" title="Memory" description="Every message re-sends the conversation before it. Once it passes this size, Luma folds the older part into a short project memory (files and decisions are kept).">
        <label className="text-sm font-medium" htmlFor="compact-at">Compact the context when it passes</label>
        <select id="compact-at" className={`mt-1 ${selectCls}`} value={prefs.compactAtTokens ?? ''} disabled={savePrefs.isPending} onChange={(e) => savePrefs.mutate({ compactAtTokens: e.target.value ? Number(e.target.value) : null })}>
          <option value="">Automatic (about 70% of the model’s limit)</option>
          {[32_000, 50_000, 80_000, 100_000, 150_000, 200_000, 300_000].map((n) => <option key={n} value={n}>{n / 1000}k tokens</option>)}
        </select>
        <p className="mt-1 text-xs text-[#5b6b8f]">Lower = cheaper and faster per message; higher = Luma remembers more word for word.</p>
      </Panel>

      <Panel
        icon="robot"
        title="Your instructions for Luma"
        description="Your style, language, brand habits, things to always or never do. Applies to all your projects from the next message on."
        footer={<>
          {cur.mode === 'replace' && !cur.text.trim() && <Button variant="tertiary" onPress={() => set({ text: q.data.defaultPrompt })}>Start from Luma’s prompt</Button>}
          {q.data.prompt && <Button variant="tertiary" isDisabled={save.isPending} onPress={() => save.mutate(null)}>Reset to Luma’s prompt</Button>}
          <Button variant="primary" isDisabled={save.isPending || !draft} onPress={() => save.mutate(cur.text.trim() ? cur : null)}>Save</Button>
        </>}
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">{modeBtn('append', 'Add to Luma’s prompt')}{modeBtn('replace', 'Replace Luma’s prompt')}</div>
          {cur.mode === 'replace' && <p className="text-sm text-[#5b6b8f]">Your text becomes the whole system prompt. The project facts, tools and engine guides are still provided. Placeholders {'{aspect} {width} {height} {brand_summary} {attachments_summary}'} are filled in.</p>}
          <textarea
            className="mono min-h-48 w-full rounded-xl border border-[var(--border)] bg-white p-3 text-[13px] leading-relaxed outline-none focus:border-[#2970EC] max-md:text-base"
            placeholder={cur.mode === 'append' ? 'e.g. Always make 9:16 reels. Write on-screen text in English, voice in Bengali. Prefer white stages with blue type.' : 'Your full system prompt…'}
            value={cur.text}
            onChange={(e) => set({ text: e.target.value })}
            aria-label="Your instructions for Luma"
          />
          <button type="button" className="flex items-center gap-1.5 self-start text-sm font-medium text-[#1557d1]" onClick={() => setShowDefault((v) => !v)} aria-expanded={showDefault}>
            <Icon name={showDefault ? 'down' : 'chevron'} /> {showDefault ? 'Hide' : 'Show'} Luma’s built-in prompt
          </button>
          {showDefault && <pre className="mono max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-xl bg-[#f5f8fe] p-3 text-xs">{q.data.defaultPrompt}</pre>}
        </div>
      </Panel>
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
      <FastRenderCard />
      <UsageCard />
      <Panel
        icon="user"
        title="Password"
        description={<>Signed in as <b>{me.data?.user?.email}</b></>}
        footer={<Button variant="primary" isDisabled={!cur || next.length < 8 || change.isPending} onPress={() => change.mutate()}>Change password</Button>}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField type="password" value={cur} onChange={setCur}><Label>Current password</Label><Input autoComplete="current-password" /></TextField>
          <TextField type="password" value={next} onChange={setNext} isInvalid={next.length > 0 && next.length < 8}><Label>New password</Label><Input autoComplete="new-password" /><Description>At least 8 characters</Description></TextField>
        </div>
      </Panel>
    </div>
  );
}

const SECTIONS: Array<{ id: string; label: string; hint: string; icon: IconName; title: string; intro: string; body: () => ReactNode }> = [
  { id: 'models', label: 'Models', hint: 'Connect your AI', icon: 'plug', title: 'Models', intro: 'Connect the AI model Luma thinks with. Your key, your choice of model.', body: () => <ModelsTab /> },
  { id: 'voice', label: 'Voice', hint: 'ElevenLabs', icon: 'mic', title: 'Voice', intro: 'Voiceovers are made with your ElevenLabs account.', body: () => <VoiceTab /> },
  { id: 'agent', label: 'Agent', hint: 'How Luma works', icon: 'robot', title: 'Agent', intro: 'Control how much Luma does on its own, how it checks its work and what it remembers.', body: () => <AgentTab /> },
  { id: 'addons', label: 'Add-ons', hint: 'API, source code', icon: 'package', title: 'Add-ons', intro: 'One-time purchases that unlock more of Luma Studio.', body: () => <AddonsTab /> },
  { id: 'account', label: 'Account', hint: 'Render time, storage', icon: 'user', title: 'Account', intro: 'Render time, storage and your password.', body: () => <AccountTab /> },
];

export function SettingsPage() {
  const { tab = 'models' } = useParams();
  const active = SECTIONS.find((s) => s.id === tab) ?? SECTIONS[0]!;
  return (
    <div className="scroll-y h-full bg-[#f7faff]">
      <div className="mx-auto max-w-5xl px-4 py-6 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-8">
        <Link to="/" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-[#5b6b8f] hover:text-[#2970ec]"><Icon name="chevron" size={14} className="rotate-180" /> Your videos</Link>
        <h1 className="text-2xl font-bold text-[#1557d1]">Settings</h1>
        <div className="mt-5 flex flex-col gap-6 md:flex-row md:items-start">
          <nav aria-label="Settings sections" className="scroll-x -mx-4 overflow-x-auto px-4 md:sticky md:top-4 md:mx-0 md:w-56 md:shrink-0 md:overflow-visible md:px-0">
            <ul className="flex gap-1.5 md:flex-col">
              {SECTIONS.map((s) => {
                const on = s.id === active.id;
                return (
                  <li key={s.id}>
                    <Link
                      to={`/settings/${s.id}`}
                      aria-current={on ? 'page' : undefined}
                      className={`flex items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2 text-sm transition-colors ${on ? 'bg-white font-semibold text-[#1557d1] shadow-[0_1px_3px_rgba(21,87,209,0.10)] ring-1 ring-[var(--border)]' : 'text-[#41506f] hover:bg-white/70'}`}
                    >
                      <span className={`grid size-7 shrink-0 place-items-center rounded-lg ${on ? 'bg-[#2970ec] text-white' : 'bg-[#eaf1fe] text-[#2970ec]'}`}><Icon name={s.icon} size={15} /></span>
                      <span className="flex flex-col leading-tight">
                        {s.label}
                        <span className="hidden text-xs font-normal text-[#8a97b3] md:block">{s.hint}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <main className="min-w-0 flex-1">
            <div className="mb-4">
              <h2 className="text-lg font-semibold">{active.title}</h2>
              <p className="text-sm text-[#5b6b8f]">{active.intro}</p>
            </div>
            {active.body()}
          </main>
        </div>
      </div>
    </div>
  );
}
