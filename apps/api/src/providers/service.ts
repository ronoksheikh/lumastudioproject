import { and, eq } from 'drizzle-orm';
import type { DB } from '../db/index.js';
import { providerConfigs } from '../db/schema.js';
import { notFound } from '../http/errors.js';
import { decrypt, encrypt, keyHint } from '../security/crypto.js';
import { loadSecrets } from '../security/secrets.js';
import { newId } from '../util/id.js';
import type { TestResult } from './test-connection.js';

export type ProviderRow = typeof providerConfigs.$inferSelect;

/** What the browser may see: never the key, only a hint like `sk-…abcd`. */
export function publicProvider(p: ProviderRow) {
  return {
    id: p.id, name: p.name, baseUrl: p.baseUrl, model: p.model, apiKeyHint: p.apiKeyHint,
    supportsTools: p.supportsTools, supportsVision: p.supportsVision, supportsReasoningStream: p.supportsReasoningStream,
    contextWindow: p.contextWindow, reasoningEffort: p.reasoningEffort, thinkingBudget: p.thinkingBudget, isDefault: p.isDefault, createdAt: p.createdAt,
  };
}

export const listProviders = (db: DB, userId: string) => db.select().from(providerConfigs).where(eq(providerConfigs.userId, userId)).all();

export function getProvider(db: DB, userId: string, id: string): ProviderRow {
  const row = db.select().from(providerConfigs).where(and(eq(providerConfigs.id, id), eq(providerConfigs.userId, userId))).get();
  if (!row) throw notFound('Model not found');
  return row;
}

/** Decrypts the key — only for the agent runtime and test calls; the value must never leave the server. */
export const providerApiKey = (p: ProviderRow) => decrypt(p.apiKeyEnc, loadSecrets().masterKey);

export function createProvider(db: DB, userId: string, input: { name: string; baseUrl: string; apiKey: string; model: string; contextWindow?: number; reasoningEffort?: string | null; thinkingBudget?: number | null }) {
  const id = newId();
  const isFirst = listProviders(db, userId).length === 0;
  db.insert(providerConfigs).values({
    id, userId, name: input.name, baseUrl: input.baseUrl.replace(/\/+$/, ''), model: input.model, contextWindow: input.contextWindow ?? 128000,
    reasoningEffort: input.reasoningEffort ?? null, thinkingBudget: input.thinkingBudget ?? null,
    apiKeyEnc: encrypt(input.apiKey, loadSecrets().masterKey), apiKeyHint: keyHint(input.apiKey), isDefault: isFirst,
  }).run();
  return getProvider(db, userId, id);
}

export function updateProvider(
  db: DB, p: ProviderRow,
  patch: { name?: string; baseUrl?: string; apiKey?: string; model?: string; contextWindow?: number; reasoningEffort?: string | null; thinkingBudget?: number | null },
) {
  const set: Partial<typeof providerConfigs.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.contextWindow !== undefined) set.contextWindow = patch.contextWindow;
  if (patch.reasoningEffort !== undefined) set.reasoningEffort = patch.reasoningEffort;
  if (patch.thinkingBudget !== undefined) set.thinkingBudget = patch.thinkingBudget;
  const endpointChanged = (patch.baseUrl !== undefined && patch.baseUrl.replace(/\/+$/, '') !== p.baseUrl) || (patch.model !== undefined && patch.model !== p.model) || patch.apiKey !== undefined;
  if (patch.baseUrl !== undefined) set.baseUrl = patch.baseUrl.replace(/\/+$/, '');
  if (patch.model !== undefined) set.model = patch.model;
  if (patch.apiKey !== undefined) {
    set.apiKeyEnc = encrypt(patch.apiKey, loadSecrets().masterKey);
    set.apiKeyHint = keyHint(patch.apiKey);
  }
  // a different endpoint/model/key must be tested again before it can run an agent
  if (endpointChanged) Object.assign(set, { supportsTools: false, supportsVision: false, supportsReasoningStream: false });
  if (Object.keys(set).length) db.update(providerConfigs).set(set).where(eq(providerConfigs.id, p.id)).run();
  return getProvider(db, p.userId, p.id);
}

export function setDefaultProvider(db: DB, userId: string, id: string) {
  db.update(providerConfigs).set({ isDefault: false }).where(eq(providerConfigs.userId, userId)).run();
  db.update(providerConfigs).set({ isDefault: true }).where(and(eq(providerConfigs.id, id), eq(providerConfigs.userId, userId))).run();
}

export function deleteProvider(db: DB, p: ProviderRow) {
  db.delete(providerConfigs).where(eq(providerConfigs.id, p.id)).run();
  if (p.isDefault) {
    const next = listProviders(db, p.userId)[0];
    if (next) setDefaultProvider(db, p.userId, next.id);
  }
}

export function saveTestResult(db: DB, p: ProviderRow, r: TestResult) {
  db.update(providerConfigs)
    .set({ supportsTools: r.supportsTools, supportsVision: r.supportsVision, supportsReasoningStream: r.supportsReasoningStream })
    .where(eq(providerConfigs.id, p.id))
    .run();
}
