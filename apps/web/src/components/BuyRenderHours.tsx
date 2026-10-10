// Buying fast render hours: pick hours, pick bKash or card/Nagad/…, enter a mobile number, pay on the checkout page,
// come back to `returnTo` (the project chat or Settings) with ?payment=paid|pending|failed.
import { Input, Label, Spinner, TextField, toast } from '@heroui/react';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, api } from '../api/client';
import { Button } from './Button';
import { Icon } from './Icon';
import { PayMethodPicker, rememberMethod, savedMethod, type PayMethod } from './PayMethod';

const PHONE_KEY = 'luma.payPhone';
const readPhone = () => {
  try {
    return localStorage.getItem(PHONE_KEY) ?? '';
  } catch {
    return '';
  }
};

export function fmtRenderTime(s: number) {
  if (s >= 3600) return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
  return `${Math.max(0, Math.round(s / 60))} min`;
}

export function BuyRenderHours({ pricePerHourBdt, maxHours, initialHours = 1, paymentsEnabled, returnTo }: {
  pricePerHourBdt: number;
  maxHours: number;
  initialHours?: number;
  paymentsEnabled: boolean;
  returnTo: string;
}) {
  const [hours, setHours] = useState(Math.min(Math.max(1, initialHours), maxHours));
  const [phone, setPhone] = useState(readPhone);
  const [method, setMethod] = useState<PayMethod>(savedMethod);
  const buy = useMutation({
    mutationFn: () => api.buyRenderHours({ hours, phone, method, returnTo }),
    onSuccess: (r) => {
      try { localStorage.setItem(PHONE_KEY, phone); } catch { /* fine */ }
      rememberMethod(method);
      window.location.href = r.paymentUrl; // bKash, or the checkout page for cards / Nagad / others
    },
    onError: (e) => toast.danger(e instanceof ApiError ? e.message : 'Could not start the payment'),
  });
  if (!paymentsEnabled) return <p className="text-sm text-[#5b6b8f]">Online payment isn’t set up yet — contact Lumademy support to get fast render hours.</p>;
  const step = (d: number) => setHours((h) => Math.min(maxHours, Math.max(1, h + d)));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center rounded-xl border border-[#d6e2f5] bg-white" role="group" aria-label="Hours">
          <button type="button" className="grid h-10 w-10 place-items-center text-lg text-[#2970EC] disabled:opacity-40" onClick={() => step(-1)} disabled={hours <= 1} aria-label="Fewer hours">−</button>
          <span className="min-w-20 text-center font-semibold">{hours} hour{hours > 1 ? 's' : ''}</span>
          <button type="button" className="grid h-10 w-10 place-items-center text-lg text-[#2970EC] disabled:opacity-40" onClick={() => step(1)} disabled={hours >= maxHours} aria-label="More hours">+</button>
        </div>
        <span className="text-lg font-bold text-[#1557d1]">৳{hours * pricePerHourBdt}</span>
        <span className="text-xs text-[#5b6b8f]">৳{pricePerHourBdt} per hour</span>
      </div>
      <PayMethodPicker value={method} onChange={setMethod} />
      <TextField value={phone} onChange={setPhone} type="tel" name="phone">
        <Label>{method === 'bkash' ? 'bKash number' : 'Mobile number'}</Label>
        <Input placeholder="01XXXXXXXXX" autoComplete="tel" inputMode="tel" />
      </TextField>
      <Button variant="primary" isDisabled={buy.isPending || phone.replace(/\D/g, '').length < 11} onPress={() => buy.mutate()}>
        {buy.isPending ? <Spinner size="sm" color="current" /> : <Icon name="lightning" size={15} />} Pay ৳{hours * pricePerHourBdt}
      </Button>
      <p className="text-xs text-[#5b6b8f]">You’ll pay securely {method === 'bkash' ? 'with bKash' : 'by card, Nagad, Rocket, Upay or bank'} and come right back here.</p>
    </div>
  );
}
