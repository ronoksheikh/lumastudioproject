import { useQueryClient } from '@tanstack/react-query';
import { Select, Label, ListBox, Spinner, toast } from '@heroui/react';
import { Button } from './Button';
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { ModelConfig, UploadRecord } from '../api/types';
import { formatBytes } from '../lib/hooks';
import { Icon } from './Icon';
import type { FrameChip } from './preview-context';

interface Attachment {
  key: string;
  name: string;
  size: number;
  state: 'uploading' | 'ready' | 'error';
  record?: UploadRecord;
  error?: string;
}

const ACCEPT = '.svg,.png,.jpg,.jpeg,.webp,.pdf,image/svg+xml,image/png,image/jpeg,image/webp,application/pdf';

export function Composer({ projectId, frames = [], onRemoveFrame, models, modelId, onModelChange, running, onSend, onStop }: {
  projectId: string;
  /** preview moments attached with "Attach this frame" (they go with the next message) */
  frames?: FrameChip[];
  onRemoveFrame?: (t: number) => void;
  models: ModelConfig[];
  modelId: string | undefined;
  onModelChange: (id: string) => void;
  running: boolean;
  onSend: (text: string, attachments: UploadRecord[]) => Promise<void>;
  onStop: () => void;
}) {
  const [text, setText] = useState('');
  // the empty chat's example briefs fill the box (not sent: the student edits the [placeholders] first)
  useEffect(() => {
    const onPrompt = (e: Event) => {
      setText((e as CustomEvent<string>).detail);
      requestAnimationFrame(() => area.current?.focus());
    };
    window.addEventListener('luma:prompt', onPrompt);
    return () => window.removeEventListener('luma:prompt', onPrompt);
  }, []);
  const [files, setFiles] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const qc = useQueryClient();

  // files are uploaded into the project as soon as they're attached; ones not sent yet come back after a reload
  useEffect(() => {
    let alive = true;
    void api.uploads(projectId, true).then((r) => {
      if (!alive) return;
      setFiles((cur) => {
        const have = new Set(cur.map((a) => a.record?.id));
        const restored = r.uploads.filter((u) => !have.has(u.id)).map((u): Attachment => ({ key: u.id, name: u.path.split('/').pop() ?? u.path, size: u.size, state: 'ready', record: u }));
        return [...restored, ...cur];
      });
    }).catch(() => {});
    return () => { alive = false; };
  }, [projectId]);

  const usable = models.filter((m) => m.supportsTools);
  const model = models.find((m) => m.id === modelId);
  const noModel = models.length === 0;
  const untested = !!model && !model.supportsTools;
  const uploading = files.some((f) => f.state === 'uploading');
  const canSend = !!text.trim() && !uploading && !sending && !running && !!model?.supportsTools;

  const addFiles = async (list: File[]) => {
    const picked = list.slice(0, 6);
    const entries: Attachment[] = picked.map((f) => ({ key: `${f.name}-${f.size}-${Math.random().toString(36).slice(2, 7)}`, name: f.name, size: f.size, state: 'uploading' }));
    setFiles((cur) => [...cur, ...entries]);
    await Promise.all(picked.map(async (f, i) => {
      try {
        const r = await api.upload(projectId, [f]);
        setFiles((cur) => cur.map((a) => (a.key === entries[i]!.key ? { ...a, state: 'ready', record: r.uploads[0] } : a)));
        void qc.invalidateQueries({ queryKey: ['tree', projectId] }); // it's in the Files tab right away
      } catch (e) {
        const message = e instanceof ApiError ? e.message : 'Upload failed';
        setFiles((cur) => cur.map((a) => (a.key === entries[i]!.key ? { ...a, state: 'error', error: message } : a)));
        toast.danger(`${f.name}: ${message}`);
      }
    }));
  };

  /**
   * X = detach from this message. The file was uploaded but never sent, so nothing can be using it: the server
   * removes that pending upload (and refuses for anything already sent — those stay in the project).
   */
  const removeFile = async (a: Attachment) => {
    setFiles((cur) => cur.filter((x) => x.key !== a.key));
    if (!a.record) return;
    await api.deleteUpload(projectId, a.record.id).catch(() => {});
    void qc.invalidateQueries({ queryKey: ['tree', projectId] });
  };

  const submit = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      const sent = files.filter((f) => f.record);
      setFiles((cur) => cur.filter((f) => !sent.includes(f))); // chips move onto the sent message
      try {
        await onSend(text.trim(), sent.map((f) => f.record!));
      } catch (e) {
        setFiles((cur) => [...sent, ...cur]); // not sent: keep them pending
        throw e;
      }
      setText('');
    } catch (e) {
      toast.danger(e instanceof ApiError ? e.message : 'Could not start the agent');
    } finally {
      setSending(false);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    if (e.dataTransfer.files.length) void addFiles([...e.dataTransfer.files]);
  };
  const onPaste = (e: ClipboardEvent) => {
    const fs = [...e.clipboardData.files];
    if (fs.length) {
      e.preventDefault();
      void addFiles(fs);
    }
  };

  return (
    <div
      className={`border-t border-[var(--border)] bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] ${drag ? 'ring-2 ring-inset ring-[#2970ec]' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={onDrop}
    >
      {(noModel || untested) && (
        <p className="mb-2 rounded-lg bg-[#fff7e6] px-3 py-2 text-xs text-[#7a4a00]" role="status">
          {noModel ? 'Add a model first.' : 'This model hasn’t been tested yet.'} <Link to="/settings/models" className="font-semibold underline">Open Settings → Models</Link>
        </p>
      )}
      {(files.length > 0 || frames.length > 0) && (
        <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Attachments">
          {frames.map((f) => (
            <li key={`f-${f.t}`} className="flex items-center gap-1.5 rounded-lg border border-[#c9d9f7] bg-[#eff5ff] px-2 py-1 text-xs" data-testid="frame-chip">
              <Icon name="target" size={13} className="text-[#2970ec]" />
              <span className="mono">t={f.t.toFixed(2)}s</span>
              {f.segment && <span className="text-[#8a97b5]">· {f.segment}</span>}
              <button onClick={() => onRemoveFrame?.(f.t)} aria-label={`Detach frame at ${f.t.toFixed(2)} s`} className="text-[#5b6b8f] hover:text-[#b42318]"><Icon name="x" size={12} /></button>
            </li>
          ))}
          {files.map((a) => (
            <li key={a.key} className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs ${a.state === 'error' ? 'border-[#f3c5c5] bg-[#fdf2f2]' : 'border-[#c9d9f7] bg-[#eff5ff]'}`}>
              {a.state === 'uploading' ? <Spinner size="sm" />
                : a.record && /^image\/(png|jpeg|webp|svg)/.test(a.record.mime) ? <img src={api.rawUrl(projectId, a.record.path)} alt="" className="h-5 w-5 rounded object-cover" />
                : <Icon name={a.name.toLowerCase().endsWith('.pdf') ? 'file' : 'image'} size={13} className="text-[#2970ec]" />}
              <span className="max-w-40 truncate">{a.name}</span>
              <span className="text-[#8a97b5]">{formatBytes(a.size)}</span>
              <button onClick={() => void removeFile(a)} aria-label={`Detach ${a.name}`} title="Remove from this message (unsent files are deleted)" className="text-[#5b6b8f] hover:text-[#b42318]"><Icon name="x" size={12} /></button>
            </li>
          ))}
        </ul>
      )}
      <textarea
        ref={area}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={onPaste}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || (!e.shiftKey && !e.nativeEvent.isComposing))) { e.preventDefault(); void submit(); } }}
        rows={typeof window !== 'undefined' && window.innerWidth < 768 ? 2 : 3}
        placeholder={running ? 'Luma is working — you can stop it any time…' : 'Describe the video, or ask for a change…  (Enter to send, Shift+Enter for a new line)'}
        aria-label="Message to Luma"
        className="block max-h-56 min-h-[4.5rem] w-full resize-y rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-sm outline-none transition-colors placeholder:text-[#8a97b5] focus:border-[#2970ec]"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={(e) => { if (e.target.files) void addFiles([...e.target.files]); e.target.value = ''; }} />
        <Button size="sm" variant="tertiary" onPress={() => input.current?.click()} aria-label="Attach files"><Icon name="clip" size={15} /> Attach</Button>
        <div className="ml-auto flex items-center gap-2">
          {models.length > 0 && (
            <Select aria-label="Model" value={modelId ?? null} onChange={(k) => k && onModelChange(String(k))} className="w-36 sm:w-44" isDisabled={running}>
              <Label className="sr-only">Model</Label>
              <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {models.map((m) => (
                    <ListBox.Item key={m.id} id={m.id} textValue={m.name}>
                      {m.name}{!m.supportsTools ? ' (untested)' : ''}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
          )}
          {running ? (
            <Button variant="danger" size="sm" onPress={onStop} aria-label="Stop the agent"><Icon name="stop" size={13} /> Stop</Button>
          ) : (
            <Button variant="primary" size="sm" isDisabled={!canSend || usable.length === 0} onPress={() => void submit()} aria-label="Send message">
              {sending ? <Spinner size="sm" color="current" /> : <Icon name="send" size={14} />} Send
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
