# Render time and payments (PayStation)

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
  **"Buy fast render hours"** card in the chat (hours picker, price, phone, Pay button).

Students see both balances, and can buy hours, in Settings → Account → Render time.

## Buying fast hours (PayStation hosted checkout)

```
Student (chat card or Settings)            Luma Studio                         PayStation
  hours + phone ──POST /api/billing/render-hours──▶ render_boosts row (pending, invoice_number)
                                           initiate-payment (merchantId, password, invoice,
                                           amount = hours × price, callback_url) ─────────▶
                    ◀──────────── { paymentUrl } ◀─────────────────────────── payment_url
  browser ─────────────────────────────────────────────────────────────────▶ checkout (bKash, Nagad,
                                                                               Rocket, Upay, cards)
  browser ◀── redirect to callback_url ── GET /api/billing/paystation/callback?invoice=…
                                           transaction-status(invoice) ──────────────────▶
                                           success + amount matches → paid (once)
  back in the project chat / Settings with ?payment=paid|pending|failed (a toast)
                                           POST /api/billing/paystation/ipn  ◀── IPN (successes, retried)
                                           same check → paid (no-op if already paid) → 200
```

- **Never trusted blindly:** the callback and the IPN both re-check the invoice with PayStation's
  `transaction-status` API (merchantId header) and compare the paid amount with the order before crediting.
- **Idempotent:** `pending → paid` happens once (`settleInvoice`), whichever of callback/IPN comes first.
- **Gateway fees:** `pay_with_charge=0`, so the merchant bears the gateway charge and the student pays exactly the
  listed price. Set it to 1 in `billing/paystation.ts` to pass the fee on.
- **After paying,** the student returns to where they were: the project chat or Settings.

## Setup
1. `.env`: `PAYSTATION_ENV=sandbox`, `PAYSTATION_MERCHANT_ID=104-1653730183`, `PAYSTATION_PASSWORD=gamecoderstorepass`
   (the public sandbox account) → test the whole flow.
2. Give PayStation your IPN URL: `https://<your studio domain>/api/billing/paystation/ipn`.
3. Live: `PAYSTATION_ENV=live` plus your own merchant ID and password. Keep them only in `.env`.

Without `PAYSTATION_MERCHANT_ID`/`PASSWORD` the buy buttons say payment isn't set up yet.

## Operator commands
```
node dist/admin.js boosts [pending|paid|failed]     # purchases
node dist/admin.js payment-check <invoice>          # re-check with PayStation now (missed IPN) and credit
node dist/admin.js boost-paid <id> [ref]            # mark a purchase paid by hand (paid outside PayStation)
node dist/admin.js boost-grant <email> [minutes]    # give fast minutes for free
```

## Add-ons (one-time)
| Add-on | Price | What the student gets |
|---|---|---|
| **Luma Studio API** | `ADDON_API_PRICE_BDT` (500) | API keys (Settings → Add-ons) for the documented API at `/docs/api` (readable by anyone) |
| **Source code** | `ADDON_SOURCE_PRICE_BDT` (2000) | After paying, the WhatsApp number `SOURCE_CODE_WHATSAPP` (+8801744136934) to message for the code |

Bought the same way as render hours (`POST /api/billing/addons/:addon` → PayStation → callback/IPN → `settleInvoice`,
which now settles both `render_boosts` and `addon_purchases`). Admins can grant one in /admin → Students.
