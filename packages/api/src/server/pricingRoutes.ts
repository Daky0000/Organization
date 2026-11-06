import type { Response } from 'express';
import type { Request } from '../types/http.ts';
import { Router } from 'express';
import { randomUUID } from 'crypto';
import { logger } from '../logger.ts';
import { recordAuditLog } from '../link-metadata.ts';

type DbPricingPlan = {
  id: string;
  name: string;
  description: string;
  price: number;
  billing_period: 'monthly' | 'yearly';
  features: string[];
  is_active: boolean;
  discount_percentage: number;
  is_on_sale: boolean;
  created_at: string;
  updated_at: string;
};

export interface PricingDeps {
  requireAdmin: (req: Request, res: Response) => Promise<{ userId: string } | null>;
  hasDatabase: () => boolean;
  dbQuery: <T = any>(sql: string, params?: any[]) => Promise<{ rows: T[]; rowCount?: number | null }>;
  inMemoryPricingPlansById: Map<string, DbPricingPlan>;
}

export function registerPricingRoutes(deps: PricingDeps): Router {
  const { requireAdmin, hasDatabase, dbQuery, inMemoryPricingPlansById } = deps;
  const router = Router();

router.get('/pricing/plans', async (req: Request, res: Response) => {
  try {
    let plans: DbPricingPlan[] = [];

    if (!hasDatabase()) {
      plans = Array.from(inMemoryPricingPlansById.values());
      logger.info(`GET /api/pricing/plans - Returning ${plans.length} in-memory plans`);
    } else {
      const result = await dbQuery<DbPricingPlan>(
        'SELECT id, name, description, price, billing_period, features, is_active, discount_percentage, is_on_sale, created_at, updated_at FROM pricing_plans ORDER BY created_at DESC'
      );
      plans = result.rows;
      logger.info(`GET /api/pricing/plans - Returning ${plans.length} database plans`);
    }

    logger.info('Plans to return:', plans.length > 0 ? plans[0] : 'No plans');

    return res.json({
      success: true,
      plans: plans.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        price: parseFloat(String(p.price)),
        billingPeriod: p.billing_period,
        features: Array.isArray(p.features) ? p.features : [],
        isActive: p.is_active,
        discountPercentage: parseFloat(String(p.discount_percentage ?? 0)),
        isOnSale: p.is_on_sale ?? false,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
      })),
    });
  } catch (error) {
    logger.error('Get pricing plans error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch pricing plans' });
  }
});

router.post('/pricing/plans', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { name, description, price, billingPeriod, features, discountPercentage, isOnSale } = req.body;
    void recordAuditLog((admin as any).id, 'admin_pricing_plan_created', [], { name });
    if (!name || !description || price === undefined) {
      return res
        .status(400)
        .json({ success: false, error: 'Name, description, and price are required' });
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const discPct = Number(discountPercentage ?? 0);
    const onSale = Boolean(isOnSale ?? false);

    if (!hasDatabase()) {
      const plan: DbPricingPlan = {
        id,
        name,
        description,
        price: Number(price),
        billing_period: (billingPeriod || 'monthly') as 'monthly' | 'yearly',
        features: Array.isArray(features) ? features : [],
        is_active: true,
        discount_percentage: discPct,
        is_on_sale: onSale,
        created_at: now,
        updated_at: now,
      };
      inMemoryPricingPlansById.set(id, plan);

      return res.status(201).json({
        success: true,
        plan: {
          id: plan.id,
          name: plan.name,
          description: plan.description,
          price: plan.price,
          billingPeriod: plan.billing_period,
          features: plan.features,
          isActive: plan.is_active,
          discountPercentage: plan.discount_percentage,
          isOnSale: plan.is_on_sale,
          createdAt: plan.created_at,
          updatedAt: plan.updated_at,
        },
      });
    } else {
      const result = await dbQuery<DbPricingPlan>(
        'INSERT INTO pricing_plans (id, name, description, price, billing_period, features, is_active, discount_percentage, is_on_sale, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10) RETURNING *',
        [
          id,
          name,
          description,
          Number(price),
          billingPeriod || 'monthly',
          features || [],
          true,
          discPct,
          onSale,
          now,
        ]
      );
      const plan = result.rows[0];

      return res.status(201).json({
        success: true,
        plan: {
          id: plan.id,
          name: plan.name,
          description: plan.description,
          price: parseFloat(String(plan.price)),
          billingPeriod: plan.billing_period,
          features: Array.isArray(plan.features) ? plan.features : [],
          isActive: plan.is_active,
          discountPercentage: parseFloat(String(plan.discount_percentage ?? 0)),
          isOnSale: plan.is_on_sale ?? false,
          createdAt: plan.created_at,
          updatedAt: plan.updated_at,
        },
      });
    }
  } catch (error) {
    logger.error('Create pricing plan error:', error);
    return res.status(500).json({ success: false, error: 'Failed to create pricing plan' });
  }
});

