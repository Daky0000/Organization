// Remove social connect routes + private helpers from server.ts and insert mount call
import { readFileSync, writeFileSync } from 'fs';

const serverPath = 'd:/Saas/packages/api/src/server.ts';
const lines = readFileSync(serverPath, 'utf8').split('\n');
const orig = lines.length;

// ── Block 1: Routes (4987-5566 → "oauth/state" ... "analytics/:platform" + helpers) ──
// Start: the comment before the oauth/state route
const b1Start = lines.findIndex(l => l.includes('// OAuth state registration (for CSRF protection)'));
if (b1Start < 0) { console.error('Block 1 start not found'); process.exit(1); }

// End: line "// OAuth Exchange Functions" comment (exclusive — we keep what comes after)
// Actually: the comment "// OAuth Exchange Functions" starts the helpers block.
// We want to cut everything from b1Start through the last private helper before createNotification.
// That is: everything from b1Start up to (not including) "// ─── Integration helpers"
// which is at line ~7091 in original.
// We can find it: "// ── Integration helpers" (after Hubtel routes at line 7090)

// Actually we need to cut multiple non-contiguous sections. Let's do it carefully:
// Section A: routes + helpers block starts at b1Start
// We cut up to and including resolveBackendRedirectUri (6822)
// Then keep 6824-7069 (shared helpers: createNotification etc. + wordpress helpers)
// Then cut from 7093 (META_GRAPH_BASE) through 7275 (end of listInstagramPageTargets)
// Then keep 7277+ (OAUTH_AUTH_URLS etc.)

// Find section boundaries:

// End of "resolveBackendRedirectUri" block (line ~6823):
// Search for "// --- Integrations: encryption + logs ---" which follows resolveBackendRedirectUri
const integrationsCommentIdx = lines.findIndex(l => l.includes('// --- Integrations: encryption + logs ---'));
if (integrationsCommentIdx < 0) { console.error('Integrations comment not found'); process.exit(1); }
const b1End = integrationsCommentIdx - 1; // line before the comment (blank line)

console.log(`Block 1: lines ${b1Start + 1}–${b1End + 1} (${b1End - b1Start + 1} lines)`);
console.log(`  First: ${lines[b1Start]?.substring(0, 70)}`);
console.log(`  Last:  ${lines[b1End]?.substring(0, 70)}`);

// Block 2: Meta Instagram helpers + listInstagramPageTargets
// Start: "// ─── Hubtel Payment Routes" line (we keep) ... then the "// ── Integration helpers" comment,
// then META_GRAPH_BASE
// We want to cut from META_GRAPH_BASE through end of listInstagramPageTargets function.

// Find "const META_GRAPH_BASE = 'https://graph.facebook.com/v19.0';" after b1End
const metaGraphIdx = lines.findIndex((l, i) => i > b1End && l.startsWith("const META_GRAPH_BASE = 'https://graph.facebook.com/v19.0'"));
if (metaGraphIdx < 0) { console.error('META_GRAPH_BASE not found'); process.exit(1); }

// Find the line just before "const OAUTH_AUTH_URLS"
const oauthAuthUrlsIdx = lines.findIndex((l, i) => i > metaGraphIdx && l.startsWith('const OAUTH_AUTH_URLS'));
if (oauthAuthUrlsIdx < 0) { console.error('OAUTH_AUTH_URLS not found'); process.exit(1); }

const b2Start = metaGraphIdx;
let b2End = oauthAuthUrlsIdx - 1;
// Skip blank lines before OAUTH_AUTH_URLS
while (b2End > b2Start && lines[b2End].trim() === '') b2End--;

console.log(`Block 2: lines ${b2Start + 1}–${b2End + 1} (${b2End - b2Start + 1} lines)`);
console.log(`  First: ${lines[b2Start]?.substring(0, 70)}`);
console.log(`  Last:  ${lines[b2End]?.substring(0, 70)}`);

// Also find and remove the dead function getStoredState (defined but never called)
const getStoredStateIdx = lines.findIndex((l, i) => i > b1End && i < b2Start && l.startsWith('async function getStoredState('));
if (getStoredStateIdx >= 0) {
  // Find the end of getStoredState (closing })
  let gsEnd = getStoredStateIdx;
  for (let i = getStoredStateIdx + 1; i < b2Start; i++) {
    if (lines[i] === '}' || lines[i] === '};') { gsEnd = i; break; }
  }
  console.log(`getStoredState (dead): lines ${getStoredStateIdx + 1}–${gsEnd + 1}`);
  // We'll fold this into block 1 end if possible, or mark separately
}

// Build mount call
const mountCall = [
  'app.use(\'/api\', registerSocialConnectRoutes({',
  '  requireAuth, hasDatabase, pool, dbQuery,',
  '  getPublishableSocialConnection: (...a) => getPublishableSocialConnection(...a),',
  '  normalizePlatformId: (...a) => normalizePlatformId(...a),',
  '  getPlatformConfig,',
  '  resolveOAuthRedirectUri,',
  '  getLinkedInOAuthScopeString,',
  '  shouldEnableLinkedInExtendedLogin,',
  '  parseLinkedInScopeList,',
  '  computeIsoFromTtlSeconds,',
  '  encryptIntegrationSecret,',
  '  upsertUserIntegration,',
  '  logIntegrationEvent,',
  '  getUserConnectedAccounts,',
  '  createNotification,',
  '  checkTaskActions,',
  '  getAIConfig, resolveActiveKey, GEMINI_MODELS, callAINonStreaming,',
  '  publishToplatform: (...a) => publishToplatform(...a),',
  '}));',
  '',
];

// Remove blocks in reverse order (block 2 first, then block 1)
lines.splice(b2Start, b2End - b2Start + 1);
console.log(`After removing block 2: ${lines.length} lines`);

// Block 1 boundaries are still valid (b2 is after b1)
lines.splice(b1Start, b1End - b1Start + 1, ...mountCall);
console.log(`After removing block 1 + inserting mount call: ${lines.length} lines`);

writeFileSync(serverPath, lines.join('\n'), 'utf8');
const removed = orig - lines.length;
console.log(`Done: ${orig} → ${lines.length} lines (net removed ${removed})`);
