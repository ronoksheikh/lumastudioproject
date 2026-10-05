// Two small helpers for Settings → Models: a model picker that loads the provider's model list (or lets the
// student type any id), and the thinking controls (reasoning effort + optional token budget).
import { Description, Input, Label, Spinner, TextField } from '@heroui/react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import type { ReasoningEffort } from '../api/types';

type Available = { id: string; name?: string; contextWindow?: number };

/** Model id input + the provider's list (GET /models), loaded as soon as base URL and key are filled in. */
export function ModelPicker({ baseUrl, apiKey, savedId, value, onChange, onContext }: {
  baseUrl: string;
  apiKey: string;
  /** editing a saved model: its stored key is used when no new key was typed */
  savedId?: string;
  value: string;
  onChange: (id: string) => void;
  onContext?: (tokens: number) => void;
}) {
  const [list, setList] = useState<Available[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setList(null);
    setError(null);
    if (!/^https?:\/\/.+/.test(baseUrl) || (!apiKey && !savedId)) return;
    let alive = true;
    const t = setTimeout(() => {
      setLoading(true);
      api.availableModels({ baseUrl, ...(apiKey ? { apiKey } : { id: savedId }) })
        .then((r) => { if (alive) { setList(r.models); setError(r.error ?? null); } })
        .catch(() => { if (alive) setError('Could not load the model list — type the model id.'); })
        .finally(() => { if (alive) setLoading(false); });
    }, 600);
    return () => { alive = false; clearTimeout(t); };
  }, [baseUrl, apiKey, savedId]);

  const matches = useMemo(() => {
    if (!list) return [];
    const q = value.trim().toLowerCase();
    return (q ? list.filter((m) => m.id.toLowerCase().includes(q) || m.name?.toLowerCase().includes(q)) : list).slice(0, 60);
  }, [list, value]);

  const pick = (m: Available) => {
    onChange(m.id);
    if (m.contextWindow && onContext) onContext(m.contextWindow);
    setOpen(false);
  };

  return (
    <div className="relative">
      <TextField value={value} onChange={(v) => { onChange(v); setOpen(true); }} isRequired>
        <Label>Model</Label>
        <Input placeholder={list?.length ? 'Search or type a model id' : 'e.g. anthropic/claude-sonnet-4.5'} autoComplete="off" onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
        <Description>
          {loading ? <span className="inline-flex items-center gap-1"><Spinner size="sm" /> Loading this provider’s models…</span>
            : error ? error
            : list ? `${list.length} models available — pick one or type your own.`
            : 'Fill in the base URL and API key to see the available models, or type the id.'}
        </Description>
      </TextField>
      {open && matches.length > 0 && (
        <ul role="listbox" aria-label="Available models" className="absolute left-0 right-0 z-20 mt-1 max-h-64 overflow-auto rounded-xl border border-[#d6e2f5] bg-white p-1 shadow-lg">
          {matches.map((m) => (
            <li key={m.id} role="option" aria-selected={m.id === value}>
              <button type="button" className={`w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-[#eff5ff] ${m.id === value ? 'bg-[#eff5ff] font-semibold' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(m)}>
                <span className="mono block truncate">{m.id}</span>
                {(m.name || m.contextWindow) && <span className="block truncate text-xs text-[#5b6b8f]">{m.name}{m.name && m.contextWindow ? ' · ' : ''}{m.contextWindow ? `${Math.round(m.contextWindow / 1000)}k context` : ''}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const EFFORTS: Array<[ReasoningEffort | '', string]> = [
  ['', 'Provider default'],
  ['none', 'Off'],
  ['minimal', 'Minimal'],
  ['low', 'Low'],
  ['medium', 'Medium'],
  ['high', 'High'],
  ['xhigh', 'Extra high'],
];

/** Reasoning effort + thinking budget. Providers that don't support them simply ignore the setting (Luma retries without it). */
export function ThinkingFields({ effort, budget, onChange, compact }: {
  effort: ReasoningEffort | null;
  budget: number | null;
  onChange: (v: { reasoningEffort: ReasoningEffort | null; thinkingBudget: number | null }) => void;
  compact?: boolean;
}) {
  const [budgetText, setBudgetText] = useState(budget == null ? '' : String(budget));
  useEffect(() => setBudgetText(budget == null ? '' : String(budget)), [budget]);
  return (
    <div className={`grid gap-3 ${compact ? 'sm:grid-cols-2' : 'sm:grid-cols-2'}`}>
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor="effort">Thinking effort</label>
        <select
          id="effort"
          className="h-10 rounded-xl border border-[#d6e2f5] bg-white px-3 text-sm outline-none focus:border-[#2970EC]"
          value={effort ?? ''}
          onChange={(e) => onChange({ reasoningEffort: (e.target.value || null) as ReasoningEffort | null, thinkingBudget: budget })}
        >
          {EFFORTS.map(([v, l]) => <option key={l} value={v}>{l}</option>)}
        </select>
        <span className="text-xs text-[#5b6b8f]">Higher = better plans and fewer mistakes, but slower and more tokens.</span>
      </div>
      <TextField
        value={budgetText}
        onChange={(v) => {
          const clean = v.replace(/[^\d]/g, '');
          setBudgetText(clean);
          onChange({ reasoningEffort: effort, thinkingBudget: clean === '' ? null : Math.min(200_000, Number(clean)) });
        }}
      >
        <Label>Thinking budget (tokens)</Label>
        <Input placeholder="Provider default" inputMode="numeric" />
        <Description>For models with a token budget (Claude, Gemini, Qwen, OpenRouter). Leave empty to use the effort.</Description>
      </TextField>
    </div>
  );
}
