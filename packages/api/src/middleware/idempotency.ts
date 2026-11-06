import type { Response, NextFunction } from 'express';
import type { Request } from '../types/http.ts';
import { createHash } from 'node:crypto';
import { pool, hasDatabase } from '../db.ts';

interface Entry { hash: string; status: number; body: unknown; expires: number }
const local = new Map<string,Entry>();
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export async function idempotencyMiddleware(req: Request,res: Response,next: NextFunction) {
  if (!['POST','PUT','PATCH'].includes(req.method)) return next();
  const key = String(req.headers['idempotency-key'] || '').trim();
  if (!key) return next();
  if (key.length > 200) return res.status(400).json({ error: 'Idempotency key is too long' });
  const scope = digest(`${req.headers.authorization || req.ip}:${req.method}:${req.originalUrl}`);
  const hash = digest(JSON.stringify(req.body ?? null));
  const composite = `${scope}:${key}`;
  try {
    let existing: Entry | undefined;
    if (hasDatabase()) {
      await pool.query('DELETE FROM request_idempotency WHERE scope=$1 AND key=$2 AND expires_at<=NOW()',[scope,key]);
      const claimed = await pool.query('INSERT INTO request_idempotency(scope,key,request_hash) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING key',[scope,key,hash]);
      if (!claimed.rows.length) {
        const result = await pool.query('SELECT request_hash,status,body FROM request_idempotency WHERE scope=$1 AND key=$2',[scope,key]);
        const row = result.rows[0];
        if (row) existing = { hash: row.request_hash,status: row.status || 0,body: row.body,expires: Date.now()+1 };
      }
    } else {
      for (const [entryKey,entry] of local) if (entry.expires<=Date.now()) local.delete(entryKey);
      if (local.size >= 2000 && !local.has(composite)) return res.status(429).json({ error: 'Too many pending requests' });
      existing = local.get(composite);
      if (!existing) local.set(composite,{ hash,status: 0,body: null,expires: Date.now()+86400000 });
    }
    if (existing) {
      if (existing.hash !== hash) return res.status(409).json({ error: 'This idempotency key was used with a different request' });
      if (!existing.status) return res.status(409).set('Retry-After','2').json({ error: 'This request is still processing' });
      return res.status(existing.status).set('X-Idempotent-Replay','true').json(existing.body);
    }
    const original = res.json.bind(res);
    res.json = ((body: unknown) => {
      const status = res.statusCode;
      if (hasDatabase()) {
        const save = status >= 200 && status < 300
          ? pool.query('UPDATE request_idempotency SET status=$3,body=$4::jsonb WHERE scope=$1 AND key=$2',[scope,key,status,JSON.stringify(body)])
          : pool.query('DELETE FROM request_idempotency WHERE scope=$1 AND key=$2',[scope,key]);
        void save.then(() => { res.set('X-Idempotent-Replay','false'); original(body); }).catch(() => { res.status(503); original({ error: 'Request persistence failed. Verify the operation before retrying.' }); });
      } else {
        if (status >= 200 && status < 300) local.set(composite,{ hash,status,body,expires: Date.now()+86400000 });
        else local.delete(composite);
        original(body);
      }
      return res;
    }) as typeof res.json;
    next();
  } catch { return res.status(503).json({ error: 'Request deduplication is unavailable' }); }
}
