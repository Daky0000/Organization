// Script to extract distributionRoutes.ts from server.ts
import { readFileSync, writeFileSync } from 'fs';

const serverPath = 'd:/Saas/packages/api/src/server.ts';
const outPath = 'd:/Saas/packages/api/src/server/distributionRoutes.ts';

const lines = readFileSync(serverPath, 'utf8').split('\n');

// Find distribution section boundaries (0-indexed search)
let distStart = -1, distEnd = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('// ── Distribution / Automation')) { distStart = i; }
  if (distStart > 0 && lines[i].includes('// ─── Mailing') && i > distStart) { distEnd = i - 1; break; }
}
console.log(`Distribution section: lines ${distStart + 1}–${distEnd + 1} (${distEnd - distStart + 1} lines)`);

// Extract section and transform app. → router.
const distRaw = lines.slice(distStart, distEnd + 1).join('\n');
const distContent = distRaw
  .replace(/^app\.(get|post|put|delete|patch)\(/mg, 'router.$1(')
  .replace(/^\/\/ ── Distribution \/ Automation[^\n]*\n/m, '');  // remove section header

const header = `import axios from 'axios';
import type { Request, Response } from 'express';
import { Router } from 'express';
import type { Pool } from 'pg';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { FacebookPagesPlatform } from '../../backend/platforms/facebook_pages.ts';
import { InstagramBusinessPlatform } from '../../backend/platforms/instagram_business.ts';
import { LinkedInPlatform } from '../../backend/platforms/linkedin.ts';
import { TwitterXPlatform } from '../../backend/platforms/twitter_x.ts';
import { TikTokAdapter } from '../../backend/src/services/platform-adapters/tiktok.adapter.ts';
import type { PostObject } from '../../backend/platforms/types.ts';
import { config } from '../config.ts';
import { logger } from '../logger.ts';

// ─── Deps ─────────────────────────────────────────────────────────────────────

export interface DistributionDeps {
  requireAuth: (req: Request, res: Response) => { userId: string; role: string; tokenVersion: number | null } | null;
  pool: Pool | null;
  dbQuery: <T = any>(sql: string, params?: any[]) => Promise<{ rows: T[] }>;
  decryptIntegrationSecret: (encrypted: string) => string;
  getIntegrationRowBySlug: (slug: string) => Promise<{ id: number; slug: string; name: string | null; type: string | null } | null>;
  logIntegrationEvent: (params: { userId: string | null; integrationSlug: string | null; eventType: string; status: 'success' | 'failed' | 'info'; response?: any }) => Promise<void>;
  getPlatformConfig: (platform: string) => Promise<Record<string, string>>;
  getWordPressConnection: (userId: string) => Promise<any>;
  decryptWordPressPassword: (encrypted: string) => string;
  wpRequest: (siteUrl: string, username: string, password: string, method: string, path: string, opts?: any) => Promise<any>;
}

export type PublishableSocialConnection = {
  platform: string;
  access_token: string;
  refresh_token?: string | null;
  token_data: any;
  account_id?: string | null;
  account_name?: string | null;
  needs_reapproval?: boolean;
  token_expires_at?: string | null;
};

// ─── Platform instances (singletons) ─────────────────────────────────────────

const facebookPagesPlatform = new FacebookPagesPlatform();
const instagramBusinessPlatform = new InstagramBusinessPlatform();
const linkedInPlatform = new LinkedInPlatform();
const twitterXPlatform = new TwitterXPlatform();

const REDIS_URL = config.redisUrl;

// ─── Factory ──────────────────────────────────────────────────────────────────

export interface DistributionModule {
  router: Router;
  getPublishableSocialConnection: (userId: string, platformId: string) => Promise<PublishableSocialConnection | null>;
  startSocialAutomationProcessor: () => void;
  startTokenHealthMonitor: () => void;
}

export function buildDistributionModule(deps: DistributionDeps): DistributionModule {
  const {
    requireAuth, pool, dbQuery,
    decryptIntegrationSecret, getIntegrationRowBySlug, logIntegrationEvent,
    getPlatformConfig, getWordPressConnection, decryptWordPressPassword, wpRequest,
  } = deps;
  const router = Router();

`;

const factoryClose = `
  return { router, getPublishableSocialConnection, startSocialAutomationProcessor, startTokenHealthMonitor };
}
`;

// Build full file
const content = header + distContent + factoryClose;

// Fix: remove the duplicate 'type PublishableSocialConnection' from the extracted content
// (it's now defined at module level)
const finalContent = content.replace(
  /^type PublishableSocialConnection = \{[\s\S]*?^};\n\n/m,
  ''
);

writeFileSync(outPath, finalContent, 'utf8');
const outLines = finalContent.split('\n').length;
console.log(`Written ${outLines} lines to ${outPath}`);
console.log('Routes registered:', (finalContent.match(/router\.(get|post|put|delete|patch)\(/g) || []).length);
