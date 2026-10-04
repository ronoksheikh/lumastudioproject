// Admin panel (ADMIN_EMAILS): what's rendering right now, agent runs, workers, sales through PayStation, users.
// Refreshes every 5 seconds.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, Chip, Input, ProgressBar, Skeleton, Tabs, TextField, toast } from '@heroui/react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api, type AdminOverview, type AdminUser } from '../api/client';
import { Button } from '../components/Button';
import { fmtRenderTime } from '../components/BuyRenderHours';
import { Icon } from '../components/Icon';

const msg = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong');
const bdt = (n: number) => `৳${Math.round(n).toLocaleString('en-US')}`;
const hrs = (h: number) => (h >= 10 ? `${Math.round(h)} h` : `${h.toFixed(1)} h`);
const ago = (t: number | null, now: number) => {
  if (!t) return '—';
  const s = Math.max(0, Math.round((now - t) / 1000));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(t).toLocaleDateString();
};
const gb = (b: number) => `${(b / 1024 ** 3).toFixed(1)} GB`;

function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'live' }) {
  return (
    <div className="rounded-2xl border border-[#d6e2f5] bg-white p-4">
      <p className="flex items-center gap-1.5 text-xs font-medium text-[#5b6b8f]">{tone === 'live' && <span className="pulse inline-block h-2 w-2 rounded-full bg-[#2970EC]" />}{label}</p>
      <p className="mt-1 text-2xl font-bold text-[#1557d1]">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-[#5b6b8f]">{sub}</p>}
    </div>
  );
}

function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <Card className="p-2">
      <Card.Header className="flex flex-row items-center justify-between gap-2"><Card.Title>{title}</Card.Title>{right}</Card.Header>
      <Card.Content>{children}</Card.Content>
    </Card>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <p className="py-3 text-sm text-[#5b6b8f]">{children}</p>;

function statusChip(s: string) {
  const color = s === 'paid' || s === 'done' ? 'success' : s === 'pending' || s === 'queued' ? 'warning' : s === 'running' ? 'accent' : 'danger';
  return <Chip size="sm" color={color}><Chip.Label>{s}</Chip.Label></Chip>;
}

function Overview({ d }: { d: AdminOverview }) {
  const qc = useQueryClient();
  const check = useMutation({
    mutationFn: (invoice: string) => api.adminCheckPayment(invoice),
    onSuccess: (r) => { toast.success(`Payment is ${r.status}`); void qc.invalidateQueries({ queryKey: ['admin'] }); },
    onError: (e) => toast.danger(msg(e)),
  });
  const online = d.workers.filter((w) => w.online).length;
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat tone="live" label="Rendering now" value={d.renders.running} sub={`${d.renders.queued} queued`} />
        <Stat tone="live" label="Agents working" value={d.agents.running} sub={`${d.agents.runsLast24h} runs in 24 h`} />
        <Stat label="Sales today" value={bdt(d.sales.today.amountBdt)} sub={`${d.sales.today.orders} orders · ${hrs(d.sales.today.hours)}`} />
        <Stat label="Sales all time" value={bdt(d.sales.allTime.amountBdt)} sub={`${d.sales.allTime.orders} orders`} />
        <Stat label="Sales 7 days" value={bdt(d.sales.last7d.amountBdt)} sub={`${d.sales.last7d.orders} orders`} />
        <Stat label="Sales 30 days" value={bdt(d.sales.last30d.amountBdt)} sub={`${d.sales.last30d.orders} orders`} />
        <Stat label="Students" value={d.users.total} sub={`${d.users.active24h} active today · ${d.users.new7d} new this week`} />
        <Stat label="Renders (24 h)" value={d.renders.last24h.done} sub={`${d.renders.last24h.failed} failed · ${d.renders.totalDone} all time`} />
        <Stat label="Render hours (24 h)" value={hrs(d.renders.last24h.freeHours + d.renders.last24h.fastHours)} sub={`${hrs(d.renders.last24h.freeHours)} free · ${hrs(d.renders.last24h.fastHours)} fast`} />
        <Stat label="Fast hours owed" value={hrs(d.sales.fastHoursOutstanding)} sub="bought, not used yet" />
        <Stat label="Render workers" value={`${online}/${d.workers.length}`} sub="online" />
        <Stat label="Server" value={d.cpu ? `${Math.round(d.cpu.usage * 100)}% CPU` : '—'} sub={d.disk ? `${gb(d.disk.freeBytes)} disk free of ${gb(d.disk.totalBytes)}` : undefined} />
      </div>

      {!d.sales.paymentsEnabled && <p className="rounded-xl bg-[#eff5ff] px-4 py-3 text-sm text-[#1557d1]">PayStation is not configured (PAYSTATION_MERCHANT_ID / PAYSTATION_PASSWORD) — students can't buy fast hours yet.</p>}

      <Section title="Rendering now">
        {d.renders.active.length === 0 ? <Empty>Nothing is rendering.</Empty> : (
          <div className="flex flex-col gap-3">
            {d.renders.active.map((j) => (
              <div key={j.id} className="rounded-xl border border-[#e3ecfb] p-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {statusChip(j.status)}
                  <Chip size="sm" color={j.pool === 'remote' ? 'accent' : 'default'}><Chip.Label>{j.pool === 'remote' ? `fast${j.worker ? ` · ${j.worker}` : ''}` : 'free'}</Chip.Label></Chip>
                  <span className="font-semibold">{j.project}</span>
                  <span className="text-[#5b6b8f]">{j.user} · {j.preset}</span>
                  <span className="ml-auto text-xs text-[#5b6b8f]">{j.startedAt ? `started ${ago(j.startedAt, d.now)}` : `waiting ${ago(j.createdAt, d.now)}`}</span>
                </div>
                {j.status === 'running' && (
                  <ProgressBar className="mt-2" value={j.progress} aria-label="Render progress"><ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track></ProgressBar>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Recent purchases" right={<span className="text-xs text-[#5b6b8f]">{d.sales.pending} pending · {d.sales.failed} failed · {bdt(d.sales.pricePerHourBdt)}/hour</span>}>
        {d.sales.recent.length === 0 ? <Empty>No purchases yet.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="text-left text-xs text-[#5b6b8f]"><th className="py-2">When</th><th>Student</th><th>Hours</th><th>Amount</th><th>Status</th><th>Method</th><th>Invoice / trx</th><th /></tr></thead>
              <tbody>
                {d.sales.recent.map((p) => (
                  <tr key={p.id} className="border-t border-[#eef3fb]">
                    <td className="py-2 text-[#5b6b8f]">{ago(p.createdAt, d.now)}</td>
                    <td>{p.user}</td>
                    <td>{p.hours}</td>
                    <td className="font-semibold">{p.provider === 'grant' ? 'granted' : bdt(p.amountBdt)}</td>
                    <td>{statusChip(p.status)}</td>
                    <td>{p.method ?? '—'}</td>
                    <td className="mono text-xs">{p.invoice ?? '—'}{p.trxId ? ` / ${p.trxId}` : ''}</td>
                    <td>{p.status === 'pending' && p.invoice && <Button size="sm" variant="tertiary" isDisabled={check.isPending} onPress={() => check.mutate(p.invoice!)}>Re-check</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Render workers">
          {d.workers.length === 0 ? <Empty>No workers registered (`admin worker-add &lt;name&gt;`). Fast renders run on this server.</Empty> : (
            <ul className="flex flex-col gap-2 text-sm">
              {d.workers.map((w) => (
                <li key={w.id} className="flex items-center gap-2">
                  <span className={`inline-block h-2.5 w-2.5 rounded-full ${w.online ? 'bg-[#22a06b]' : 'bg-[#c9d3e6]'}`} />
                  <span className="font-medium">{w.name}</span>
                  {w.disabled && <Chip size="sm"><Chip.Label>disabled</Chip.Label></Chip>}
                  <span className="ml-auto text-xs text-[#5b6b8f]">last seen {ago(w.lastSeenAt, d.now)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Failed renders (7 days)">
          {d.renders.failedRecent.length === 0 ? <Empty>None.</Empty> : (
            <ul className="flex flex-col gap-2 text-sm">
              {d.renders.failedRecent.map((f) => (
                <li key={f.id} className="rounded-lg bg-[#f7f9fd] p-2">
                  <p><span className="font-medium">{f.project}</span> <span className="text-[#5b6b8f]">· {f.user} · {ago(f.at, d.now)}</span></p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-[#5b6b8f]">{f.error}</p>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

function Users() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const list = useQuery({ queryKey: ['admin', 'users', q], queryFn: () => api.adminUsers(q).then((r) => r.users) });
  const grant = useMutation({
    mutationFn: ({ u, hours }: { u: AdminUser; hours: number }) => api.adminGrantHours(u.id, hours),
    onSuccess: () => { toast.success('Fast hours granted'); void qc.invalidateQueries({ queryKey: ['admin'] }); },
    onError: (e) => toast.danger(msg(e)),
  });
  const ban = useMutation({
    mutationFn: ({ u, banned }: { u: AdminUser; banned: boolean }) => api.adminBan(u.id, banned),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin'] }),
    onError: (e) => toast.danger(msg(e)),
  });
  return (
    <Section title="Students" right={<TextField value={q} onChange={setQ} aria-label="Search by e-mail"><Input placeholder="Search e-mail…" className="w-48" /></TextField>}>
      {!list.data ? <Skeleton className="h-32 rounded-xl" /> : list.data.length === 0 ? <Empty>No students found.</Empty> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="text-left text-xs text-[#5b6b8f]"><th className="py-2">E-mail</th><th>Projects</th><th>Free used (24 h)</th><th>Fast left</th><th>Spent</th><th>Joined</th><th /></tr></thead>
            <tbody>
              {list.data.map((u) => (
                <tr key={u.id} className="border-t border-[#eef3fb]">
                  <td className="py-2">{u.email} {u.banned && <Chip size="sm" color="danger"><Chip.Label>suspended</Chip.Label></Chip>}</td>
                  <td>{u.projects}</td>
                  <td>{fmtRenderTime(u.freeSecondsUsed24h)}</td>
                  <td>{fmtRenderTime(u.fastSecondsLeft)}</td>
                  <td>{bdt(u.spentBdt)}</td>
                  <td className="text-[#5b6b8f]">{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td className="flex justify-end gap-1 py-1.5">
                    <Button size="sm" variant="tertiary" isDisabled={grant.isPending} onPress={() => {
                      const h = Number(window.prompt(`Grant fast render hours to ${u.email}:`, '1'));
                      if (h > 0) grant.mutate({ u, hours: h });
                    }}>Grant hours</Button>
                    <Button size="sm" variant={u.banned ? 'secondary' : 'danger'} isDisabled={ban.isPending} onPress={() => {
                      if (u.banned || window.confirm(`Suspend ${u.email}? They are signed out and can't log in.`)) ban.mutate({ u, banned: !u.banned });
                    }}>{u.banned ? 'Restore' : 'Suspend'}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

export function AdminPage() {
  const q = useQuery({ queryKey: ['admin', 'overview'], queryFn: () => api.adminOverview(), refetchInterval: 5000 });
  const [tab, setTab] = useState('overview');
  return (
    <div className="scroll-y h-full">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <Link to="/" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-[#5b6b8f] hover:text-[#2970ec]"><Icon name="chevron" size={14} className="rotate-180" /> Your videos</Link>
        <h1 className="mb-4 text-2xl font-bold text-[#1557d1]">Admin</h1>
        <Tabs selectedKey={tab} onSelectionChange={(k) => setTab(String(k))} variant="secondary">
          <Tabs.ListContainer className="scroll-x overflow-x-auto">
            <Tabs.List aria-label="Admin sections">
              <Tabs.Tab id="overview">Overview<Tabs.Indicator /></Tabs.Tab>
              <Tabs.Tab id="users">Students<Tabs.Indicator /></Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>
          <Tabs.Panel id="overview" className="pt-5">
            {q.error ? <p className="text-sm text-[#b42318]">{msg(q.error)}</p> : !q.data ? <Skeleton className="h-64 rounded-2xl" /> : <Overview d={q.data} />}
          </Tabs.Panel>
          <Tabs.Panel id="users" className="pt-5">{tab === 'users' && <Users />}</Tabs.Panel>
        </Tabs>
      </div>
    </div>
  );
}
