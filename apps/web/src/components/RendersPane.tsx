import { useQuery } from '@tanstack/react-query';
import { Chip, Skeleton } from '@heroui/react';
import { api } from '../api/client';
import { formatBytes, timeAgo, useInvalidateOn } from '../lib/hooks';
import { Icon } from './Icon';

export function RendersPane({ projectId, tick }: { projectId: string; tick: number }) {
  const q = useQuery({ queryKey: ['renders', projectId], queryFn: () => api.renders(projectId).then((r) => r.renders) });
  useInvalidateOn([['renders', projectId]], tick);
  if (q.isLoading) return <Skeleton className="m-3 h-40 rounded-xl" />;
  const items = q.data ?? [];
  if (!items.length) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div>
          <Icon name="film" size={28} className="mx-auto mb-2 text-[#2970ec]" />
          <h3 className="font-semibold text-[#1557d1]">No renders yet</h3>
          <p className="mt-1 max-w-xs text-sm text-[#5b6b8f]">When the preview looks right, ask Luma to “render a draft” (fast) or “render the final” (1080p60).</p>
        </div>
      </div>
    );
  }
  return (
    <ul className="scroll-y grid h-full content-start gap-4 p-3 lg:grid-cols-2">
      {items.map((r) => (
        <li key={r.id} className="overflow-hidden rounded-xl border border-[var(--border)]">
          <video src={r.url} controls preload="metadata" poster={r.contactSheetUrl ?? undefined} className="aspect-video w-full bg-black" aria-label={`${r.preset} render`} />
          <div className="flex items-center gap-2 p-2.5 text-xs text-[#5b6b8f]">
            <Chip size="sm" color={r.preset === 'final' ? 'accent' : 'default'}><Chip.Label>{r.preset}</Chip.Label></Chip>
            <span>{timeAgo(r.createdAt)}</span>
            {r.size != null && <span>· {formatBytes(r.size)}</span>}
            <a href={r.url} download className="ml-auto inline-flex items-center gap-1 font-semibold text-[#2970ec]"><Icon name="download" size={13} /> Download</a>
          </div>
        </li>
      ))}
    </ul>
  );
}
