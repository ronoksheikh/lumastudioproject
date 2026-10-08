// Improvements: report a problem or suggest something (with screenshots) and follow what the team does with it.
import { Card, Chip, Input, Label, Spinner, TextField, toast } from '@heroui/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ClipboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api, type FeedbackItem, type FeedbackStatus } from '../api/client';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { usePageTitle } from '../lib/page-title';

export const STATUS: Record<FeedbackStatus, { label: string; color: 'default' | 'accent' | 'warning' | 'success' | 'danger'; hint: string }> = {
  new: { label: 'Sent', color: 'default', hint: 'Waiting for the team to look at it' },
  reviewed: { label: 'Reviewed', color: 'accent', hint: 'The team has read it' },
  in_progress: { label: 'Working on it', color: 'warning', hint: 'The team is working on it' },
  done: { label: 'Done', color: 'success', hint: 'Fixed or added' },
  declined: { label: 'Not planned', color: 'danger', hint: 'Not planned for now' },
};

export function StatusChip({ s }: { s: FeedbackStatus }) {
  return <Chip size="sm" color={STATUS[s].color}><Chip.Label>{STATUS[s].label}</Chip.Label></Chip>;
}

export function FeedbackCard({ f, children }: { f: FeedbackItem; children?: React.ReactNode }) {
  return (
    <Card className="p-2">
      <Card.Header>
        <div className="flex flex-wrap items-center gap-2">
          <Chip size="sm" variant="secondary"><Chip.Label>{f.kind === 'bug' ? 'Problem' : 'Suggestion'}</Chip.Label></Chip>
          <StatusChip s={f.status} />
          {f.user && <span className="text-xs text-[#5b6b8f]">{f.user}</span>}
          <span className="ml-auto text-xs text-[#5b6b8f]">{new Date(f.createdAt).toLocaleDateString()}</span>
        </div>
        <Card.Title className="mt-1">{f.title}</Card.Title>
      </Card.Header>
      <Card.Content className="flex flex-col gap-3 text-sm">
        <p className="whitespace-pre-wrap text-[#1f2937]">{f.body}</p>
        {f.screenshots.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {f.screenshots.map((u) => (
              <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="Screenshot" className="h-24 w-36 rounded-lg border border-[#d6e2f5] object-cover" /></a>
            ))}
          </div>
        )}
        {f.adminNote && <p className="rounded-xl bg-[#eff5ff] px-3 py-2"><b className="text-[#1557d1]">Lumademy team:</b> {f.adminNote}</p>}
        {children}
      </Card.Content>
    </Card>
  );
}

function NewReport({ onSent }: { onSent: () => void }) {
  const [kind, setKind] = useState<'bug' | 'suggestion'>('bug');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);
  const add = (list: File[]) => setFiles((cur) => [...cur, ...list.filter((f) => /^image\/(png|jpeg|webp)$/.test(f.type))].slice(0, 4));
  const onPaste = (e: ClipboardEvent) => {
    const imgs = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
    if (imgs.length) add(imgs);
  };
  const send = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('kind', kind);
      fd.append('title', title);
      fd.append('body', body);
      files.forEach((f) => fd.append('screenshot', f, f.name));
      return api.sendFeedback(fd);
    },
    onSuccess: () => { toast.success('Thanks! The team will look at it.'); setTitle(''); setBody(''); setFiles([]); onSent(); },
    onError: (e) => toast.danger(e instanceof ApiError ? e.message : 'Could not send'),
  });
  return (
    <Card className="p-2" onPaste={onPaste}>
      <Card.Header>
        <Card.Title>Tell us</Card.Title>
        <Card.Description>Something broken or confusing? An idea that would help you make better videos? Screenshots help a lot — you can paste them here.</Card.Description>
      </Card.Header>
      <Card.Content className="flex flex-col gap-4">
        <div className="flex gap-2">
          <Button size="sm" variant={kind === 'bug' ? 'primary' : 'tertiary'} onPress={() => setKind('bug')}>Report a problem</Button>
          <Button size="sm" variant={kind === 'suggestion' ? 'primary' : 'tertiary'} onPress={() => setKind('suggestion')}>Suggest an improvement</Button>
        </div>
        <TextField value={title} onChange={setTitle}><Label>Title</Label><Input placeholder={kind === 'bug' ? 'e.g. The preview stays blank after a render' : 'e.g. Let me pick a music track'} /></TextField>
        <div className="flex flex-col gap-1">
          <label htmlFor="fb-body" className="text-sm font-medium">{kind === 'bug' ? 'What happened, and what did you expect?' : 'Describe your idea'}</label>
          <textarea id="fb-body" value={body} onChange={(e) => setBody(e.target.value)} rows={5}
            className="w-full rounded-xl border border-[#d6e2f5] bg-white p-3 text-sm outline-none focus:border-[#2970EC] max-md:text-base" />
        </div>
        <div>
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => { if (e.target.files) add([...e.target.files]); e.target.value = ''; }} />
          <div className="flex flex-wrap items-center gap-2">
            {previews.map((u, i) => (
              <div key={u} className="relative">
                <img src={u} alt="" className="h-20 w-28 rounded-lg border border-[#d6e2f5] object-cover" />
                <button type="button" aria-label="Remove screenshot" className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-white text-[#5b6b8f] shadow" onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}><Icon name="x" size={12} /></button>
              </div>
            ))}
            {files.length < 4 && <Button size="sm" variant="secondary" onPress={() => input.current?.click()}><Icon name="image" size={14} /> Add screenshot</Button>}
          </div>
        </div>
      </Card.Content>
      <Card.Footer className="justify-end">
        <Button variant="primary" isDisabled={send.isPending || title.trim().length < 3 || body.trim().length < 5} onPress={() => send.mutate()}>
          {send.isPending ? <Spinner size="sm" color="current" /> : 'Send'}
        </Button>
      </Card.Footer>
    </Card>
  );
}

export function ImprovementsPage() {
  usePageTitle('Improvements');
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['feedback'], queryFn: () => api.myFeedback().then((r) => r.items) });
  return (
    <div className="scroll-y h-full">
      <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 sm:py-8">
        <Link to="/" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-[#5b6b8f] hover:text-[#2970ec]"><Icon name="chevron" size={14} className="rotate-180" /> Your videos</Link>
        <h1 className="mb-4 text-2xl font-bold text-[#1557d1]">Improvements</h1>
        <div className="flex flex-col gap-4">
          <NewReport onSent={() => void qc.invalidateQueries({ queryKey: ['feedback'] })} />
          {q.data && q.data.length > 0 && <h2 className="mt-2 text-sm font-semibold uppercase tracking-wide text-[#8a97b5]">Your reports</h2>}
          {q.data?.map((f) => (
            <FeedbackCard key={f.id} f={f}><p className="text-xs text-[#5b6b8f]">{STATUS[f.status].hint}</p></FeedbackCard>
          ))}
        </div>
      </div>
    </div>
  );
}
