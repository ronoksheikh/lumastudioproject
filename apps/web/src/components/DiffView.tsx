/** Renders a unified diff (git's, or the +/-/space line format the agent's file tools emit). */
export function DiffView({ diff, empty = 'No changes' }: { diff: string; empty?: string }) {
  if (!diff.trim()) return <p className="p-3 text-sm text-[#5b6b8f]">{empty}</p>;
  const lines = diff.split('\n');
  return (
    <div className="diff overflow-auto rounded-lg border border-[var(--border)] bg-white py-1" role="region" aria-label="Changes">
      {lines.map((l, i) => {
        let cls = '';
        if (l.startsWith('diff --git') || l.startsWith('+++ ') || l.startsWith('--- ')) cls = 'file';
        else if (l.startsWith('@@')) cls = 'hunk';
        else if (l.startsWith('+')) cls = 'add';
        else if (l.startsWith('-')) cls = 'del';
        return <div key={i} className={cls}>{l || ' '}</div>;
      })}
    </div>
  );
}
