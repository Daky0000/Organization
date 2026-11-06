// Replace LinkedIn + link-metadata routes (7600-7901) with registerLinkedInRoutes mount call
import { readFileSync, writeFileSync } from 'fs';

const serverPath = 'd:/Saas/packages/api/src/server.ts';
const lines = readFileSync(serverPath, 'utf8').split('\n');
const orig = lines.length;

// Find start: the comment before linkedin/targets
const startIdx = lines.findIndex(l => l.includes('GET /api/linkedin/targets — list the connected profile'));
if (startIdx < 0) { console.error('Start not found'); process.exit(1); }

// Find end: the closing }); of link-metadata route (just before API Versioning comment)
const endMarker = '// ── API Versioning ─';
const apiVersionIdx = lines.findIndex(l => l.includes(endMarker));
if (apiVersionIdx < 0) { console.error('API Versioning marker not found'); process.exit(1); }

// The blank line before the API Versioning comment
let endIdx = apiVersionIdx - 1;
while (endIdx > startIdx && lines[endIdx].trim() === '') endIdx--;

console.log(`Block: lines ${startIdx + 1}–${endIdx + 1} (${endIdx - startIdx + 1} lines)`);
console.log(`First: ${lines[startIdx]?.substring(0, 70)}`);
console.log(`Last:  ${lines[endIdx]?.substring(0, 70)}`);

// All distModule-derived consts need wrapper closures since mount call is BEFORE distModule is built
const mountCall = [
  'app.use(registerLinkedInRoutes({',
  '  requireAuth, pool, encryptIntegrationSecret, computeIsoFromTtlSeconds,',
  '  getLinkedInOrganizationScopeError, upsertUserIntegration,',
  '  getPublishableSocialConnection: (...a) => getPublishableSocialConnection(...a),',
  '  refreshLinkedInAccessToken: (...a) => refreshLinkedInAccessToken(...a),',
  '  listLinkedInAdminOrganizations: (...a) => listLinkedInAdminOrganizations(...a),',
  '  fetchLinkedInOrganizationNetworkSize: (...a) => fetchLinkedInOrganizationNetworkSize(...a),',
  '  fetchLinkedInSocialMetadataBatch: (...a) => fetchLinkedInSocialMetadataBatch(...a),',
  '  fetchLinkedInShareStatisticsForPosts: (...a) => fetchLinkedInShareStatisticsForPosts(...a),',
  '  sumLinkedInReactionCounts: (m) => sumLinkedInReactionCounts(m),',
  '  getClientIp, checkLinkMetadataRateLimit, fetchLinkMetadata,',
  '}));',
  '',
];

lines.splice(startIdx, endIdx - startIdx + 1, ...mountCall);
writeFileSync(serverPath, lines.join('\n'), 'utf8');
const removed = orig - lines.length;
console.log(`Done: ${orig} → ${lines.length} lines (net removed ${removed})`);
