// Script to extract socialRoutes.ts from server.ts
import { readFileSync, writeFileSync } from 'fs';

const serverPath = 'd:/Saas/packages/api/src/server.ts';
const outPath = 'd:/Saas/packages/api/src/server/socialRoutes.ts';

const lines = readFileSync(serverPath, 'utf8').split('\n');

// Find boundaries
let socialStart = -1, socialEnd = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('// ── API v1: Social Automation endpoints')) socialStart = i;
  // End at AI Config section
  if (socialStart > 0 && lines[i].includes('// ─── AI Config (admin)') && i > socialStart) {
    socialEnd = i - 1;
    break;
  }
}
console.log(`Social section: lines ${socialStart + 1}–${socialEnd + 1} (${socialEnd - socialStart + 1} lines)`);

// Extract and transform
const socialRaw = lines.slice(socialStart, socialEnd + 1).join('\n');
const socialContent = socialRaw
  .replace(/^app\.(get|post|put|delete|patch)\(/mg, 'router.$1(')
  .replace(/^\/\/ ── API v1: Social Automation endpoints[^\n]*\n/m, '');

const header = `import axios from 'axios';
import type { Request, Response } from 'express';
import { Router } from 'express';
import type { Pool } from 'pg';
import { logger } from '../logger.ts';

// ─── Deps ─────────────────────────────────────────────────────────────────────

export interface SocialDeps {
  requireAuth: (req: Request, res: Response) => { userId: string; role: string; tokenVersion: number | null } | null;
  requireAdmin: (req: Request, res: Response) => Promise<{ userId: string } | null>;
  hasDatabase: () => boolean;
  pool: Pool | null;
  dbQuery: <T = any>(sql: string, params?: any[]) => Promise<{ rows: T[] }>;
  getPlatformConfig: (platform: string) => Promise<Record<string, string>>;
  getPublishableSocialConnection: (userId: string, platformId: string) => Promise<any>;
  normalizePlatformId: (value: string) => string;
  getSocialTemplateDefaults: (platformId: string) => any;
  mergeSocialTemplateSettings: (platformId: string, input: any) => any;
  renderSocialTemplatePreview: (userId: string, post: any, settings: any) => Promise<any>;
  loadSocialTemplateSettings: (userId: string, platformId: string) => Promise<any>;
  enqueueSocialAutomationTask: (params: any) => Promise<void>;
  syncSocialAutomationForPost: (userId: string, postId: string) => Promise<void>;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function registerSocialRoutes(deps: SocialDeps): Router {
  const {
    requireAuth, requireAdmin, hasDatabase, pool, dbQuery,
    getPlatformConfig, getPublishableSocialConnection,
    normalizePlatformId, getSocialTemplateDefaults, mergeSocialTemplateSettings,
    renderSocialTemplatePreview, loadSocialTemplateSettings,
    enqueueSocialAutomationTask, syncSocialAutomationForPost,
  } = deps;
  const router = Router();

`;

const factoryClose = `
  return router;
}
`;

const content = header + socialContent + factoryClose;
writeFileSync(outPath, content, 'utf8');
const outLines = content.split('\n').length;
console.log(`Written ${outLines} lines to ${outPath}`);
console.log('Routes registered:', (content.match(/router\.(get|post|put|delete|patch)\(/g) || []).length);
