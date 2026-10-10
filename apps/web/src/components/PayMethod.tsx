// How the student pays: bKash first, then everything else on the hosted checkout (cards, Nagad, Rocket, Upay,
// net banking). Shared by fast render hours and add-ons.
import { Icon } from './Icon';

export type PayMethod = 'bkash' | 'other';

const METHOD_KEY = 'luma.payMethod';
export const savedMethod = (): PayMethod => {
  try {
    return localStorage.getItem(METHOD_KEY) === 'other' ? 'other' : 'bkash';
  } catch {
    return 'bkash';
  }
};
export const rememberMethod = (m: PayMethod) => {
  try { localStorage.setItem(METHOD_KEY, m); } catch { /* fine */ }
};

export function PayMethodPicker({ value, onChange }: { value: PayMethod; onChange: (m: PayMethod) => void }) {
  const opt = (m: PayMethod, body: React.ReactNode, label: string) => {
    const on = value === m;
    return (
      <label className={`relative flex min-h-[64px] cursor-pointer items-center gap-3 rounded-xl border bg-white px-3 py-2.5 transition-colors ${on ? 'border-[#2970ec] ring-1 ring-[#2970ec]' : 'border-[#d6e2f5] hover:border-[#9cc2ff]'}`}>
        <input type="radio" name="pay-method" className="sr-only" checked={on} onChange={() => onChange(m)} aria-label={label} />
        <span className={`grid size-4 shrink-0 place-items-center rounded-full border ${on ? 'border-[#2970ec]' : 'border-[#b8c7e3]'}`}>{on && <span className="size-2 rounded-full bg-[#2970ec]" />}</span>
        {body}
      </label>
    );
  };
  return (
    <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Payment method">
      {opt('bkash', <img src="/pay/bkash.svg" alt="bKash" className="h-7 w-auto" />, 'bKash')}
      {opt('other', (
        <span className="flex min-w-0 flex-col">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-[#1f2937]"><Icon name="card" size={17} className="text-[#2970ec]" /> Card, Nagad & more</span>
          <span className="truncate text-xs text-[#5b6b8f]">Visa · Mastercard · Nagad · Rocket · Upay · bank</span>
        </span>
      ), 'Card, Nagad and more')}
    </div>
  );
}
