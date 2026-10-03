import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createDb, runMigrations } from './db/index.js';

describe('health', () => {
  it('reports ok once migrations ran', async () => {
    const { db, sqlite } = createDb(':memory:');
    runMigrations(db);
    const app = await buildApp({ db, sqlite });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
    await app.close();
  });
});
