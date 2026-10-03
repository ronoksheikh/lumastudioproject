import { Spinner } from '@heroui/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PlanItem } from '@luma/shared';
import type { ConversationMessage } from '../api/types';
import type { Block, TurnState } from '../lib/reduce';
import { AskCard, AssistantText, CommitLine, Notice, Thinking, ToolCard } from './Blocks';
import { Icon } from './Icon';

export function PlanCard({ items }: { items: PlanItem[] }) {
  const [open, setOpen] = useState(true);
  const done = items.filter((i) => i.status === 'done').length;
  return (
    <section className="rounded-xl border border-[#c9d9f7] bg-[#eff5ff]" aria-label="Plan">
      <button className="flex w-full items-center gap-2 px-3 py-2 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon name="list" size={15} className="text-[#2970ec]" />
        <span className="text-sm font-semibold text-[#07358f]">Plan</span>
        <span className="text-xs text-[#5b6b8f]">{done}/{items.length} done</span>
        <Icon name={open ? 'down' : 'chevron'} size={14} className="ml-auto text-[#5b6b8f]" />
      </button>
      {open && (
        <ul className="flex flex-col gap-1 px-3 pb-3">
          {items.map((it, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <span className={`mt-0.5 grid h-4 w-4 flex-none place-items-center rounded-full border ${it.status === 'done' ? 'border-[#2970ec] bg-[#2970ec] text-white' : it.status === 'doing' ? 'border-[#2970ec] bg-white' : 'border-[#c9d9f7] bg-white'}`}>
                {it.status === 'done' && <Icon name="check" size={10} strokeWidth={3.5} />}
                {it.status === 'doing' && <span className="pulse block h-1.5 w-1.5 rounded-full bg-[#2970ec]" />}
              </span>
              <span className={it.status === 'done' ? 'text-[#5b6b8f] line-through' : it.status === 'doing' ? 'font-medium' : ''}>{it.text}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function BlockView({ b, live, isLastReasoning, canAnswer, onAnswer }: { b: Block; live: boolean; isLastReasoning: boolean; canAnswer: boolean; onAnswer: (a: string) => void }) {
  switch (b.kind) {
    case 'reasoning': return <Thinking text={b.text} live={live && isLastReasoning} />;
    case 'text': return <AssistantText text={b.text} />;
    case 'tool': return <ToolCard block={b} />;
    case 'ask': return <AskCard block={b} canAnswer={canAnswer} onAnswer={onAnswer} />;
    case 'commit': return <CommitLine block={b} />;
    case 'notice': return <Notice block={b} />;
  }
}

export function TurnView({ turn, onAnswer }: { turn: TurnState; onAnswer: (a: string) => void }) {
  const live = turn.status === 'running';
  const lastBlock = turn.blocks.at(-1);
  // the question is open until the tool call that follows it finishes
  const pendingAsk = live ? [...turn.blocks].reverse().find((b) => b.kind === 'ask') : undefined;
  const lastReasoningIdx = turn.blocks.map((b) => b.kind).lastIndexOf('reasoning');
  return (
    <div className="flex flex-col gap-2.5" data-run={turn.runId} data-status={turn.status}>
      {turn.blocks.map((b, i) => (
        <BlockView key={`${b.kind}-${b.id}`} b={b} live={live} isLastReasoning={i === lastReasoningIdx && lastBlock === b} canAnswer={b === pendingAsk} onAnswer={onAnswer} />
      ))}
      {live && (
        <p className="flex items-center gap-2 text-xs text-[#5b6b8f]" role="status"><Spinner size="sm" /> Luma is working…</p>
      )}
      {turn.status === 'stopped' && <p className="text-xs text-[#5b6b8f]">Stopped.</p>}
      {turn.status === 'finished' && turn.usage && turn.usage.output > 0 && (
        <p className="text-[11px] text-[#8a97b5]">{turn.model} · {turn.usage.input.toLocaleString()} in / {turn.usage.output.toLocaleString()} out tokens</p>
      )}
    </div>
  );
}

export function ChatList({ messages, turns, pending, onAnswer }: {
  messages: ConversationMessage[];
  turns: Record<string, TurnState>;
  pending: Array<{ key: string; text: string }>;
  onAnswer: (runId: string, a: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  // stick to the bottom while new content streams in, unless the student scrolled up
  const signature = useMemo(() => Object.values(turns).map((t) => t.lastEventId).join(',') + messages.length + pending.length, [turns, messages.length, pending.length]);
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [signature]);

  return (
    <div
      ref={scroller}
      className="scroll-y flex-1 px-3 py-4"
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
      role="log"
      aria-live="polite"
      aria-label="Conversation"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        {messages.length === 0 && pending.length === 0 && (
          <div className="rounded-2xl border border-dashed border-[#c9d9f7] bg-[#fafcff] p-6 text-center">
            <Icon name="spark" size={22} className="mx-auto mb-2 text-[#2970ec]" />
            <h2 className="text-base font-semibold text-[#1557d1]">What should we make?</h2>
            <p className="mt-1 text-sm text-[#5b6b8f]">Describe your video — a script, a topic, a style. Attach your logo (SVG/PNG) or a brand PDF if you have one. Luma writes the script, records the voice, builds the animation and renders the MP4.</p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className="flex flex-col gap-3">
            <UserBubble text={m.text} />
            {m.runId && turns[m.runId] && <TurnView turn={turns[m.runId]!} onAnswer={(a) => onAnswer(m.runId!, a)} />}
          </div>
        ))}
        {pending.map((p) => <UserBubble key={p.key} text={p.text} />)}
      </div>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  const [main, attached] = text.split(/\n\nAttached files: /);
  return (
    <div className="ml-auto max-w-[88%] rounded-2xl rounded-br-md bg-[#2970ec] px-3.5 py-2 text-sm text-white shadow-sm">
      <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{main}</p>
      {attached && (
        <p className="mt-1.5 flex flex-wrap items-center gap-1 border-t border-white/30 pt-1.5 text-xs text-white/90">
          <Icon name="clip" size={12} /> {attached.split(', ').map((f) => f.split('/').pop()).join(' · ')}
        </p>
      )}
    </div>
  );
}
