import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@heroui/react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import type { TreeEntry } from '../api/types';
import { formatBytes, useInvalidateOn } from '../lib/hooks';
import { Icon } from './Icon';
import { usePreview } from './preview-context';

interface Node { name: string; path: string; type: 'file' | 'dir'; size?: number; children: Node[] }

function buildTree(entries: TreeEntry[]): Node[] {
  const root: Node = { name: '', path: '', type: 'dir', children: [] };
  const dirs = new Map<string, Node>([['', root]]);
  for (const e of [...entries].sort((a, b) => a.path.localeCompare(b.path))) {
    const parts = e.path.split('/');
    const parentPath = parts.slice(0, -1).join('/');
    const parent = dirs.get(parentPath) ?? root;
    const node: Node = { name: parts.at(-1)!, path: e.path, type: e.type, size: e.size, children: [] };
    parent.children.push(node);
    if (e.type === 'dir') dirs.set(e.path, node);
  }
  const sort = (n: Node) => {
    n.children.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
    n.children.forEach(sort);
  };
  sort(root);
  return root.children;
}

function Row({ n, depth, open, toggle, selected, onSelect }: { n: Node; depth: number; open: Set<string>; toggle: (p: string) => void; selected: string | null; onSelect: (p: string) => void }) {
  const isOpen = open.has(n.path);
  return (
    <li role="none">
      <button
        role="treeitem" aria-expanded={n.type === 'dir' ? isOpen : undefined} aria-selected={selected === n.path}
        onClick={() => (n.type === 'dir' ? toggle(n.path) : onSelect(n.path))}
        style={{ paddingLeft: 8 + depth * 14 }}
        className={`flex w-full items-center gap-1.5 rounded-md py-1 pr-2 text-left text-[13px] ${selected === n.path ? 'bg-[#e3edff] font-medium text-[#07358f]' : 'hover:bg-[#eff5ff]'}`}
      >
        <Icon name={n.type === 'dir' ? (isOpen ? 'down' : 'chevron') : 'file'} size={13} className={n.type === 'dir' ? 'text-[#5b6b8f]' : 'text-[#2970ec]'} />
        <span className="mono truncate">{n.name}</span>
        {n.type === 'file' && n.size != null && <span className="ml-auto flex-none text-[10px] text-[#8a97b5]">{formatBytes(n.size)}</span>}
      </button>
      {n.type === 'dir' && isOpen && <ul role="group">{n.children.map((c) => <Row key={c.path} n={c} depth={depth + 1} open={open} toggle={toggle} selected={selected} onSelect={onSelect} />)}</ul>}
    </li>
  );
}

function CodeView({ value, path }: { value: string; path: string }) {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<{ show(v: string, p: string): void; dispose(): void } | null>(null);
  useEffect(() => {
    let alive = true;
    void import('../monaco/viewer').then((m) => {
      if (!alive || !host.current) return;
      viewer.current ??= m.createViewer(host.current);
      viewer.current.show(value, path);
    });
    return () => { alive = false; };
  }, [value, path]);
  useEffect(() => () => { viewer.current?.dispose(); viewer.current = null; }, []);
  return <div ref={host} className="min-h-0 flex-1" data-testid="code-viewer" />;
}

const checker = 'bg-[length:16px_16px] bg-[linear-gradient(45deg,#eef3fc_25%,transparent_25%,transparent_75%,#eef3fc_75%),linear-gradient(45deg,#eef3fc_25%,transparent_25%,transparent_75%,#eef3fc_75%)] bg-[position:0_0,8px_8px]';

