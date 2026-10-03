import { Button, Chip, Modal, ProgressBar, Spinner } from '@heroui/react';
import { useState, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Block, FileChange } from '../lib/reduce';
import { splitOutput, stripAnsi } from '../lib/reduce';
import { DiffView } from './DiffView';
import { Icon, type IconName } from './Icon';
import { usePreview } from './preview-context';

type ToolBlock = Extract<Block, { kind: 'tool' }>;

const TOOL_META: Record<string, { icon: IconName; label: string }> = {
  bash: { icon: 'terminal', label: 'Terminal' },
  read_file: { icon: 'eye', label: 'Read' },
  write_file: { icon: 'file', label: 'Write' },
  edit_file: { icon: 'pencil', label: 'Edit' },
  list_files: { icon: 'folder', label: 'Files' },
  update_plan: { icon: 'list', label: 'Plan' },
  generate_voice: { icon: 'mic', label: 'Voiceover' },
  patch_voice: { icon: 'mic', label: 'Patch voice' },
  preview_frames: { icon: 'image', label: 'Check frames' },
  render_video: { icon: 'film', label: 'Render' },
  ask_user: { icon: 'help', label: 'Question' },
  web_fetch: { icon: 'globe', label: 'Fetch page' },
};

const argOf = (b: ToolBlock, key: string): string | undefined => {
  const a = b.args as Record<string, unknown> | null;
  const v = a && typeof a === 'object' ? a[key] : undefined;
  return typeof v === 'string' ? v : undefined;
};

function StatusDot({ status }: { status: ToolBlock['status'] }) {
  if (status === 'running') return <Spinner size="sm" />;
  return <span aria-label={status === 'ok' ? 'done' : 'failed'} className={`grid h-4 w-4 place-items-center rounded-full text-white ${status === 'ok' ? 'bg-[#2970ec]' : 'bg-[#d92d20]'}`}><Icon name={status === 'ok' ? 'check' : 'x'} size={10} strokeWidth={3.5} /></span>;
}

function CardShell({ block, title, children, defaultOpen = true }: { block: ToolBlock; title: ReactNode; children?: ReactNode; defaultOpen?: boolean }) {
  const meta = TOOL_META[block.name] ?? { icon: 'spark' as IconName, label: block.name };
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-white" data-tool={block.name}>
      <button className="flex w-full items-center gap-2 px-3 py-2 text-left" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="grid h-6 w-6 flex-none place-items-center rounded-md bg-[#eff5ff] text-[#2970ec]"><Icon name={meta.icon} size={14} /></span>
        <span className="min-w-0 flex-1 truncate text-sm"><b className="font-semibold">{meta.label}</b> <span className="text-[#5b6b8f]">{title}</span></span>
        <StatusDot status={block.status} />
        <Icon name={open ? 'down' : 'chevron'} size={14} className="flex-none text-[#5b6b8f]" />
      </button>
      {open && children && <div className="border-t border-[var(--separator)] px-3 py-2.5">{children}</div>}
    </div>
  );
}

export function Terminal({ output, className = '' }: { output: string; className?: string }) {
  const parts = splitOutput(output);
  return (
    <pre className={`term ${className}`} tabIndex={0} aria-label="Command output">
      {parts.map((p, i) => <span key={i} className={p.err ? 'err' : undefined}>{stripAnsi(p.text)}</span>)}
    </pre>
  );
}

