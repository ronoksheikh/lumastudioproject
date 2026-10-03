import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { authUser, requireAuth } from '../auth/plugin.js';
import { config } from '../config.js';
import { parse } from '../http/validate.js';
import {
  createProvider, deleteProvider, getProvider, listProviders, providerApiKey, publicProvider, saveTestResult, setDefaultProvider, updateProvider,
} from './service.js';
import { assertProviderUrl } from './safe-fetch.js';
import { testProvider } from './test-connection.js';

const name = z.string().trim().min(1).max(80);
const baseUrl = z.string().trim().url().max(300);
const apiKey = z.string().trim().min(1).max(500);
const model = z.string().trim().min(1).max(200);
const contextWindow = z.number().int().min(4096).max(5_000_000);

export async function providerRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;
  const auth = { preHandler: requireAuth };
  const limited = (max: number): { rateLimit?: { max: number; timeWindow: string } } => (config.rateLimitDisabled ? {} : { rateLimit: { max, timeWindow: '10 minutes' } });

  app.get('/settings/models', auth, async (req) => ({ models: listProviders(db, authUser(req).id).map(publicProvider) }));

  app.post('/settings/models', auth, async (req, reply) => {
    const body = parse(z.object({ name, baseUrl, apiKey, model, contextWindow: contextWindow.optional() }), req.body);
    assertProviderUrl(body.baseUrl);
    return reply.code(201).send({ model: publicProvider(createProvider(db, authUser(req).id, body)) });
  });

  app.patch('/settings/models/:id', auth, async (req) => {
    const { id } = req.params as { id: string };
    const u = authUser(req);
    const p = getProvider(db, u.id, id);
    const body = parse(z.object({ name: name.optional(), baseUrl: baseUrl.optional(), apiKey: apiKey.optional(), model: model.optional(), contextWindow: contextWindow.optional(), isDefault: z.boolean().optional() }), req.body);
    if (body.baseUrl) assertProviderUrl(body.baseUrl);
    const { isDefault, ...patch } = body;
    updateProvider(db, p, patch);
    if (isDefault) setDefaultProvider(db, u.id, id);
    return { model: publicProvider(getProvider(db, u.id, id)) };
  });

  app.delete('/settings/models/:id', auth, async (req) => {
    const { id } = req.params as { id: string };
    deleteProvider(db, getProvider(db, authUser(req).id, id));
    return { ok: true };
  });

  /** Test a saved model (and store what it supports). */
  app.post('/settings/models/:id/test', { ...auth, config: limited(20) }, async (req) => {
    const { id } = req.params as { id: string };
    const p = getProvider(db, authUser(req).id, id);
    const result = await testProvider({ baseUrl: p.baseUrl, apiKey: providerApiKey(p), model: p.model });
    saveTestResult(db, p, result);
    return { result, model: publicProvider(getProvider(db, p.userId, id)) };
  });

  /** Test values from the form before anything is saved. */
  app.post('/settings/models/test', { ...auth, config: limited(20) }, async (req) => {
    const body = parse(z.object({ baseUrl, apiKey, model }), req.body);
    return { result: await testProvider(body) };
  });
}
