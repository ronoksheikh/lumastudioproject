import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { users } from '../db/schema.js';
import { Client, makeTestApp } from '../test/helpers.js';

let t: Awaited<ReturnType<typeof makeTestApp>>;
beforeAll(async () => {
  t = await makeTestApp();
});
afterAll(async () => {
  await t.app.close();
});

describe('accounts', () => {
  it('signs up, hashes the password with argon2id and sets an httpOnly session cookie', async () => {
    const c = new Client(t.app);
    const r = await c.signup('Ada@Example.com');
    expect(r.status).toBe(201);
    expect(r.json.user.email).toBe('ada@example.com');
    expect(r.headers['set-cookie']).toMatch(/luma_session=.+HttpOnly/i);
    expect(r.headers['set-cookie']).toMatch(/SameSite=Lax/i);
    const row = t.db.select().from(users).where(eq(users.email, 'ada@example.com')).get()!;
    expect(row.passwordHash.startsWith('$argon2id$')).toBe(true);
    const me = await c.get('/api/auth/me');
    expect(me.json.user.email).toBe('ada@example.com');
    expect(me.json.csrfToken).toBeTruthy();
  });

  it('rejects duplicate emails, weak passwords and bad emails', async () => {
    const c = new Client(t.app);
    expect((await c.signup('ada@example.com')).status).toBe(409);
    expect((await c.signup('new@example.com', 'short')).status).toBe(400);
    expect((await c.signup('not-an-email')).status).toBe(400);
  });

  it('logs in with the right password only, with the same error for unknown emails', async () => {
    const c = new Client(t.app);
    const bad = await c.login('ada@example.com', 'wrong password!');
    const unknown = await c.login('nobody@example.com', 'wrong password!');
    expect(bad.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(bad.json.error.message).toBe(unknown.json.error.message);
    expect((await c.login('ada@example.com')).status).toBe(200);
    expect((await c.get('/api/auth/me')).json.user.email).toBe('ada@example.com');
  });

  it('requires the CSRF token on authenticated mutations and blocks foreign origins', async () => {
    const c = new Client(t.app);
    await c.login('ada@example.com');
    const noCsrf = await t.app.inject({ method: 'POST', url: '/api/projects', headers: { cookie: c.cookie }, payload: { title: 'x' } });
    expect(noCsrf.statusCode).toBe(403);
    const wrongCsrf = await t.app.inject({ method: 'POST', url: '/api/projects', headers: { cookie: c.cookie, 'x-csrf-token': 'nope' }, payload: { title: 'x' } });
    expect(wrongCsrf.statusCode).toBe(403);
    const foreign = await t.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: c.cookie, origin: 'https://evil.example', 'x-csrf-token': c.csrf } });
    expect(foreign.statusCode).toBe(403);
    // GETs need no token, and the right Origin passes
    const ok = await t.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: c.cookie, origin: 'http://app.test', 'x-csrf-token': c.csrf } });
    expect(ok.statusCode).toBe(200);
  });

  it('logout invalidates the session; protected routes answer 401', async () => {
    const c = new Client(t.app);
    await c.login('ada@example.com');
    const cookie = c.cookie;
    expect((await c.post('/api/auth/logout')).status).toBe(200);
    expect((await c.get('/api/projects')).status).toBe(401);
    const replay = await t.app.inject({ url: '/api/auth/me', headers: { cookie } });
    expect(replay.json().user).toBeNull();
  });

  it('suspended accounts cannot use their session or log in', async () => {
    const c = new Client(t.app);
    await c.signup('banme@example.com');
    t.db.update(users).set({ banned: true }).where(eq(users.email, 'banme@example.com')).run();
    expect((await c.get('/api/projects')).status).toBe(403);
    expect((await new Client(t.app).login('banme@example.com')).status).toBe(403);
  });

  it('changes the password and signs out other sessions', async () => {
    const a = new Client(t.app);
    await a.signup('pw@example.com', 'old password 123');
    const b = new Client(t.app);
    await b.login('pw@example.com', 'old password 123');
    expect((await a.post('/api/auth/password', { currentPassword: 'wrong', newPassword: 'new password 456' })).status).toBe(403);
    expect((await a.post('/api/auth/password', { currentPassword: 'old password 123', newPassword: 'new password 456' })).status).toBe(200);
    expect((await b.get('/api/projects')).status).toBe(401);
    expect((await a.get('/api/projects')).status).toBe(200);
    expect((await new Client(t.app).login('pw@example.com', 'new password 456')).status).toBe(200);
  });
});
