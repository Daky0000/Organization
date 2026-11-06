// Script to extract mediaRoutes.ts from server.ts
import { readFileSync, writeFileSync } from 'fs';

const serverPath = 'd:/Saas/packages/api/src/server.ts';
const outPath = 'd:/Saas/packages/api/src/server/mediaRoutes.ts';

const lines = readFileSync(serverPath, 'utf8').split('\n');

// Find media section boundaries
let mediaStart = -1, mediaEnd = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('// ─── Media Library')) mediaStart = i;
  if (mediaStart > 0 && lines[i].includes('// ── DB Audit') && i > mediaStart) {
    mediaEnd = i - 1;
    break;
  }
}
console.log(`Media section: lines ${mediaStart + 1}–${mediaEnd + 1} (${mediaEnd - mediaStart + 1} lines)`);

// Extract and transform
const mediaRaw = lines.slice(mediaStart, mediaEnd + 1).join('\n');
const mediaContent = mediaRaw
  .replace(/^app\.(get|post|put|delete|patch)\(/mg, 'router.$1(')
  .replace(/^\/\/ ─── Media Library[^\n]*\n/m, '');

const header = `import axios from 'axios';
import path from 'path';
import type { Request, Response } from 'express';
import { Router } from 'express';
import type { Pool } from 'pg';
import { config } from '../config.ts';
import { logger } from '../logger.ts';

// ─── Deps ─────────────────────────────────────────────────────────────────────

export interface MediaDeps {
  requireAuth: (req: Request, res: Response) => { userId: string; role: string; tokenVersion: number | null } | null;
  requireAdmin: (req: Request, res: Response) => Promise<{ userId: string } | null>;
  hasDatabase: () => boolean;
  pool: Pool | null;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export interface MediaModule {
  router: Router;
  syncProfileMedia: (user: any) => Promise<void>;
  syncBlogPostMedia: (userId: string, post: any) => Promise<void>;
  syncUserDesignMedia: (userId: string, designId: string, fabricJson: any) => Promise<void>;
  syncCardTemplateMedia: (adminId: string, template: any) => Promise<void>;
}

export function buildMediaModule(deps: MediaDeps): MediaModule {
  const { requireAuth, requireAdmin, hasDatabase, pool } = deps;
  const router = Router();

`;

const factoryClose = `
  return { router, syncProfileMedia, syncBlogPostMedia, syncUserDesignMedia, syncCardTemplateMedia };
}
`;

const content = header + mediaContent + factoryClose;
writeFileSync(outPath, content, 'utf8');
const outLines = content.split('\n').length;
console.log(`Written ${outLines} lines to ${outPath}`);
console.log('Routes registered:', (content.match(/router\.(get|post|put|delete|patch)\(/g) || []).length);
