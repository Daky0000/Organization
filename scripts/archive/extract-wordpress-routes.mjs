// Extract WordPress routes from server.ts into wordpressRoutes.ts
import { readFileSync, writeFileSync } from 'fs';

const serverPath = 'd:/Saas/packages/api/src/server.ts';
const outPath = 'd:/Saas/packages/api/src/server/wordpressRoutes.ts';

const lines = readFileSync(serverPath, 'utf8').split('\n');

// Find boundaries: start at first wordpress/connect route, end before pricing/plans
let start = -1, end = -1;
for (let i = 0; i < lines.length; i++) {
  if (start < 0 && lines[i].includes("app.post('/api/wordpress/connect'")) { start = i; }
  if (start >= 0 && lines[i].includes("app.get('/api/pricing/plans'") && i > start) { end = i - 1; break; }
}
while (end > start && lines[end].trim() === '') end--;
console.log(`WordPress section: lines ${start + 1}–${end + 1} (${end - start + 1} lines)`);

const rawContent = lines.slice(start, end + 1).join('\n')
  .replace(/^app\.(get|post|put|delete|patch)\(/mg, 'router.$1(');

const header = `import axios from 'axios';
import type { Request, Response } from 'express';
import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import { logger } from '../logger.ts';

export interface WordPressDeps {
  requireAuth: (req: Request, res: Response) => { userId: string; role: string; tokenVersion: number | null } | null;
  hasDatabase: () => boolean;
  dbQuery: <T = any>(sql: string, params?: any[]) => Promise<{ rows: T[]; rowCount?: number | null }>;
  pool: Pool | null;
  encryptWordPressPassword: (plain: string) => string;
  decryptWordPressPassword: (encrypted: string) => string;
  getWordPressConnection: (userId: string) => Promise<any>;
  wpRequest: (siteUrl: string, username: string, password: string, method: string, path: string, opts?: any) => Promise<any>;
  upsertUserIntegration: (params: any) => Promise<void>;
  logIntegrationEvent: (params: any) => Promise<void>;
  ensureWordPressSocialAccount: (userId: string) => Promise<void>;
}

export function registerWordPressRoutes(deps: WordPressDeps): Router {
  const {
    requireAuth, hasDatabase, dbQuery, pool,
    encryptWordPressPassword, decryptWordPressPassword, getWordPressConnection, wpRequest,
    upsertUserIntegration, logIntegrationEvent, ensureWordPressSocialAccount,
  } = deps;
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
