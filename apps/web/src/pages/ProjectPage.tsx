import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Chip, Skeleton, Tabs, toast } from '@heroui/react';
import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { Composer } from '../components/Composer';
import { ChatList, PlanCard } from '../components/Chat';
import { FilesPane } from '../components/FilesPane';
import { HistoryPane } from '../components/HistoryPane';
import { Icon } from '../components/Icon';
import { PreviewContext } from '../components/preview-context';
import { PreviewPane } from '../components/PreviewPane';
import { RendersPane } from '../components/RendersPane';
const TerminalPane = lazy(() => import('../components/TerminalPane').then((m) => ({ default: m.TerminalPane })));
import { useModels, useProject } from '../lib/hooks';
import { currentPlan, useLive } from '../stores/live';

const RIGHT_TABS = [
  ['preview', 'Preview', 'play'],
  ['files', 'Files', 'folder'],
  ['renders', 'Renders', 'film'],
  ['history', 'History', 'git'],
  ['terminal', 'Terminal', 'terminal'],
] as const;

function Title({ id, title }: { id: string; title: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const qc = useQueryClient();
  const rename = useMutation({
    mutationFn: (t: string) => api.renameProject(id, t),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['project', id] }); void qc.invalidateQueries({ queryKey: ['projects'] }); },
    onError: (e) => toast.danger(e instanceof ApiError ? e.message : 'Could not rename'),
  });
  useEffect(() => setValue(title), [title]);
  const commit = () => {
    setEditing(false);
    if (value.trim() && value.trim() !== title) rename.mutate(value.trim());
    else setValue(title);
  };
  return editing ? (
    <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setEditing(false); setValue(title); } }}
      aria-label="Project title" className="min-w-0 rounded-md border border-[#2970ec] px-2 py-0.5 text-base font-semibold outline-none" />
  ) : (
    <button onClick={() => setEditing(true)} className="group flex min-w-0 items-center gap-1.5 rounded-md px-1 text-left hover:bg-[#eff5ff]" title="Rename project">
      <span className="truncate text-base font-semibold">{title}</span>
      <Icon name="pencil" size={13} className="flex-none text-[#8a97b5] opacity-0 group-hover:opacity-100" />
    </button>
  );
}

