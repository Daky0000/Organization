// Wire platformConfigRoutes.ts into server.ts:
// - Delete block 1: lines 7545-7730 (platform-configs + audit-logs routes)
// - Replace block 2: lines 8037-8169 (oauth/configured + integrations/validate) with mount call
// - Delete block 3: lines 8174-8373 (integrations/enabled + integrations/catalog)
import { readFileSync, writeFileSync } from 'fs';

const serverPath = 'd:/Saas/packages/api/src/server.ts';
const lines = readFileSync(serverPath, 'utf8').split('\n');
const orig = lines.length;

// Sanity checks (1-indexed line numbers)
const b1Start = 7546, b1End = 7731;   // platform config routes incl. audit-logs
const b2Start = 8038, b2End = 8170;   // oauth/configured + integrations/validate
const b3Start = 8175, b3End = 8374;   // integrations/enabled + integrations/catalog

[
  [b1Start, '// ─── Platform Config Routes (Admin)'],
  [b2Start, '// GET /api/oauth/:platform/configured — check'],
  [b3Start, '// ─── Integration Enabled List'],
].forEach(([lineNo, expected]) => {
  const actual = lines[lineNo - 1]?.trim() ?? '';
  if (!actual.startsWith(expected)) {
    console.error(`Line ${lineNo} mismatch.\n  Expected prefix: ${expected}\n  Got: ${actual}`);
    process.exit(1);
  }
});

const mountCall = [
  'app.use(\'/api\', registerPlatformConfigRoutes({',
  '  requireAuth, requireAdmin, hasDatabase, dbQuery, pool,',
  '  inMemoryPlatformConfigs, getPlatformConfig, getIntegrationRowBySlug,',
  '  getResendConfig, refreshStripe,',
  '  oauthAuthUrls: OAUTH_AUTH_URLS,',
  '  resolveOAuthRedirectUri,',
  '  isOAuthClientSecretRequired,',
  '}));',
  '',
];

// Work backwards so earlier indices stay valid
// 1. Remove block3 (integrations/enabled + catalog) — lines 8174-8373
lines.splice(b3Start - 1, b3End - b3Start + 1);

// 2. Replace block2 (oauth/configured + integrations/validate) with mount call
lines.splice(b2Start - 1, b2End - b2Start + 1, ...mountCall);

// 3. Remove block1 (platform-configs routes + audit-logs)
lines.splice(b1Start - 1, b1End - b1Start + 1);

writeFileSync(serverPath, lines.join('\n'), 'utf8');
const removed = orig - lines.length;
console.log(`Done: ${orig} → ${lines.length} lines (removed ${removed} lines, added ${mountCall.length} mount call lines)`);
