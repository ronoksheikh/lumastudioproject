# Render time and payments

## Two quotas
| Quota | What | Where it renders | Setting |
|---|---|---|---|
| **Free** | 5 hours of render time per rolling 24 hours | this Studio server | `RENDER_MINUTES_PER_DAY=300` |
| **Fast** | paid hours, never expire, any amount | the remote render workers (`docs/remote-workers.md`) | `RENDER_HOUR_PRICE_BDT=100`, `RENDER_HOURS_MAX_PER_ORDER=20` |

Render time = wall-clock time of the render job. Fast time is taken from the oldest paid pack first.

**Which one a render uses** (`assertRenderAllowed`, `render_video` `mode`):
- only one quota has time left → that one;
- both → the agent asks the student ("Free render (slower)" / "Fast render") and renders with `mode`;
- none → the render is refused; the agent tells the student and calls `offer_render_hours`, which puts a
  **"Buy fast render hours"** card in the chat (hours picker, price, bKash or card/Nagad, phone, Pay button).

Students see both balances, and can buy hours, in Settings → Account → Render time.

## Paying (Lumademy's payment API at `https://p.lumademy.com`)
Students choose **bKash** (first, the default) or **Card, Nagad & more** (Visa, Mastercard, Nagad, Rocket, Upay, net
banking on the hosted checkout). The UI never names the payment company.

1. `POST /api/billing/render-hours` `{ hours, phone, method: "bkash" | "other", returnTo? }` (or
   `POST /api/billing/addons/:addon` `{ phone, method, returnTo? }`) inserts a **pending** row, then calls
   `POST {PAYMENT_API_BASE}/api/checkout` (`billing/gateway.ts`) with the student's name/email/phone, the fixed
   billing address (`PAYMENT_ADDRESS/CITY/POSTCODE`), the amount, `paymentMethod: bkash | eps` and
   `returnUrl = {APP_ORIGIN}/api/billing/return`. The returned `merchantTransactionId` is stored as the row's
   `invoice_number` (a `tmp-…` placeholder until then); the browser goes to `redirectUrl`.
2. After paying, the browser comes back to `GET /api/billing/return?merchantTransactionId=…&paymentStatus=…`.
   The query is editable, so it only picks the row; `settleInvoice` asks `GET /api/payment-status` and credits
   the purchase only on `status: "Success"` with `amount ≥` the price we stored. pending → paid happens once
   (conditional UPDATE). Then the browser goes to `returnTo?payment=paid|pending|failed` (a toast).
3. **No server-to-server notification exists**, so `billing/reconcile.ts` re-checks pending purchases (started in the
   last 48 h) every 3 minutes, and again whenever a student opens Settings → Account. `Pending` /
   `VerificationUnavailable` stay pending; `AmountMismatch`, other failure statuses and unknown references are failed.

## Setup
- Nothing to register: the API needs no key. `PAYMENT_API_BASE` (default `https://p.lumademy.com`), `PAYMENTS_ENABLED=0`
  turns buying off (admin grants still work). `APP_ORIGIN` must be the public HTTPS address (it is the return URL).
- Calls are server-to-server, so the API's browser CORS list (`ALLOWED_WEB_ORIGINS`) does not matter.
- Purchases made through it have `provider = 'gateway'`; older PayStation purchases keep `provider = 'paystation'`
  and still count in the admin sales totals.

## Operator commands
```
node dist/admin.js boosts [pending|paid|failed]     # purchases
node dist/admin.js payment-check <invoice>          # re-check a payment (merchantTransactionId) now and credit
node dist/admin.js boost-paid <id> [ref]            # mark a purchase paid by hand (paid some other way)
node dist/admin.js boost-grant <email> [minutes]    # give fast minutes for free
```

## Add-ons (one-time)
| Add-on | Price | What the student gets |
|---|---|---|
| **Luma Studio API** | `ADDON_API_PRICE_BDT` (500) | API keys (Settings → Add-ons) for the documented API at `/docs/api` (readable by anyone) |
| **Source code** | `ADDON_SOURCE_PRICE_BDT` (2000) | After paying, the WhatsApp number `SOURCE_CODE_WHATSAPP` (+8801744136934) to message for the code |

Bought the same way as render hours (`POST /api/billing/addons/:addon` → checkout → return page / background re-check → `settleInvoice`,
which now settles both `render_boosts` and `addon_purchases`). Admins can grant one in /admin → Students.