function Viewer({ projectId, path }: { projectId: string; path: string }) {
  const { reloadKey } = usePreview();
  const file = useQuery({ queryKey: ['file', projectId, path, reloadKey], queryFn: () => api.file(projectId, path) });
  const [svgMode, setSvgMode] = useState<'preview' | 'code'>('preview');
  const raw = api.rawUrl(projectId, path, reloadKey);
  const download = api.rawUrl(projectId, path, reloadKey, true);
  const name = path.split('/').pop() ?? path;

  if (file.isLoading) return <Skeleton className="m-3 h-40 rounded-lg" />;
  if (file.error || !file.data) return <p className="p-4 text-sm text-[#b42318]">Couldn’t open this file{file.error instanceof Error ? `: ${file.error.message}` : '.'}</p>;
  const f = file.data;

  let body: ReactNode;
  switch (f.kind) {
    case 'text':
      body = <CodeView value={f.content ?? ''} path={path} />;
      break;
    case 'svg':
      body = svgMode === 'code'
        ? <CodeView value={f.content ?? ''} path={path} />
        : <div className={`grid min-h-0 flex-1 place-items-center overflow-auto p-6 ${checker}`}><img src={raw} alt={name} className="max-h-full max-w-full" data-testid="file-preview" /></div>;
      break;
    case 'image':
      body = <div className={`grid min-h-0 flex-1 place-items-center overflow-auto p-6 ${checker}`}><img src={raw} alt={name} className="max-h-full max-w-full rounded-lg shadow" data-testid="file-preview" /></div>;
      break;
    case 'audio':
      body = <div className="grid min-h-0 flex-1 place-items-center bg-[#eff5ff] p-6"><audio controls preload="metadata" src={raw} className="w-full max-w-md" data-testid="file-preview" /></div>;
      break;
    case 'video':
      body = <div className="grid min-h-0 flex-1 place-items-center bg-[#eff5ff] p-4"><video controls preload="metadata" src={raw} className="max-h-full max-w-full rounded-lg shadow" data-testid="file-preview" /></div>;
      break;
    case 'pdf':
      body = <iframe src={raw} title={name} className="min-h-0 w-full flex-1 border-0 bg-[#eff5ff]" data-testid="file-preview" />;
      break;
    default:
      body = (
        <div className="grid min-h-0 flex-1 place-items-center p-6">
          <div className="max-w-xs rounded-2xl border border-[var(--border)] bg-[#fafcff] p-6 text-center" data-testid="file-preview">
            <Icon name="file" size={26} className="mx-auto mb-2 text-[#2970ec]" />
            <p className="text-sm font-semibold">Can’t preview this file</p>
            <p className="mt-1 text-xs text-[#5b6b8f]">{name} · {formatBytes(f.bytes ?? 0)}</p>
            <a href={download} className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[#2970ec] px-3 py-1.5 text-sm font-medium text-white"><Icon name="download" size={14} /> Download</a>
          </div>
        </div>
      );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none items-center gap-2 border-b border-[var(--separator)] px-3 py-1.5">
        <span className="mono min-w-0 flex-1 truncate text-xs text-[#5b6b8f]" title={path}>{path}</span>
        {f.bytes != null && <span className="flex-none text-[11px] text-[#8a97b5]">{formatBytes(f.bytes)}</span>}
        {f.kind === 'svg' && (
          <div className="flex flex-none rounded-md bg-[#eff5ff] p-0.5 text-[11px] font-medium" role="tablist" aria-label="SVG view">
            {(['preview', 'code'] as const).map((m) => (
              <button key={m} role="tab" aria-selected={svgMode === m} onClick={() => setSvgMode(m)} className={`rounded px-2 py-0.5 ${svgMode === m ? 'bg-white text-[#2970ec] shadow-sm' : 'text-[#5b6b8f]'}`}>{m === 'preview' ? 'Preview' : 'Code'}</button>
            ))}
          </div>
        )}
        {f.kind === 'pdf' && <a href={raw} target="_blank" rel="noreferrer" className="flex-none text-xs font-medium text-[#2970ec]">Open</a>}
        <a href={download} aria-label={`Download ${name}`} title="Download" className="grid h-6 w-6 flex-none place-items-center rounded-md text-[#5b6b8f] hover:bg-[#eff5ff] hover:text-[#2970ec]"><Icon name="download" size={14} /></a>
      </div>
      {f.truncated && (
        <p className="flex-none bg-[#fff7e6] px-3 py-1 text-xs text-[#7a4a00]" role="status">
          Large file — showing part of it{f.totalLines ? ` (${f.totalLines.toLocaleString()} lines)` : ''}. <a href={download} className="font-semibold underline">Download</a> to see everything.
        </p>
      )}
      {body}
    </div>
  );
}

export function FilesPane({ projectId, tick }: { projectId: string; tick: number }) {
  const tree = useQuery({ queryKey: ['tree', projectId], queryFn: () => api.tree(projectId, '.', 6).then((r) => r.entries) });
  useInvalidateOn([['tree', projectId]], tick);
  const nodes = useMemo(() => buildTree(tree.data ?? []), [tree.data]);
  const [open, setOpen] = useState<Set<string>>(new Set(['public', 'public/js', 'public/js/scenes']));
  const [selected, setSelected] = useState<string | null>(null);
  const toggle = (p: string) => setOpen((o) => { const n = new Set(o); n.has(p) ? n.delete(p) : n.add(p); return n; });
  useEffect(() => { if (!selected && tree.data?.some((e) => e.path === 'script.json')) setSelected('script.json'); }, [tree.data, selected]);

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(160px,34%)_1fr]">
      <nav className="scroll-y border-r border-[var(--border)] p-2" aria-label="Project files">
        {tree.isLoading ? <Skeleton className="h-40 rounded-lg" /> : <ul role="tree">{nodes.map((n) => <Row key={n.path} n={n} depth={0} open={open} toggle={toggle} selected={selected} onSelect={setSelected} />)}</ul>}
      </nav>
      <div className="min-h-0 min-w-0">
        {selected ? <Viewer projectId={projectId} path={selected} /> : <p className="p-4 text-sm text-[#5b6b8f]">Pick a file to read it. Files are read-only — ask Luma to change them.</p>}
      </div>
    </div>
  );
}
