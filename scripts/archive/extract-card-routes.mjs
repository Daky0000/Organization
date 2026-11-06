// Extract card template routes from server.ts into cardRoutes.ts
import { readFileSync, writeFileSync } from 'fs';

const serverPath = 'd:/Saas/packages/api/src/server.ts';
const outPath = 'd:/Saas/packages/api/src/server/cardRoutes.ts';

const lines = readFileSync(serverPath, 'utf8').split('\n');

// Find boundaries: start at first card-templates route, end before registerCreditsRoutes
let start = -1, end = -1;
for (let i = 0; i < lines.length; i++) {
  if (start < 0 && lines[i].includes("app.get('/api/card-templates'")) { start = i; }
  if (start >= 0 && lines[i].includes("registerCreditsRoutes") && i > start) { end = i - 1; break; }
}
// Trim trailing blanks
while (end > start && lines[end].trim() === '') end--;
console.log(`Card templates section: lines ${start + 1}–${end + 1} (${end - start + 1} lines)`);

const rawContent = lines.slice(start, end + 1).join('\n')
  .replace(/^app\.(get|post|put|delete|patch)\(/mg, 'router.$1(');

const header = `import type { Request, Response } from 'express';
import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import { logger } from '../logger.ts';

type DbCardTemplate = {
  id: string;
  name: string;
  description?: string;
  design_data: any;
  cover_image_url?: string;
  is_published: boolean;
  created_at: string;
  updated_at: string;
};

export interface CardTemplateDeps {
  requireAuth: (req: Request, res: Response) => { userId: string; role: string; tokenVersion: number | null } | null;
  requireAdmin: (req: Request, res: Response) => Promise<{ userId: string } | null>;
  hasDatabase: () => boolean;
  dbQuery: <T = any>(sql: string, params?: any[]) => Promise<{ rows: T[]; rowCount?: number | null }>;
  pool: Pool | null;
  inMemoryCardTemplatesById: Map<string, DbCardTemplate>;
  syncCardTemplateMedia: (adminId: string, template: any) => Promise<number>;
}

export function registerCardTemplateRoutes(deps: CardTemplateDeps): Router {
  const { requireAuth, requireAdmin, hasDatabase, dbQuery, pool, inMemoryCardTemplatesById, syncCardTemplateMedia } = deps;
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
