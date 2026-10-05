// One-time add-ons (Settings → Add-ons), paid through PayStation like render hours:
//   api    — Luma Studio API access: API keys to make videos from code (docs at /docs/api, readable by anyone)
//   source — the Luma Studio source code: after paying, the student messages the WhatsApp number to receive it
import { and, eq } from 'drizzle-orm';
import { config } from '../config.js';
import type { DB } from '../db/index.js';
import { addonPurchases } from '../db/schema.js';

export type AddonId = 'api' | 'source';

export const ADDONS: Record<AddonId, { name: string; description: string; priceBdt: () => number }> = {
  api: {
    name: 'Luma Studio API',
    description: 'Make videos from your own code or apps: create projects, send briefs to the agent, upload files, render and download MP4s with an API key.',
    priceBdt: () => config.addonApiPriceBdt,
  },
  source: {
    name: 'Luma Studio source code',
    description: 'The full Luma Studio source code to run and change on your own server.',
    priceBdt: () => config.addonSourcePriceBdt,
  },
};

export const hasAddon = (db: DB, userId: string, addon: AddonId) =>
  !!db.select({ id: addonPurchases.id }).from(addonPurchases)
    .where(and(eq(addonPurchases.userId, userId), eq(addonPurchases.addon, addon), eq(addonPurchases.status, 'paid'))).get();

export function addonsFor(db: DB, userId: string) {
  return (Object.keys(ADDONS) as AddonId[]).map((id) => {
    const owned = hasAddon(db, userId, id);
    return {
      id,
      name: ADDONS[id].name,
      description: ADDONS[id].description,
      priceBdt: ADDONS[id].priceBdt(),
      owned,
      paymentsEnabled: !!config.paystation,
      // the source code is handed over personally: shown only after paying
      ...(id === 'source' && owned ? { whatsapp: config.sourceCodeWhatsapp } : {}),
    };
  });
}

/** Admin / CLI: give an add-on without payment. */
export function grantAddon(db: DB, userId: string, addon: AddonId, id: string) {
  db.insert(addonPurchases).values({ id, userId, addon, priceBdt: 0, status: 'paid', provider: 'grant', paidAt: Date.now() }).run();
}
