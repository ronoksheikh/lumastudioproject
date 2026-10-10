// Lumademy's payment API (docs/payments.md): bKash, or cards / Nagad / Rocket / net banking on the hosted checkout.
// 1. createCheckout → { redirectUrl, merchantTransactionId }; the browser goes to redirectUrl.
// 2. After paying, the browser comes back to our returnUrl (with editable query parameters — never trusted).
// 3. paymentStatus(merchantTransactionId) is the only proof: status "Success" and the amount we expect.
// There is no server-to-server notification, so pending payments are also re-checked in the background (reconcile.ts).
import { config } from '../config.js';
import { logger } from '../logger.js';

export type PayMethod = 'bkash' | 'other';

export class PaymentError extends Error {}

const cfg = () => {
  if (!config.payments) throw new PaymentError('Online payment is not set up on this server yet.');
  return config.payments;
};

export interface Checkout {
  redirectUrl: string;
  merchantTransactionId: string;
  orderId: string;
  amount: number;
}

/** Starts a payment. `other` = the hosted checkout with cards, Nagad, Rocket and the rest. */
export async function createCheckout(a: {
  amountBdt: number;
  method: PayMethod;
  customer: { name: string; email: string; phone: string };
  returnUrl: string;
}): Promise<Checkout> {
  const pay = cfg();
  const res = await fetch(`${pay.base}/api/checkout`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      name: a.customer.name,
      email: a.customer.email,
      phone: a.customer.phone,
      // the API wants a billing address; digital goods have none, so the configured defaults are sent
      address: pay.address,
      city: pay.city,
      postcode: pay.postcode,
      amount: a.amountBdt,
      returnUrl: a.returnUrl,
      paymentMethod: a.method === 'bkash' ? 'bkash' : 'eps',
    }),
    signal: AbortSignal.timeout(30_000),
  }).catch((e: Error) => {
    logger.warn({ err: e }, 'payment checkout unreachable');
    throw new PaymentError('The payment service did not answer. Try again in a minute.');
  });
  const j = (await res.json().catch(() => ({}))) as Partial<Checkout> & { error?: string };
  if (!res.ok || !j.redirectUrl || !j.merchantTransactionId) {
    logger.warn({ status: res.status, error: j.error }, 'payment checkout failed');
    throw new PaymentError(j.error ? `Payment could not start: ${j.error}` : 'Payment could not start. Try again in a minute.');
  }
  if (Number(j.amount) !== a.amountBdt) throw new PaymentError('The payment service returned a different amount. Nothing was charged; please try again.');
  return { redirectUrl: j.redirectUrl, merchantTransactionId: String(j.merchantTransactionId), orderId: String(j.orderId ?? ''), amount: Number(j.amount) };
}

export interface PayStatus {
  /** success = paid; pending = not finished or not checkable right now; failed = will not be paid */
  status: 'success' | 'pending' | 'failed' | 'not_found';
  /** the raw status, e.g. "Success", "Pending", "AmountMismatch", "Failed" */
  raw: string;
  amount: number | null;
  orderId: string | null;
}

const PENDING = new Set(['pending', 'verificationunavailable', 'initiated', 'processing', 'inprogress', '']);

/** The verified status of one transaction (asked from the payment service, which asks the bank side). */
export async function paymentStatus(merchantTransactionId: string): Promise<PayStatus> {
  const pay = cfg();
  const res = await fetch(`${pay.base}/api/payment-status?merchantTransactionId=${encodeURIComponent(merchantTransactionId)}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 404) return { status: 'not_found', raw: 'NotFound', amount: null, orderId: null };
  const j = (await res.json().catch(() => ({}))) as { status?: string; amount?: number | string; orderId?: string };
  if (!res.ok) return { status: 'pending', raw: `HTTP ${res.status}`, amount: null, orderId: null };
  const raw = String(j.status ?? '');
  const amount = Number(j.amount);
  const key = raw.toLowerCase().replace(/[\s_-]/g, '');
  return {
    status: raw === 'Success' ? 'success' : PENDING.has(key) ? 'pending' : 'failed',
    raw,
    amount: Number.isFinite(amount) ? amount : null,
    orderId: j.orderId ?? null,
  };
}

export const methodLabel = (m: PayMethod) => (m === 'bkash' ? 'bKash' : 'Card / Nagad / other');
