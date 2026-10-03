import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@heroui/react';
import { useEffect, useMemo, useRef, useState } from 'react';
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

function Viewer({ projectId, path }: { projectId: string; path: string }) {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<{ show(v: string, p: string): void; dispose(): void } | null>(null);
  const { base, reloadKey } = usePreview();
  const file = useQuery({ queryKey: ['file', projectId, path, reloadKey], queryFn: () => api.file(projectId, path) });
  const isImage = file.data?.kind === 'image';
  const imgSrc = base && isImage ? `${base}${path.replace(/^public\//, '')}?v=${reloadKey}` : null;

  useEffect(() => {
    let alive = true;
    if (file.data?.kind !== 'text' || !host.current) return;
    void import('../monaco/viewer').then((m) => {
      if (!alive || !host.current) return;
      viewer.current ??= m.createViewer(host.current);
      viewer.current.show(file.data!.content ?? '', path);
    });
    return () => { alive = false; };
  }, [file.data, path]);
  useEffect(() => () => { viewer.current?.dispose(); viewer.current = null; }, []);

  if (file.isLoading) return <Skeleton className="m-3 h-40 rounded-lg" />;
  if (file.error) return <p className="p-4 text-sm text-[#b42318]">Couldn’t open this file.</p>;
  if (file.data?.kind === 'binary') return <p className="p-4 text-sm text-[#5b6b8f]">Binary file ({formatBytes(file.data.bytes ?? 0)}) — nothing to show as text.</p>;
  if (isImage) return <div className="grid h-full place-items-center bg-[#eff5ff] p-4">{imgSrc ? <img src={imgSrc} alt={path} className="max-h-full max-w-full rounded-lg bg-white shadow" /> : <p className="text-sm text-[#5b6b8f]">Image ({formatBytes(file.data?.bytes ?? 0)})</p>}</div>;
  return (
    <div className="flex h-full flex-col">
      {file.data?.truncated && <p className="bg-[#fff7e6] px-3 py-1 text-xs text-[#7a4a00]">Showing the first part of this large file.</p>}
      <div ref={host} className="min-h-0 flex-1" data-testid="code-viewer" />
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
