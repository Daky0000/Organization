import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';

process.env.JWT_SECRET ??= 'x'.repeat(32);
process.env.INTEGRATIONS_ENCRYPTION_KEY ??= 'y'.repeat(32);
process.env.WORDPRESS_ENCRYPTION_KEY ??= 'z'.repeat(32);

const { suggestUsernames, usernameStem, registerAuthRoutes } = await import('../src/server/authRoutes.ts');
const RULE = /^[a-zA-Z0-9_-]{3,32}$/;

const takenFrom = (set: Set<string>) => async (cands: string[]) => new Set(cands.map((c) => c.toLowerCase()).filter((c) => set.has(c)));

test('username stem: email local parts and names become username-shaped', () => {
  assert.equal(usernameStem('Dan.Smith'), 'dan_smith');
  assert.equal(usernameStem('+++'), '');
});

test('suggestions: free, valid, never the wanted name, never already taken', async () => {
  const taken = new Set(['dan', 'dan_smith']);
  const s = await suggestUsernames({ wanted: 'dan', name: 'Dan Smith', email: 'dan@company.com' }, takenFrom(taken));
  assert.equal(s.length, 3);
  for (const u of s) {
    assert.match(u, RULE);
    assert.ok(!taken.has(u), `${u} is taken`);
    assert.notEqual(u, 'dan');
  }
  assert.ok(s.includes('dansmith'), `name-based option offered first when free: ${s}`);
});

test('suggestions: a symbol-only email and no name still yield valid names', async () => {
  const s = await suggestUsernames({ wanted: '++', email: '+++@x.com' }, takenFrom(new Set()));
  assert.ok(s.length > 0);
  for (const u of s) assert.match(u, RULE);
});

// Route-level: taken usernames are refused with suggestions, nothing is auto-picked.
function buildApp(existing: Record<string, { id: string }>) {
  const created: string[] = [];
  const app = express();
  app.use(express.json());
  app.use('/api', registerAuthRoutes({
    requireAuth: () => null,
    hasDatabase: () => false,
    dbQuery: async () => ({ rows: [] }),
    getUserById: async () => undefined,
    findUserByEmail: async () => undefined,
    findUserByUsername: async (u: string) => existing[u.toLowerCase()],
    findUserByIdentifier: async () => undefined,
    createUser: async (_n: string, username: string, email: string) => { created.push(username); return { id: 'new', email, username, token_version: 1 }; },
    updateUserProfile: async () => undefined,
    updateLastLogin: async () => undefined,
    getUserPlanName: async () => 'free',
    signToken: () => 'tok',
    userToAuthPayload: (u: any) => ({ id: u.id, email: u.email, username: u.username }),
    checkTokenVersion: async () => true,
    provisionUserAgents: async () => undefined,
    createNotification: async () => undefined,
    getResendConfig: async () => ({ apiKey: '', fromEmail: '', fromName: '' }),
    jwtSecret: 'x'.repeat(32),
    appUrl: 'https://app.example.com',
    syncProfileMedia: async () => undefined,
  } as any));
  return { app, created };
}

test('register: a taken username is refused with suggestions, and no account is created', async () => {
  const { app, created } = buildApp({ dan: { id: 'u1' } });
  const res = await request(app).post('/api/auth/register')
    .send({ name: 'Dan Smith', username: 'Dan', email: 'dan@company.com', password: 'longenough1' });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'USERNAME_TAKEN');
  assert.ok(res.body.suggestions.length > 0);
  assert.match(res.body.error, /already taken/);
  assert.equal(created.length, 0);
});

test('register: a username is required (never invented by the server)', async () => {
  const { app, created } = buildApp({});
  const res = await request(app).post('/api/auth/register').send({ name: 'Dan', email: 'dan@company.com', password: 'longenough1' });
  assert.equal(res.status, 400);
  assert.equal(created.length, 0);
});

test('username check: available, taken with suggestions, invalid with the reason', async () => {
  const { app } = buildApp({ dan: { id: 'u1' } });
  const free = await request(app).get('/api/auth/username-available').query({ username: 'dan_new' });
  assert.deepEqual([free.body.available, free.body.suggestions], [true, []]);
  const taken = await request(app).get('/api/auth/username-available').query({ username: 'DAN', name: 'Dan Smith' });
  assert.equal(taken.body.available, false);
  assert.match(taken.body.reason, /already taken/);
  assert.ok(taken.body.suggestions.length > 0);
  const bad = await request(app).get('/api/auth/username-available').query({ username: 'a b' });
  assert.equal(bad.body.available, false);
  assert.match(bad.body.reason, /letters, numbers|at least 3/);
});
