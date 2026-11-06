import { CreditError, grant } from './creditAccounting.ts';
import { registerCreditStoreRoutes } from './creditStoreRoutes.ts';
import express from 'express';
import type { Router, Response } from 'express';
import type { Request } from '../types/http.ts';
import type { Pool } from 'pg';
import { ensureCreditAccount, chargeAICredits, grantCredits } from '../ai-helpers.ts';
import { PaymentError, type ConfigReader } from './paystackService.ts';
import { recordAuditLog } from '../link-metadata.ts';

type AuthResult = { userId: string; role?: string } | null;

interface CreditsDeps {
  requireAuth: (req: Request, res: Response) => AuthResult;
  requireAdmin: (req: Request, res: Response) => Promise<AuthResult>;
  hasDatabase: () => boolean;
  pool: Pool;
  getPlatformConfig: ConfigReader;
}

export function registerCreditsRoutes({ requireAuth, requireAdmin, hasDatabase, pool, getPlatformConfig }: CreditsDeps): Router {
  const router = express.Router();

  router.use(registerCreditStoreRoutes({ pool,getPlatformConfig,requireAuth,requireAdmin,hasDatabase }));

  // POST /api/credits/use — spend credits (frontend-initiated features).
  router.post('/credits/use', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const rawAmount = Number((req.body as { amount?: unknown })?.amount ?? 5);
    if (!Number.isFinite(rawAmount) || !Number.isInteger(rawAmount) || rawAmount < 1 || rawAmount > 500) {
      return res.status(400).json({ success: false, error: 'amount must be an integer between 1 and 500' });
    }
    const reason = String((req.body as { reason?: unknown })?.reason ?? 'feature_use').slice(0, 60);
    try {
      const { credits } = await ensureCreditAccount(auth.userId);
      if (credits <= 0) return res.status(402).json({ success: false, error: 'Out of credits', credits: 0 });
      await chargeAICredits(auth.userId, rawAmount, reason, { source: 'credits_use_endpoint' });
      const after = await ensureCreditAccount(auth.userId);
      return res.json({ success: true, credits: after.credits });
    } catch (e: any) {
      return res.status(e instanceof PaymentError || e instanceof CreditError ? e.status : 500).json({ success: false, error: e instanceof PaymentError || e instanceof CreditError ? e.message : 'Unable to complete credit operation' });
    }
  });

  // POST /api/credits/admin/grant
  router.post('/credits/admin/grant', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!hasDatabase()) return res.json({ success: true });
    const { user_id, email, amount } = req.body as { user_id?: string; email?: string; amount: number };
    const amt = Number(amount);
    if ((!user_id && !email) || !Number.isInteger(amt) || amt < 1 || amt > 1_000_000) {
      return res.status(400).json({ success: false, error: 'user_id or email, and a positive integer amount required' });
    }
    try {
      let resolvedId = user_id;
      if (!resolvedId && email) {
        const r = await pool.query(`SELECT id FROM users WHERE email = $1 LIMIT 1`, [email.trim().toLowerCase()]);
        if (!r.rows[0]) return res.status(404).json({ success: false, error: `No user found with email: ${email}` });
        resolvedId = r.rows[0].id;
      }
      const balance = await grantCredits(resolvedId!, amt, 'admin_grant', { granted_by: (admin as any).id ?? 'admin' });
      void recordAuditLog((admin as any).id, 'admin_credits_granted', [], { targetUserId: resolvedId, amount: amt });
      return res.json({ success: true, user_id: resolvedId, credits: balance });
    } catch (e: any) {
      return res.status(e instanceof PaymentError || e instanceof CreditError ? e.status : 500).json({ success: false, error: e instanceof PaymentError || e instanceof CreditError ? e.message : 'Unable to complete credit operation' });
    }
  });

  // POST /api/credits/admin/grant-all
  router.post('/credits/admin/grant-all', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!hasDatabase()) return res.json({ success: true, updated: 0 });
    const amt = Number((req.body as { amount?: unknown })?.amount);
    if (!Number.isInteger(amt) || amt < 1 || amt > 1_000_000) {
      return res.status(400).json({ success: false, error: 'amount must be a positive integer' });
    }
    try {
      const { rows: users }=await pool.query('SELECT id FROM users ORDER BY id');
      for(const user of users) await grant(pool,user.id,amt,'admin_grant',{ granted_by:admin.userId });
      await recordAuditLog(admin.userId,'admin_credits_granted_all',[],{ amount:amt,updated:users.length });
      return res.json({ success:true,updated:users.length });
    } catch (e: any) {
      return res.status(e instanceof PaymentError || e instanceof CreditError ? e.status : 500).json({ success: false, error: e instanceof PaymentError || e instanceof CreditError ? e.message : 'Unable to complete credit operation' });
    }
  });

  // POST /api/card-templates/:id/view
  router.post('/card-templates/:id/view', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.json({ success: true, view_count: 0 });
    const { id } = req.params;
    try {
      const { rows } = await pool.query<{ view_count: number }>(
        `UPDATE card_templates SET view_count = view_count + 1 WHERE id = $1 RETURNING view_count`,
        [id]
      );
      return res.json({ success: true, view_count: rows[0]?.view_count ?? 0 });
    } catch (e: any) {
      return res.status(e instanceof PaymentError || e instanceof CreditError ? e.status : 500).json({ success: false, error: e instanceof PaymentError || e instanceof CreditError ? e.message : 'Unable to complete credit operation' });
    }
  });

  // POST /api/card-templates/:id/like
  router.post('/card-templates/:id/like', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.json({ success: true, liked: true, like_count: 0 });
    const { id } = req.params;
    try {
      const existing = await pool.query(
        'SELECT 1 FROM design_likes WHERE user_id = $1 AND design_id = $2 AND design_type = $3',
        [auth.userId, id, 'template']
      );
      let liked: boolean;
      if (existing.rows.length > 0) {
        await pool.query('DELETE FROM design_likes WHERE user_id = $1 AND design_id = $2', [auth.userId, id]);
        await pool.query(`UPDATE card_templates SET like_count = GREATEST(0, like_count - 1) WHERE id = $1`, [id]);
        liked = false;
      } else {
        await pool.query(
          'INSERT INTO design_likes (user_id, design_id, design_type) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [auth.userId, id, 'template']
        );
        await pool.query(`UPDATE card_templates SET like_count = like_count + 1 WHERE id = $1`, [id]);
        liked = true;
      }
      const { rows } = await pool.query<{ like_count: number }>('SELECT like_count FROM card_templates WHERE id = $1', [id]);
      return res.json({ success: true, liked, like_count: rows[0]?.like_count ?? 0 });
    } catch (e: any) {
      return res.status(e instanceof PaymentError || e instanceof CreditError ? e.status : 500).json({ success: false, error: e instanceof PaymentError || e instanceof CreditError ? e.message : 'Unable to complete credit operation' });
    }
  });

  // POST /api/user-designs/:id/like
  router.post('/user-designs/:id/like', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.json({ success: true, liked: true, like_count: 0 });
    const { id } = req.params;
    try {
      const existing = await pool.query(
        'SELECT 1 FROM design_likes WHERE user_id = $1 AND design_id = $2 AND design_type = $3',
        [auth.userId, id, 'user']
      );
      let liked: boolean;
      if (existing.rows.length > 0) {
        await pool.query('DELETE FROM design_likes WHERE user_id = $1 AND design_id = $2', [auth.userId, id]);
        await pool.query(`UPDATE user_designs SET like_count = GREATEST(0, like_count - 1) WHERE id = $1`, [id]);
        liked = false;
      } else {
        await pool.query(
          'INSERT INTO design_likes (user_id, design_id, design_type) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [auth.userId, id, 'user']
        );
        await pool.query(`UPDATE user_designs SET like_count = like_count + 1 WHERE id = $1`, [id]);
        liked = true;
      }
      const { rows } = await pool.query<{ like_count: number }>('SELECT like_count FROM user_designs WHERE id = $1', [id]);
      return res.json({ success: true, liked, like_count: rows[0]?.like_count ?? 0 });
    } catch (e: any) {
      return res.status(e instanceof PaymentError || e instanceof CreditError ? e.status : 500).json({ success: false, error: e instanceof PaymentError || e instanceof CreditError ? e.message : 'Unable to complete credit operation' });
    }
  });

  // GET /api/user-designs/likes
  router.get('/user-designs/likes', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.json({ success: true, liked_ids: [] });
    try {
      const { rows } = await pool.query<{ design_id: string }>(
        `SELECT design_id FROM design_likes WHERE user_id = $1 AND design_type = 'user'`,
        [auth.userId]
      );
      return res.json({ success: true, liked_ids: rows.map((r) => r.design_id) });
    } catch (e: any) {
      return res.status(e instanceof PaymentError || e instanceof CreditError ? e.status : 500).json({ success: false, error: e instanceof PaymentError || e instanceof CreditError ? e.message : 'Unable to complete credit operation' });
    }
  });

  // GET /api/user-designs/:id/liked
  router.get('/user-designs/:id/liked', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.json({ liked: false });
    const { id } = req.params;
    try {
      const { rows } = await pool.query(
        `SELECT 1 FROM design_likes WHERE user_id = $1 AND design_id = $2 AND design_type = 'user'`,
        [auth.userId, id]
      );
      return res.json({ liked: rows.length > 0 });
    } catch (e: any) {
      return res.status(e instanceof PaymentError || e instanceof CreditError ? e.status : 500).json({ success: false, error: e instanceof PaymentError || e instanceof CreditError ? e.message : 'Unable to complete credit operation' });
    }
  });

  return router;
}