function FileChip({ f, onOpen }: { f: FileChange; onOpen: (f: FileChange) => void }) {
  const color = f.change === 'created' ? 'success' : f.change === 'deleted' ? 'danger' : 'accent';
  return (
    <button onClick={() => onOpen(f)} className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-[var(--border)] bg-white px-2 py-1 text-xs hover:border-[#5daeff]" title="View changes">
      <Chip size="sm" color={color}><Chip.Label>{f.change}</Chip.Label></Chip>
      <span className="mono truncate">{f.path}</span>
      <span className="mono text-[#14753b]">+{f.additions}</span>
      <span className="mono text-[#b42318]">−{f.deletions}</span>
    </button>
  );
}

export function DiffModal({ file, onClose }: { file: FileChange | null; onClose: () => void }) {
  return (
    <Modal.Backdrop isOpen={!!file} onOpenChange={(o) => !o && onClose()}>
      <Modal.Container size="lg" scroll="inside">
        <Modal.Dialog>
          <Modal.CloseTrigger />
          <Modal.Header><Modal.Heading className="mono text-base">{file?.path}</Modal.Heading></Modal.Header>
          <Modal.Body>{file && <DiffView diff={file.diff ?? ''} empty="The line-by-line changes aren’t available for this edit." />}</Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

function Frames({ block }: { block: ToolBlock }) {
  const [zoom, setZoom] = useState<{ t: number; url: string } | null>(null);
  const f = block.frames;
  if (!f) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {f.frames.map((fr) => (
          <button key={fr.url} onClick={() => setZoom(fr)} className="group overflow-hidden rounded-lg border border-[var(--border)] text-left" aria-label={`Frame at ${fr.t.toFixed(1)} seconds`}>
            <img src={fr.url} alt={`Frame at ${fr.t.toFixed(2)} s`} loading="lazy" className="block w-full bg-[#eff5ff]" />
            <span className="mono block px-1.5 py-0.5 text-[11px] text-[#5b6b8f]">{fr.t.toFixed(2)} s</span>
          </button>
        ))}
      </div>
      {f.issues.length > 0 && (
        <ul className="list-disc rounded-lg bg-[#fff7e6] p-2 pl-6 text-xs text-[#7a4a00]">{f.issues.map((i, k) => <li key={k}>{i}</li>)}</ul>
      )}
      <Modal.Backdrop isOpen={!!zoom} onOpenChange={(o) => !o && setZoom(null)}>
        <Modal.Container size="lg">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header><Modal.Heading>Frame at {zoom?.t.toFixed(2)} s</Modal.Heading></Modal.Header>
            <Modal.Body>{zoom && <img src={zoom.url} alt={`Frame at ${zoom.t.toFixed(2)} s`} className="w-full rounded-lg" />}</Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </div>
  );
}

function VoiceBody({ block }: { block: ToolBlock }) {
  const { base, reloadKey } = usePreview();
  const v = block.voice;
  if (!v) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-[#5b6b8f]">
        <Chip size="sm" color={v.placeholder ? 'warning' : 'success'}><Chip.Label>{v.placeholder ? 'placeholder (silent)' : 'voice ready'}</Chip.Label></Chip>
        <span>{v.duration.toFixed(1)} s · {v.segments.length} scenes</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {v.segments.map((s) => <span key={s.id} className="mono rounded bg-[#eff5ff] px-1.5 py-0.5 text-[11px] text-[#1557d1]">{s.id} {s.start.toFixed(1)}–{s.end.toFixed(1)}s</span>)}
      </div>
      {!v.placeholder && base && <audio controls preload="none" src={`${base}${v.audioUrl}?v=${reloadKey}`} className="h-9 w-full" aria-label="Voiceover" />}
    </div>
  );
}

function RenderBody({ block }: { block: ToolBlock }) {
  const r = block.render;
  if (!r) return block.status === 'running' ? <p className="text-sm text-[#5b6b8f]">Preparing the render…</p> : null;
  const pct = r.total ? Math.round(((r.frame ?? 0) / r.total) * 100) : 0;
  if (r.state === 'done' && r.url) {
    return (
      <div className="flex flex-col gap-2">
        <video src={r.url} controls preload="metadata" className="w-full rounded-lg bg-black" aria-label="Rendered video" />
        <div className="flex items-center gap-2">
          <a href={r.url} download className="inline-flex items-center gap-1.5 rounded-lg bg-[#2970ec] px-3 py-1.5 text-sm font-semibold text-white"><Icon name="download" size={14} /> Download MP4</a>
          {r.durationS != null && <span className="text-xs text-[#5b6b8f]">{r.durationS.toFixed(1)} s</span>}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      {r.state === 'queued' ? (
        <p className="text-sm text-[#5b6b8f]">Queued — the server is busy{r.position ? ` (position ${r.position})` : ''}. It starts automatically.</p>
      ) : (
        <ProgressBar value={pct} aria-label="Render progress" className="w-full">
          <ProgressBar.Output />
          <ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track>
        </ProgressBar>
      )}
      {r.eta != null && <p className="text-xs text-[#5b6b8f]">About {Math.ceil(r.eta)} s left</p>}
    </div>
  );
}

export function ToolCard({ block }: { block: ToolBlock }) {
  const [diffFile, setDiffFile] = useState<FileChange | null>(null);
  const failed = block.status === 'error';
  const err = failed ? <p className="mb-1 text-xs text-[#b42318]">{block.summary}</p> : null;

  switch (block.name) {
    case 'bash':
      return (
        <CardShell block={block} title={<span className="mono">$ {argOf(block, 'command')?.split('\n')[0]}</span>} defaultOpen={block.status === 'running' || failed}>
          <div className="flex flex-col gap-2">
            <pre className="mono overflow-auto rounded bg-[#eff5ff] px-2 py-1 text-xs text-[#07358f]">$ {argOf(block, 'command')}</pre>
            {block.output && <Terminal output={block.output} />}
            {block.status !== 'running' && <p className="text-xs text-[#5b6b8f]">{block.summary}{block.truncated ? ' · output shortened' : ''}</p>}
            {block.files.length > 0 && <div className="flex flex-wrap gap-1.5">{block.files.map((f) => <FileChip key={f.path} f={f} onOpen={setDiffFile} />)}</div>}
          </div>
          <DiffModal file={diffFile} onClose={() => setDiffFile(null)} />
        </CardShell>
      );
    case 'write_file':
    case 'edit_file':
      return (
        <CardShell block={block} title={<span className="mono">{argOf(block, 'path')}</span>} defaultOpen>
          {err}
          <div className="flex flex-wrap gap-1.5">{block.files.map((f) => <FileChip key={f.path} f={f} onOpen={setDiffFile} />)}</div>
          <DiffModal file={diffFile} onClose={() => setDiffFile(null)} />
        </CardShell>
      );
    case 'read_file':
    case 'list_files':
    case 'web_fetch':
      return <CardShell block={block} title={<span className="mono">{argOf(block, 'path') ?? argOf(block, 'url') ?? block.summary}</span>} defaultOpen={failed}>{err}</CardShell>;
    case 'update_plan':
      return <CardShell block={block} title={block.summary ?? 'updated'} defaultOpen={false} />;
    case 'generate_voice':
    case 'patch_voice':
      return <CardShell block={block} title={block.summary ?? 'working…'}>{err}{block.output && !block.voice && <Terminal output={block.output} />}<VoiceBody block={block} /></CardShell>;
    case 'preview_frames':
      return <CardShell block={block} title={block.summary ?? 'rendering…'}>{err}{block.status === 'running' && <p className="text-sm text-[#5b6b8f]">Rendering screenshots of the video…</p>}<Frames block={block} /></CardShell>;
    case 'render_video':
      return <CardShell block={block} title={`${argOf(block, 'preset') ?? ''} render`}>{err}<RenderBody block={block} /></CardShell>;
    case 'ask_user':
      return null; // shown as the question card
    default:
      return <CardShell block={block} title={block.summary ?? ''} defaultOpen={failed}>{err}</CardShell>;
  }
}

export function Thinking({ text, live }: { text: string; live: boolean }) {
  const [open, setOpen] = useState(false);
  const shown = live || open;
  return (
    <div className="rounded-xl border border-dashed border-[var(--border)] bg-[#fafcff] px-3 py-2">
      <button className="flex w-full items-center gap-2 text-left text-xs text-[#5b6b8f]" onClick={() => setOpen(!open)} aria-expanded={shown}>
        <Icon name="brain" size={14} className={live ? 'pulse' : ''} />
        <span className="font-medium">{live ? 'Thinking…' : 'Thought process'}</span>
        <Icon name={shown ? 'down' : 'chevron'} size={12} className="ml-auto" />
      </button>
      {shown && <p className="mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap text-xs italic leading-relaxed text-[#5b6b8f]">{text}</p>}
    </div>
  );
}

export function AssistantText({ text }: { text: string }) {
  return (
    <div className="md" lang="auto">
      <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
    </div>
  );
}

export function AskCard({ block, canAnswer, onAnswer }: { block: Extract<Block, { kind: 'ask' }>; canAnswer: boolean; onAnswer: (a: string) => void }) {
  const [text, setText] = useState('');
  return (
    <div className="rounded-xl border-2 border-[#5daeff] bg-[#eff5ff] p-3" role="group" aria-label="Question from Luma">
      <p className="mb-2 flex items-start gap-2 text-sm font-semibold text-[#07358f]"><Icon name="help" size={16} className="mt-0.5 flex-none" />{block.question}</p>
      {canAnswer ? (
        <div className="flex flex-col gap-2">
          {block.options.length > 0 && (
            <div className="flex flex-wrap gap-2">{block.options.map((o) => <Button key={o} size="sm" variant="primary" onPress={() => onAnswer(o)}>{o}</Button>)}</div>
          )}
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) onAnswer(text.trim()); }}>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={block.options.length ? 'Or type your own answer…' : 'Type your answer…'} aria-label="Your answer"
              className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-white px-3 py-1.5 text-sm outline-none focus:border-[#2970ec]" />
            <Button type="submit" size="sm" variant="secondary" isDisabled={!text.trim()}>Send</Button>
          </form>
        </div>
      ) : (
        <p className="text-xs text-[#5b6b8f]">Answered.</p>
      )}
    </div>
  );
}

export function CommitLine({ block }: { block: Extract<Block, { kind: 'commit' }> }) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-[#5b6b8f]">
      <Icon name="git" size={13} /> Saved a snapshot <span className="mono rounded bg-[#eff5ff] px-1 text-[#1557d1]">{block.sha.slice(0, 7)}</span> · {block.files.length} file{block.files.length === 1 ? '' : 's'}
    </p>
  );
}

export function Notice({ block }: { block: Extract<Block, { kind: 'notice' }> }) {
  return (
    <p role="status" className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${block.retryable ? 'bg-[#fff7e6] text-[#7a4a00]' : 'bg-[#fdecec] text-[#7f1d1d]'}`}>
      <Icon name="warn" size={16} className="mt-0.5 flex-none" /> {block.message}
    </p>
  );
}