router.put('/pricing/plans/:id', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { id } = req.params;
    const { name, description, price, billingPeriod, features, isActive, discountPercentage, isOnSale } = req.body;
    void recordAuditLog((admin as any).id, 'admin_pricing_plan_updated', [], { planId: id, name });

    if (!name || !description || price === undefined) {
      return res
        .status(400)
        .json({ success: false, error: 'Name, description, and price are required' });
    }

    const now = new Date().toISOString();
    const discPct = Number(discountPercentage ?? 0);
    const onSale = Boolean(isOnSale ?? false);

    if (!hasDatabase()) {
      const existing = inMemoryPricingPlansById.get(id);
      if (!existing) {
        return res.status(404).json({ success: false, error: 'Pricing plan not found' });
      }

      const updated: DbPricingPlan = {
        ...existing,
        name,
        description,
        price: Number(price),
        billing_period: (billingPeriod || 'monthly') as 'monthly' | 'yearly',
        features: Array.isArray(features) ? features : [],
        is_active: isActive !== undefined ? isActive : existing.is_active,
        discount_percentage: discPct,
        is_on_sale: onSale,
        updated_at: now,
      };
      inMemoryPricingPlansById.set(id, updated);

      return res.json({
        success: true,
        plan: {
          id: updated.id,
          name: updated.name,
          description: updated.description,
          price: updated.price,
          billingPeriod: updated.billing_period,
          features: updated.features,
          isActive: updated.is_active,
          discountPercentage: updated.discount_percentage,
          isOnSale: updated.is_on_sale,
          createdAt: updated.created_at,
          updatedAt: updated.updated_at,
        },
      });
    } else {
      const result = await dbQuery<DbPricingPlan>(
        'UPDATE pricing_plans SET name = $1, description = $2, price = $3, billing_period = $4, features = $5, is_active = $6, discount_percentage = $7, is_on_sale = $8, updated_at = $9 WHERE id = $10 RETURNING *',
        [
          name,
          description,
          Number(price),
          billingPeriod || 'monthly',
          features || [],
          isActive !== undefined ? isActive : true,
          discPct,
          onSale,
          now,
          id,
        ]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Pricing plan not found' });
      }

      const plan = result.rows[0];
      return res.json({
        success: true,
        plan: {
          id: plan.id,
          name: plan.name,
          description: plan.description,
          price: parseFloat(String(plan.price)),
          billingPeriod: plan.billing_period,
          features: Array.isArray(plan.features) ? plan.features : [],
          isActive: plan.is_active,
          discountPercentage: parseFloat(String(plan.discount_percentage ?? 0)),
          isOnSale: plan.is_on_sale ?? false,
          createdAt: plan.created_at,
          updatedAt: plan.updated_at,
        },
      });
    }
  } catch (error) {
    logger.error('Update pricing plan error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update pricing plan' });
  }
});

router.delete('/pricing/plans/:id', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { id } = req.params;

    if (!hasDatabase()) {
      if (!inMemoryPricingPlansById.has(id)) {
        return res.status(404).json({ success: false, error: 'Pricing plan not found' });
      }
      inMemoryPricingPlansById.delete(id);
    } else {
      const result = await dbQuery('DELETE FROM pricing_plans WHERE id = $1', [id]);
      if (result.rowCount === 0) {
        return res.status(404).json({ success: false, error: 'Pricing plan not found' });
      }
    }

    return res.json({ success: true });
  } catch (error) {
    logger.error('Delete pricing plan error:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete pricing plan' });
  }
});

router.patch('/pricing/plans/:id/status', async (req: Request, res: Response) => {
  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    const { id } = req.params;
    const { isActive } = req.body;

    if (isActive === undefined) {
      return res.status(400).json({ success: false, error: 'isActive is required' });
    }

    const now = new Date().toISOString();

    if (!hasDatabase()) {
      const existing = inMemoryPricingPlansById.get(id);
      if (!existing) {
        return res.status(404).json({ success: false, error: 'Pricing plan not found' });
      }

      const updated: DbPricingPlan = {
        ...existing,
        is_active: isActive,
        updated_at: now,
      };
      inMemoryPricingPlansById.set(id, updated);

      return res.json({
        success: true,
        plan: {
          id: updated.id,
          name: updated.name,
          description: updated.description,
          price: updated.price,
          billingPeriod: updated.billing_period,
          features: updated.features,
          isActive: updated.is_active,
          createdAt: updated.created_at,
          updatedAt: updated.updated_at,
        },
      });
    } else {
      const result = await dbQuery<DbPricingPlan>(
        'UPDATE pricing_plans SET is_active = $1, updated_at = $2 WHERE id = $3 RETURNING *',
        [isActive, now, id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Pricing plan not found' });
      }

      const plan = result.rows[0];
      return res.json({
        success: true,
        plan: {
          id: plan.id,
          name: plan.name,
          description: plan.description,
          price: parseFloat(String(plan.price)),
          billingPeriod: plan.billing_period,
          features: Array.isArray(plan.features) ? plan.features : [],
          isActive: plan.is_active,
          createdAt: plan.created_at,
          updatedAt: plan.updated_at,
        },
      });
    }
  } catch (error) {
    logger.error('Update pricing plan status error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update pricing plan status' });
  }
});

// Card Templates Routes
  return router;
}
