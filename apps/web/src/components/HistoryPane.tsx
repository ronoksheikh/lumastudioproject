import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertDialog, Button, Chip, Skeleton, Spinner, toast } from '@heroui/react';
import { useState } from 'react';
import { api, ApiError } from '../api/client';
import { timeAgo, useInvalidateOn } from '../lib/hooks';
import { DiffView } from './DiffView';
import { Icon } from './Icon';

export function HistoryPane({ projectId, tick, running, onRestored }: { projectId: string; tick: number; running: boolean; onRestored: () => void }) {
  const qc = useQueryClient();
  const log = useQuery({ queryKey: ['gitlog', projectId], queryFn: () => api.gitLog(projectId, 100).then((r) => r.commits) });
  useInvalidateOn([['gitlog', projectId]], tick);
  const [sha, setSha] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const detail = useQuery({ queryKey: ['commit', projectId, sha], queryFn: () => api.gitCommit(projectId, sha!).then((r) => r.commit), enabled: !!sha });
  const restore = useMutation({
    mutationFn: () => api.gitRestore(projectId, sha!),
    onSuccess: (r) => {
      toast.success(r.unchanged ? 'The project already matches that snapshot' : 'Restored — saved as a new snapshot');
      void qc.invalidateQueries({ queryKey: ['gitlog', projectId] });
      void qc.invalidateQueries({ queryKey: ['tree', projectId] });
      onRestored();
    },
    onError: (e) => toast.danger(e instanceof ApiError ? e.message : 'Could not restore'),
  });
  const commits = log.data ?? [];
  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(220px,40%)_1fr]">
      <ol className="scroll-y border-r border-[var(--border)] p-2" aria-label="Snapshots">
        {log.isLoading && <Skeleton className="h-40 rounded-lg" />}
        {commits.map((c, i) => (
          <li key={c.sha}>
            <button onClick={() => setSha(c.sha)} aria-current={sha === c.sha} className={`w-full rounded-lg px-2.5 py-2 text-left ${sha === c.sha ? 'bg-[#e3edff]' : 'hover:bg-[#eff5ff]'}`}>
              <span className="flex items-center gap-1.5 text-[11px] text-[#5b6b8f]"><Icon name="clock" size={11} />{timeAgo(c.time)}{i === 0 && <Chip size="sm" color="accent"><Chip.Label>latest</Chip.Label></Chip>}</span>
              <span className="mt-0.5 block text-[13px] font-medium leading-snug">{c.message}</span>
              <span className="mono mt-0.5 block text-[11px] text-[#8a97b5]">{c.sha.slice(0, 7)} · {c.files} files · <span className="text-[#14753b]">+{c.additions}</span> <span className="text-[#b42318]">−{c.deletions}</span></span>
            </button>
          </li>
        ))}
      </ol>
      <div className="scroll-y min-w-0 p-3">
        {!sha && <p className="text-sm text-[#5b6b8f]">Every time Luma finishes a turn, the project is saved as a snapshot. Pick one to see what changed, or go back to it.</p>}
        {sha && detail.isLoading && <Spinner />}
        {detail.data && (
          <div className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">{detail.data.message}</h3>
                <p className="mono text-xs text-[#5b6b8f]">{detail.data.sha.slice(0, 10)} · {new Date(detail.data.time).toLocaleString()}</p>
              </div>
              <Button size="sm" variant="secondary" isDisabled={running || commits[0]?.sha === detail.data.sha} onPress={() => setConfirm(true)}><Icon name="undo" size={14} /> Restore this version</Button>
            </div>
            {running && <p className="text-xs text-[#7a4a00]">Wait for Luma to finish before restoring.</p>}
            <ul className="flex flex-wrap gap-1.5">{detail.data.changes.map((c) => <li key={c.path} className="mono rounded border border-[var(--border)] px-1.5 py-0.5 text-[11px]">{c.status} {c.path} <span className="text-[#14753b]">+{c.additions}</span> <span className="text-[#b42318]">−{c.deletions}</span></li>)}</ul>
            <DiffView diff={detail.data.diff} />
            {detail.data.diffTruncated && <p className="text-xs text-[#5b6b8f]">The diff is long — only the first part is shown.</p>}
          </div>
        )}
      </div>
      <AlertDialog.Backdrop isOpen={confirm} onOpenChange={setConfirm}>
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-[420px]">
            <AlertDialog.Header><AlertDialog.Icon status="warning" /><AlertDialog.Heading>Restore this version?</AlertDialog.Heading></AlertDialog.Header>
            <AlertDialog.Body><p>Your project goes back to this snapshot. Nothing is lost: the current state stays in the history, and the restore itself becomes a new snapshot.</p></AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="tertiary">Cancel</Button>
              <Button slot="close" variant="primary" onPress={() => restore.mutate()}>Restore</Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </div>
  );
}
