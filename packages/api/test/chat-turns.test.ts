import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.JWT_SECRET ??= 'x'.repeat(32);
process.env.INTEGRATIONS_ENCRYPTION_KEY ??= 'y'.repeat(32);
process.env.WORDPRESS_ENCRYPTION_KEY ??= 'z'.repeat(32);

const turns = await import('../src/server/chatTurns.ts');
const express = (await import('express')).default;

/** A stand-in for the database: chat_turns rows in a Map. */
function fakeDb() {
  const rows = new Map<string, any>();
  const query = async (sql: string, params: unknown[] = []) => {
    const s = sql.trim();
    if (/^CREATE/i.test(s) || /^DELETE/i.test(s)) return { rows: [] };
    if (/^INSERT INTO chat_turns/i.test(s)) {
      const [id, user_id, kind, status, seq, events] = params as any[];
      const prev = rows.get(id);
      if (!prev || prev.user_id === user_id) rows.set(id, { id, user_id, kind, status, seq, events: JSON.parse(events), updated: Date.now() });
      return { rows: [] };
    }
    if (/^SELECT status, seq, events/i.test(s)) {
      const r = rows.get(String(params[0]));
      return { rows: r && r.user_id === params[1] ? [{ status: r.status, seq: r.seq, events: r.events, age_ms: Date.now() - r.updated }] : [] };
    }
    if (/^UPDATE chat_turns SET status='failed'/i.test(s)) { const r = rows.get(String(params[0])); if (r) r.status = 'failed'; return { rows: [] }; }
    throw new Error(`unexpected SQL: ${s}`);
  };
  return { rows, query };
}