export function ProjectPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const project = useProject(id);
  const models = useModels();
  const live = useLive();
  const [tab, setTab] = useState<string>('preview');
  const [mobilePane, setMobilePane] = useState<'chat' | 'work'>('chat');
  const [pending, setPending] = useState<Array<{ key: string; text: string }>>([]);
  const [modelId, setModelId] = useState<string | undefined>(() => localStorage.getItem('luma.model') ?? undefined);
  const [reloadKey, setReloadKey] = useState(0);

  // ---- load history + follow a running agent ----
  useEffect(() => {
    live.reset(id);
    void live.loadProject(id).catch(() => {});
    return () => live.reset(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const messages = useQuery({ queryKey: ['messages', id], queryFn: () => api.messages(id).then((r) => r.messages) });

  const order = live.order[id] ?? [];
  const activeRun = live.active[id] ?? null;
  const running = !!activeRun;
  const tick = live.tick[id] ?? 0;
  const plan = currentPlan(live, id);

  // a message list entry exists as soon as the run starts; keep it fresh as runs finish
  useEffect(() => { void qc.invalidateQueries({ queryKey: ['messages', id] }); }, [id, qc, order.length, running]);

  // ---- model choice ----
  const modelList = models.data ?? [];
  useEffect(() => {
    if (modelList.length && !modelList.some((m) => m.id === modelId)) setModelId((modelList.find((m) => m.isDefault) ?? modelList[0])!.id);
  }, [modelList, modelId]);
  const chooseModel = (v: string) => { setModelId(v); localStorage.setItem('luma.model', v); };

  // ---- preview: signed URL on the preview origin, refreshed before it expires ----
  const token = useQuery({
    queryKey: ['preview-token', id],
    queryFn: () => api.previewToken(id),
    refetchInterval: 40 * 60 * 1000,
    staleTime: 30 * 60 * 1000,
  });
  // the preview/files/history follow the agent: reload (debounced) when it changes things
  useEffect(() => {
    if (!tick) return;
    const t = setTimeout(() => setReloadKey((k) => k + 1), 900);
    return () => clearTimeout(t);
  }, [tick]);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  // what the project holds (scenes yet?) follows the agent too
  useEffect(() => { if (reloadKey) void qc.invalidateQueries({ queryKey: ['project', id] }); }, [reloadKey, id, qc]);
  const previewCtx = useMemo(() => ({ base: token.data?.url ?? null, reloadKey, reload, projectId: id }), [token.data?.url, reloadKey, reload, id]);

  const send = async (text: string, attachmentIds: string[]) => {
    const key = `p-${Date.now()}`;
    setPending((p) => [...p, { key, text }]);
    try {
      await live.start(id, text, attachmentIds, modelId);
      await qc.refetchQueries({ queryKey: ['messages', id] });
    } finally {
      setPending((p) => p.filter((x) => x.key !== key));
    }
  };

  if (project.isLoading) return <div className="p-6"><Skeleton className="h-10 w-64 rounded-lg" /></div>;
  if (project.error || !project.data) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div><h1 className="text-xl font-bold text-[#1557d1]">Project not found</h1><Link to="/" className="mt-2 inline-block font-semibold text-[#2970ec]">Back to your projects</Link></div>
      </div>
    );
  }
  const p = project.data;
  const awaiting = order.some((rid) => live.turns[rid]?.blocks.some((b) => b.kind === 'ask' && b.answer === undefined) && live.turns[rid]?.status === 'running');

  return (
    <PreviewContext.Provider value={previewCtx}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-12 min-w-0 flex-none items-center gap-2 border-b border-[var(--border)] bg-white px-3 sm:gap-3">
          <Link to="/" aria-label="Back to projects" className="grid h-8 w-8 place-items-center rounded-lg text-[#5b6b8f] hover:bg-[#eff5ff]"><Icon name="chevron" size={16} className="rotate-180" /></Link>
          <Title id={id} title={p.title} />
          <Chip size="sm" color="accent"><Chip.Label>{p.aspect}</Chip.Label></Chip>
          {running && <Chip size="sm" color="warning"><Chip.Label>{awaiting ? 'waiting for you' : 'working'}</Chip.Label></Chip>}
          <div className="ml-auto flex rounded-lg bg-[#eff5ff] p-0.5 text-xs font-medium lg:hidden" role="tablist" aria-label="Pane">
            {(['chat', 'work'] as const).map((k) => (
              <button key={k} role="tab" aria-selected={mobilePane === k} onClick={() => setMobilePane(k)} className={`rounded-md px-3 py-1 ${mobilePane === k ? 'bg-white text-[#2970ec] shadow-sm' : 'text-[#5b6b8f]'}`}>{k === 'chat' ? 'Chat' : 'Video'}</button>
            ))}
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(380px,40%)_minmax(0,1fr)]">
          <section aria-label="Chat" className={`${mobilePane === 'chat' ? 'flex' : 'hidden'} min-h-0 min-w-0 flex-col border-r border-[var(--border)] lg:flex`}>
            {plan && <div className="flex-none px-3 pt-3"><PlanCard items={plan} /></div>}
            <ChatList
              messages={messages.data ?? []}
              turns={live.turns}
              pending={pending.filter((x) => !(messages.data ?? []).some((m) => m.text.startsWith(x.text)))}
              onAnswer={(runId, a) => void live.answer(id, runId, a).catch((e) => toast.danger(e instanceof ApiError ? e.message : 'Could not send the answer'))}
            />
            <Composer projectId={id} models={modelList} modelId={modelId} onModelChange={chooseModel} running={running} onSend={send} onStop={() => void live.stop(id)} />
          </section>

          <section aria-label="Work area" className={`${mobilePane === 'work' ? 'flex' : 'hidden'} min-h-0 min-w-0 flex-col lg:flex`}>
            <Tabs selectedKey={tab} onSelectionChange={(k) => setTab(String(k))} className="flex min-h-0 flex-1 flex-col" variant="secondary">
              <Tabs.ListContainer className="scroll-x flex-none overflow-x-auto px-3 pt-1">
                <Tabs.List aria-label="Project views">
                  {RIGHT_TABS.map(([k, label, icon]) => (
                    <Tabs.Tab key={k} id={k}><span className="flex items-center gap-1.5"><Icon name={icon} size={14} />{label}</span><Tabs.Indicator /></Tabs.Tab>
                  ))}
                </Tabs.List>
              </Tabs.ListContainer>
              <Tabs.Panel id="preview" className="min-h-0 flex-1"><PreviewPane aspect={p.aspect} empty={p.content?.scenes === false} /></Tabs.Panel>
              <Tabs.Panel id="files" className="min-h-0 flex-1">{tab === 'files' && <FilesPane projectId={id} tick={tick} />}</Tabs.Panel>
              <Tabs.Panel id="renders" className="min-h-0 flex-1">{tab === 'renders' && <RendersPane projectId={id} tick={tick} />}</Tabs.Panel>
              <Tabs.Panel id="history" className="min-h-0 flex-1">{tab === 'history' && <HistoryPane projectId={id} tick={tick} running={running} onRestored={reload} />}</Tabs.Panel>
              <Tabs.Panel id="terminal" className="min-h-0 flex-1"><Suspense fallback={<Skeleton className="m-3 h-40 rounded-lg" />}><TerminalPane projectId={id} turns={live.turns} order={order} tick={tick} /></Suspense></Tabs.Panel>
            </Tabs>
          </section>
        </div>
      </div>
    </PreviewContext.Provider>
  );
}
