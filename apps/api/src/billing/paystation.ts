// PayStation (Bangladesh payment gateway: bKash, Nagad, Rocket, Upay, cards) — hosted checkout.
// 1. initiatePayment → PayStation returns a payment_url; the browser goes there.
// 2. The student pays; PayStation sends the browser back to our callback_url, and (for successes) POSTs an IPN.
// 3. We never trust the callback or the IPN body on its own: both re-check the invoice with the server-to-server
//    transaction-status API (merchantId header) and compare the amount before crediting anything.
import { config } from '../config.js';
import { logger } from '../logger.js';

export interface InitiateArgs {
  invoiceNumber: string;
  amountBdt: number;
  customer: { name: string; email: string; phone: string };
  callbackUrl: string;
  reference: string;
  items: unknown;
}

export class PayStationError extends Error {}

const cfg = () => {
  if (!config.paystation) throw new PayStationError('Online payments are not set up on this server yet.');
  return config.paystation;
};

/** Creates the hosted checkout; returns the URL to send the browser to. */
export async function initiatePayment(a: InitiateArgs): Promise<string> {
  const ps = cfg();
  const body = new URLSearchParams({
    merchantId: ps.merchantId,
    password: ps.password,
    invoice_number: a.invoiceNumber,
    currency: 'BDT',
    payment_amount: String(a.amountBdt),
    pay_with_charge: '0', // the merchant bears the gateway charge: the student pays exactly the listed price
    reference: a.reference,
    cust_name: a.customer.name,
    cust_phone: a.customer.phone,
    cust_email: a.customer.email,
    callback_url: a.callbackUrl,
    checkout_items: JSON.stringify(a.items),
  });
  const res = await fetch(`${ps.base}/initiate-payment`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await res.json().catch(() => ({}))) as { status_code?: string | number; status?: string; message?: string; payment_url?: string };
  if (String(j.status_code) !== '200' || !j.payment_url) {
    logger.warn({ status: res.status, code: j.status_code, message: j.message }, 'paystation initiate-payment failed');
    throw new PayStationError(j.message ? `The payment gateway said: ${j.message}` : 'The payment gateway did not answer. Try again in a minute.');
  }
  return j.payment_url;
}

export interface TrxStatus {
  status: 'success' | 'processing' | 'failed' | 'refund' | 'not_found';
  trxId: string | null;
  amount: number | null;
  method: string | null;
}

/** Server-to-server status of an invoice (v1 API, by our invoice number). */
export async function transactionStatus(invoiceNumber: string): Promise<TrxStatus> {
  const ps = cfg();
  const res = await fetch(`${ps.base}/transaction-status`, {
    method: 'POST',
    headers: { accept: 'application/json', merchantId: ps.merchantId, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ invoice_number: invoiceNumber }),
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await res.json().catch(() => ({}))) as {
    status_code?: string | number;
    data?: { trx_status?: string; trx_id?: string; payment_amount?: string | number; trx_amount?: string | number; payment_method?: string };
  };
  if (String(j.status_code) !== '200' || !j.data) return { status: 'not_found', trxId: null, amount: null, method: null };
  const st = String(j.data.trx_status ?? '').toLowerCase();
  const amount = Number(j.data.payment_amount ?? j.data.trx_amount);
  return {
    status: st === 'success' || st === 'processing' || st === 'failed' || st === 'refund' ? st : 'failed',
    trxId: j.data.trx_id || null,
    amount: Number.isFinite(amount) ? amount : null,
    method: j.data.payment_method || null,
  };
}
