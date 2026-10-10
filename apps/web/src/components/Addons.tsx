// Settings → Add-ons: one-time purchases (bKash, card, Nagad…) (Luma Studio API, source code) and the API keys.
import { Card, Chip, Input, Label, Skeleton, Spinner, TextField, toast } from '@heroui/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api, type Addon } from '../api/client';
import { Button } from './Button';
import { Icon } from './Icon';
import { PayMethodPicker, rememberMethod, savedMethod, type PayMethod } from './PayMethod';

const msg = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong');
const PHONE_KEY = 'luma.payPhone';
const savedPhone = () => {
  try { return localStorage.getItem(PHONE_KEY) ?? ''; } catch { return ''; }
};

function BuyAddon({ a }: { a: Addon }) {
  const [phone, setPhone] = useState(savedPhone);
  const [method, setMethod] = useState<PayMethod>(savedMethod);
  const buy = useMutation({
    mutationFn: () => api.buyAddon(a.id, { phone, method, returnTo: '/settings/addons' }),
    onSuccess: (r) => {
      try { localStorage.setItem(PHONE_KEY, phone); } catch { /* fine */ }
      rememberMethod(method);
      window.location.href = r.paymentUrl;
    },
    onError: (e) => toast.danger(msg(e)),
  });
  if (!a.paymentsEnabled) return <p className="text-sm text-[#5b6b8f]">Online payment isn’t set up yet — contact Lumademy support.</p>;
  return (
    <div className="flex flex-col gap-3">
      <PayMethodPicker value={method} onChange={setMethod} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <TextField value={phone} onChange={setPhone} type="tel" className="sm:flex-1">
        <Label>{method === 'bkash' ? 'bKash number' : 'Mobile number'}</Label>
        <Input placeholder="01XXXXXXXXX" inputMode="tel" autoComplete="tel" />
      </TextField>
      <Button variant="primary" isDisabled={buy.isPending || phone.replace(/\D/g, '').length < 11} onPress={() => buy.mutate()}>
        {buy.isPending ? <Spinner size="sm" color="current" /> : `Buy · ৳${a.priceBdt}`}
      </Button>
      </div>
    </div>
  );
}

function ApiKeys() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['api-keys'], queryFn: () => api.apiKeys() });
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => api.createApiKey(name.trim() || 'My key'),
    onSuccess: (r) => { setFresh(r.key); setName(''); void qc.invalidateQueries({ queryKey: ['api-keys'] }); },
    onError: (e) => toast.danger(msg(e)),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeApiKey(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['api-keys'] }),
    onError: (e) => toast.danger(msg(e)),
  });
  const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => toast.success('Copied'), () => {});
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-[#f7f9fd] p-3">
      <p className="text-sm font-semibold text-[#1557d1]">API keys</p>
      {fresh && (
        <div className="rounded-xl border border-[#5daeff] bg-white p-3 text-sm">
          <p className="font-medium">Your new key — copy it now, it won’t be shown again:</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="mono min-w-0 flex-1 break-all rounded-lg bg-[#eff5ff] px-2 py-1.5 text-xs">{fresh}</code>
            <Button size="sm" variant="secondary" onPress={() => copy(fresh)}>Copy</Button>
          </div>
        </div>
      )}
      {!q.data ? <Skeleton className="h-10 rounded-lg" /> : q.data.keys.length === 0 ? <p className="text-sm text-[#5b6b8f]">No keys yet.</p> : (
        <ul className="flex flex-col gap-2">
          {q.data.keys.map((k) => (
            <li key={k.id} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm">
              <span className="font-medium">{k.name}</span>
              <code className="mono text-xs text-[#5b6b8f]">{k.prefix}…</code>
              <span className="ml-auto text-xs text-[#5b6b8f]">{k.lastUsedAt ? `used ${new Date(k.lastUsedAt).toLocaleDateString()}` : 'never used'}</span>
              <Button size="sm" variant="danger-soft" isDisabled={revoke.isPending} onPress={() => { if (window.confirm(`Revoke “${k.name}”? Apps using it stop working.`)) revoke.mutate(k.id); }}>Revoke</Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <TextField value={name} onChange={setName} aria-label="Key name" className="flex-1"><Input placeholder="Key name, e.g. my-website" /></TextField>
        <Button variant="primary" isDisabled={create.isPending} onPress={() => create.mutate()}>Create key</Button>
      </div>
    </div>
  );
}

export function AddonsTab() {
  const q = useQuery({ queryKey: ['addons'], queryFn: () => api.addons().then((r) => r.addons) });
  if (!q.data) return <Skeleton className="h-48 max-w-2xl rounded-2xl" />;
  const icon = { api: 'terminal', source: 'git' } as const;
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      {q.data.map((a) => (
        <Card key={a.id} className="p-2">
          <Card.Header>
            <Card.Title className="flex items-center gap-2">
              <Icon name={icon[a.id]} /> {a.name}
              {a.owned ? <Chip size="sm" color="success"><Chip.Label>Owned</Chip.Label></Chip> : <span className="text-sm font-semibold text-[#1557d1]">৳{a.priceBdt}</span>}
            </Card.Title>
            <Card.Description>{a.description}</Card.Description>
          </Card.Header>
          <Card.Content className="flex flex-col gap-3">
            {a.id === 'api' && (
              <p className="text-sm"><Link to="/docs/api" className="font-medium text-[#2970ec]">Read the API documentation →</Link> <span className="text-[#5b6b8f]">(free to read; keys need the add-on)</span></p>
            )}
            {a.owned && a.id === 'api' && <ApiKeys />}
            {a.owned && a.id === 'source' && a.whatsapp && (
              <div className="rounded-xl bg-[#eff5ff] p-3 text-sm">
                <p>Thanks for your purchase! Message us on WhatsApp with your account e-mail to receive the source code:</p>
                <a
                  className="mt-2 inline-flex items-center gap-2 font-semibold text-[#1557d1]"
                  href={`https://wa.me/${a.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent('Hi, I bought the Luma Studio source code add-on.')}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {a.whatsapp} →
                </a>
              </div>
            )}
            {!a.owned && <BuyAddon a={a} />}
          </Card.Content>
        </Card>
      ))}
    </div>
  );
}
