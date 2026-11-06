// Script to extract analyticsRoutes.ts from server.ts
import { readFileSync, writeFileSync } from 'fs';

const serverPath = 'd:/Saas/packages/api/src/server.ts';
const outPath = 'd:/Saas/packages/api/src/server/analyticsRoutes.ts';

const lines = readFileSync(serverPath, 'utf8').split('\n');

// Extract helper functions (0-indexed line numbers = file line - 1)
const syncInstagram = lines.slice(9789, 10025).join('\n');
const syncThreads = lines.slice(10025, 10374).join('\n');
const syncPinterest = lines.slice(10374, 10597).join('\n');
const fetchTikTok = lines.slice(14994, 15053).join('\n');

// Extract analytics section (17395–20734) and replace app. → router.
const analyticsRaw = lines.slice(17394, 20734).join('\n');
const analyticsRoutes = analyticsRaw
  // Replace route registrations
  .replace(/^app\.(get|post|put|delete|patch)\(/mg, 'router.$1(')
  // Remove section-header comments (they'll be noise in a dedicated file)
  ;

const header = `import axios from 'axios';
import type { Request, Response } from 'express';
import { Router } from 'express';
import type { Pool } from 'pg';
import { logger } from '../logger.ts';

// ─── Deps ─────────────────────────────────────────────────────────────────────

export interface AnalyticsDeps {
  requireAuth: (req: Request, res: Response) => { userId: string; role: string; tokenVersion: number | null } | null;
  pool: Pool | null;
  decryptIntegrationSecret: (encrypted: string) => string;
  getPublishableSocialConnection: (userId: string, platformId: string) => Promise<any>;
}

// ─── Module-level constants ───────────────────────────────────────────────────

const META_GRAPH_BASE = 'https://graph.facebook.com/v19.0';
const INSTAGRAM_PROFILE_FIELDS = 'id,username,name,account_type,biography,followers_count,follows_count,media_count,profile_picture_url,website,is_verified';

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function parseAnalyticsRange(preset: string | undefined, startStr: string | undefined, endStr: string | undefined) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let start: Date, end: Date, label: string;
  const p = preset || '30d';
  if (p === 'custom' && startStr && endStr) {
    start = new Date(startStr);
    end = new Date(endStr);
    label = \`\${startStr} – \${endStr}\`;
  } else if (p === '7d') {
    start = new Date(today); start.setDate(start.getDate() - 6);
    end = today; label = 'Last 7 days';
  } else if (p === '90d') {
    start = new Date(today); start.setDate(start.getDate() - 89);
    end = today; label = 'Last 90 days';
  } else {
    start = new Date(today); start.setDate(start.getDate() - 29);
    end = today; label = 'Last 30 days';
  }
  const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  const prevEnd = new Date(start); prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd); prevStart.setDate(prevStart.getDate() - days + 1);
  return {
    preset: p as '7d' | '30d' | '90d' | 'custom',
    start, end, label, days, prevStart, prevEnd,
    startIso: start.toISOString(),
    endIso: new Date(end.getTime() + 86399999).toISOString(),
    prevStartIso: prevStart.toISOString(),
    prevEndIso: new Date(prevEnd.getTime() + 86399999).toISOString(),
  };
}

function analyticsPlatformLabel(platform: string): string {
  const map: Record<string, string> = {
    facebook: 'Facebook', instagram: 'Instagram', twitter: 'X (Twitter)',
    linkedin: 'LinkedIn', pinterest: 'Pinterest', threads: 'Threads',
    tiktok: 'TikTok', wordpress: 'WordPress',
  };
  return map[platform?.toLowerCase()] || platform;
}

function analyticsFmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ─── TikTok profile fetcher ───────────────────────────────────────────────────
`;

const factoryOpen = `
// ─── Factory ──────────────────────────────────────────────────────────────────

export function registerAnalyticsRoutes(deps: AnalyticsDeps): Router {
  const { requireAuth, pool, decryptIntegrationSecret, getPublishableSocialConnection } = deps;
  const router = Router();

  // Tiny wrapper — silently returns '' on decrypt failure
  function decodeStoredIntegrationSecret(value: string | null | undefined): string {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try { return decryptIntegrationSecret(raw); } catch (err) { logger.error('Unhandled error:', err); return ''; }
  }

  // ─── Sync helpers ──────────────────────────────────────────────────────────
`;

const factoryClose = `
  return router;
}
`;

// Remove the duplicate helper definitions from the analytics routes section
// (parseAnalyticsRange, analyticsPlatformLabel, analyticsFmtDate are now module-level)
const cleanedAnalytics = analyticsRoutes
  // Remove the section that defines parseAnalyticsRange (lines 17397-17427 in original)
  // It starts with "function parseAnalyticsRange" and ends after the closing brace
  .replace(/\/\/ ─── Analytics & Insights Engine[^\n]*\n\nfunction parseAnalyticsRange[\s\S]*?^}\n\nfunction analyticsPlatformLabel[\s\S]*?^}\n\nfunction analyticsFmtDate[\s\S]*?^}\n\n/m, '')
  // Remove the fetchTikTokUserProfile definition (already included above)
  ;

// Build the complete file content
const content = [
  header,
  fetchTikTok,
  factoryOpen,
  syncInstagram,
  '\n',
  syncThreads,
  '\n',
  syncPinterest,
  '\n  // ─── Routes ──────────────────────────────────────────────────────────────\n',
  cleanedAnalytics,
  factoryClose,
].join('\n');

writeFileSync(outPath, content, 'utf8');
const outLines = content.split('\n').length;
console.log(`Written ${outLines} lines to ${outPath}`);
console.log('Routes registered:', (content.match(/router\.(get|post|put|delete|patch)\(/g) || []).length);
