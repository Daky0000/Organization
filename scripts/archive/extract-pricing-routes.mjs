// Extract pricing plan routes from server.ts into pricingRoutes.ts
import { readFileSync, writeFileSync } from 'fs';

const serverPath = 'd:/Saas/packages/api/src/server.ts';
const outPath = 'd:/Saas/packages/api/src/server/pricingRoutes.ts';

const lines = readFileSync(serverPath, 'utf8').split('\n');

// Find boundaries: start at pricing GET route, end before first card-templates route
let start = -1, end = -1;
for (let i = 0; i < lines.length; i++) {
  if (start < 0 && lines[i].includes("app.get('/api/pricing/plans'")) { start = i; }
  if (start >= 0 && lines[i].includes("app.get('/api/card-templates'") && i > start) { end = i - 1; break; }
}
while (end > start && lines[end].trim() === '') end--;
console.log(`Pricing section: lines ${start + 1}–${end + 1} (${end - start + 1} lines)`);

const rawContent = lines.slice(start, end + 1).join('\n')
  .replace(/^app\.(get|post|put|delete|patch)\(/mg, 'router.$1(');

const header = `import type { Request, Response } from 'express';
import { Router } from 'express';
import { randomUUID } from 'crypto';
import type Stripe from 'stripe';
import { logger } from '../logger.ts';

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
  stripe: Stripe | null;
  inMemoryPricingPlansById: Map<string, DbPricingPlan>;
}

export function registerPricingRoutes(deps: PricingDeps): Router {
  const { requireAdmin, hasDatabase, dbQuery, stripe, inMemoryPricingPlansById } = deps;
  const router = Router();

`;

const footer = `
  return router;
}
`;

writeFileSync(outPath, header + rawContent + footer, 'utf8');
const outLines = (header + rawContent + footer).split('\n').length;
console.log(`Written ${outLines} lines to ${outPath}`);
console.log('Routes:', (rawContent.match(/router\.(get|post|put|delete|patch)\(/g) || []).length);