/** A handler that writes like the chat does: SSE lines over time, then [DONE]. */
function slowReply(parts: string[], gapMs: number) {
  return async (res: any) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.write(`data: ${JSON.stringify({ type: 'status', text: 'Thinking' })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'tool_start', name: 'create_posts_batch', label: 'Planning' })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'tool_done', name: 'create_posts_batch', success: true })}\n\n`);
    for (const p of parts) {
      await new Promise((r) => setTimeout(r, gapMs));
      res.write(`data: ${JSON.stringify({ type: 'text', text: p })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
    res.end();
  };
}

/** Reads an SSE response into events; `stopAfter` hangs up early (like a tab going away). */
function readSse(port: number, path: string, stopAfter?: number): Promise<{ events: any[]; done: boolean }> {
  return new Promise((resolve, reject) => {
    const events: any[] = [];
    let buf = '';
    let done = false;
    const req = http.get({ port, path, headers: { 'x-user': 'u1' } }, (res) => {
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        buf += chunk;
        let at: number;
        while ((at = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, at); buf = buf.slice(at + 2);
          for (const line of frame.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            const payload = line.slice(6).trim();
            if (payload === '[DONE]') { done = true; continue; }
            events.push(JSON.parse(payload));
            if (stopAfter && events.length >= stopAfter) { req.destroy(); resolve({ events, done }); return; }
          }
        }
      });
      res.on('end', () => resolve({ events, done }));
    });
    req.on('error', (e: any) => (e.code === 'ECONNRESET' ? resolve({ events, done }) : reject(e)));
  });
}

function appWith(registry: any) {
  const app = express();
  app.get('/start/:id', (req, res) => {
    registry.start(req.params.id, 'u1', 'chat', slowReply(['Our rye ', 'proves for ', '18 hours.'], 60));
    void registry.follow(res, req.params.id, 'u1', 0);
  });
  app.get('/events/:id', (req, res) => { void registry.follow(res, req.params.id, String(req.headers['x-user']), Number(req.query.after || 0)); });
  return app;
}

test('turn sink: the handler\'s SSE writes become numbered events; [DONE] finishes; an early status/json is an error', async () => {
  const db = fakeDb();
  const reg = new turns.TurnRegistry(db.query);
  const job = reg.start('turn-aaaa-0001', 'u1', 'chat', slowReply(['a', 'b'], 1));
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(job.status, 'done');
  assert.deepEqual(job.events.map((e) => e.seq), [1, 2, 3, 4, 5]);
  const [start, done] = job.events.filter((e) => String(e.type).startsWith('tool_'));
  assert.ok(start.tool_id && start.tool_id === done.tool_id, 'tool_start and tool_done share a stable id');

  const failing = reg.start('turn-aaaa-0002', 'u1', 'chat', async (res: any) => { res.status(402).json({ error: 'Out of credits' }); });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(failing.status, 'failed');
  assert.equal(failing.events[0].type, 'error');
  assert.equal(failing.events[0].retryable, false);
});

test('turns: saved copies join text deltas and keep only the latest thinking', () => {
  const compact = turns.compactEvents([
    { seq: 1, type: 'status', text: 'x' }, { seq: 2, type: 'thinking', text: 'a' }, { seq: 3, type: 'text', text: 'Hel' },
    { seq: 4, type: 'text', text: 'lo' }, { seq: 5, type: 'thinking', text: 'b' }, { seq: 6, type: 'text_reset' }, { seq: 7, type: 'text', text: 'Hi' },
  ]);
  assert.deepEqual(compact.map((e) => [e.seq, e.type, e.text ?? null]), [[1, 'status', 'x'], [4, 'text', 'Hello'], [5, 'thinking', 'b'], [6, 'text_reset', null], [7, 'text', 'Hi']]);
  assert.equal(turns.cleanTurnId('ok-turn-1234'), 'ok-turn-1234');
  assert.equal(turns.cleanTurnId('../etc/passwd'), null);
  assert.equal(turns.cleanTurnId('short'), null);
});

test('turns: leaving mid-reply does not stop it; coming back gets exactly the missed events, live', async () => {
  const db = fakeDb();
  const reg = new turns.TurnRegistry(db.query);
  const server = http.createServer(appWith(reg));
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as any).port;
  try {
    // The tab goes away after the first 4 events (status, tool start, tool done, first words).
    const first = await readSse(port, '/start/turn-bbbb-0001', 4);
    assert.equal(first.events.length, 4);
    assert.equal(first.done, false);
    const job = reg.live('turn-bbbb-0001', 'u1')!;
    assert.equal(job.status, 'running', 'the reply carries on without the tab');
    // The tab is back: it asks for what came after the last event it saw.
    const back = await readSse(port, `/events/turn-bbbb-0001?after=${first.events[3].seq}`);
    assert.equal(back.done, true);
    assert.deepEqual(back.events.map((e) => e.seq), [5, 6]);
    const text = [...first.events, ...back.events].filter((e) => e.type === 'text').map((e) => e.text).join('');
    assert.equal(text, 'Our rye proves for 18 hours.', 'nothing missing, nothing twice');
    // Later (finished, still in memory): another device sees the whole reply.
    const again = await readSse(port, '/events/turn-bbbb-0001?after=0');
    assert.equal(again.events.length, 6);
    // Someone else's reply is not found.
    const other = await new Promise<number>((resolve) => http.get({ port, path: '/events/turn-bbbb-0001', headers: { 'x-user': 'intruder' } }, (r) => { r.resume(); resolve(r.statusCode!); }));
    assert.equal(other, 404);
  } finally {
    server.close();
  }
});

test('turns: after a server restart, the saved copy is sent from the start, and an unfinished reply says so', async () => {
  const db = fakeDb();
  const reg = new turns.TurnRegistry(db.query);
  const job = reg.start('turn-cccc-0001', 'u1', 'chat', slowReply(['Hello ', 'there'], 5));
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(job.status, 'done');
  // A new process: nothing in memory, only the database.
  const restarted = new turns.TurnRegistry(db.query);
  const server = http.createServer(appWith(restarted));
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as any).port;
  try {
    const finished = await readSse(port, '/events/turn-cccc-0001?after=2');
    assert.equal(finished.events[0].type, 'turn_reset', 'the client rebuilds the reply from the saved copy');
    assert.equal(finished.events.filter((e) => e.type === 'text').map((e) => e.text).join(''), 'Hello there');
    assert.equal(finished.done, true);
    // One that was still running when its server died: marked interrupted, Retry offered.
    db.rows.set('turn-cccc-0002', { id: 'turn-cccc-0002', user_id: 'u1', kind: 'chat', status: 'running', seq: 2, events: [{ seq: 1, type: 'status', text: 'x' }, { seq: 2, type: 'text', text: 'Hal' }], updated: Date.now() - 5 * 60_000 });
    const dead = await readSse(port, '/events/turn-cccc-0002?after=0');
    const last = dead.events[dead.events.length - 1];
    assert.equal(last.type, 'error');
    assert.equal(last.interrupted, true);
    assert.equal(db.rows.get('turn-cccc-0002').status, 'failed');
  } finally {
    server.close();
  }
});
