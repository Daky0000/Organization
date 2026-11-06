// Extract LinkedIn scope + notification/task helpers from server.ts
import { readFileSync, writeFileSync } from 'fs';

const serverPath = 'd:/Saas/packages/api/src/server.ts';
const outPath = 'd:/Saas/packages/api/src/social-helpers.ts';

const lines = readFileSync(serverPath, 'utf8').split('\n');
const orig = lines.length;

// Block 1: LinkedIn scope helpers
// Start: "// ── LinkedIn scope helpers"
const liStart = lines.findIndex(l => l.includes('// ── LinkedIn scope helpers'));
if (liStart < 0) { console.error('LinkedIn start not found'); process.exit(1); }

// Block 2: Notification helpers end at "getUserSaaSContext" boundary
// The notification block: from "// ── Notification & task helpers" to the blank line before "async function getUserSaaSContext"
const notifStart = lines.findIndex(l => l.includes('// ── Notification & task helpers'));
if (notifStart < 0) { console.error('Notification start not found'); process.exit(1); }

// Notification block ends just before getUserSaaSContext (which uses OAUTH_AUTH_URLS via bundle scope so stays in server.ts)
const getUserSaaSIdx = lines.findIndex(l => l.startsWith('async function getUserSaaSContext('));
if (getUserSaaSIdx < 0) { console.error('getUserSaaSContext not found'); process.exit(1); }

let blockEnd = getUserSaaSIdx - 1;
while (blockEnd > notifStart && lines[blockEnd].trim() === '') blockEnd--;

console.log(`Block: lines ${liStart + 1}–${blockEnd + 1} (${blockEnd - liStart + 1} lines)`);
console.log(`  First: ${lines[liStart]?.substring(0, 60)}`);
console.log(`  Last:  ${lines[blockEnd]?.substring(0, 60)}`);

// ── Build social-helpers.ts ──────────────────────────────────────────────────

const header = [
  `import { config } from './config.ts';`,
  `import { logger } from './logger.ts';`,
  `import { pool, dbQuery, hasDatabase } from './db.ts';`,
  ``,
];

const bodyLines = lines.slice(liStart, blockEnd + 1);

const exportNames = [
  'LINKEDIN_DEFAULT_OAUTH_SCOPES', 'LINKEDIN_ORG_ADMIN_SCOPE_OPTIONS',
  'getLinkedInOAuthScopeString', 'parseLinkedInScopeList',
  'getLinkedInScopeSet', 'hasAnyLinkedInScope', 'hasAllLinkedInScopes',
  'getLinkedInOrganizationScopeError', 'shouldEnableLinkedInExtendedLogin',
  'computeIsoFromTtlSeconds',
  'createNotification', 'logTaskActivity', 'checkTaskActions',
];

const exportedBody = bodyLines.map(l => {
  for (const name of exportNames) {
    if (l.match(new RegExp(`^(const|function|async function|let)\\s+${name}\\b`))) {
      return 'export ' + l;
    }
  }
  return l;
});

const content = [...header, ...exportedBody, ''].join('\n');
writeFileSync(outPath, content, 'utf8');
console.log(`\nWrote ${outPath} (${content.split('\n').length} lines)`);

// ── Remove block from server.ts + add import ─────────────────────────────────

lines.splice(liStart, blockEnd - liStart + 1);
console.log(`Removed block (${blockEnd - liStart + 1} lines) from server.ts`);

// Add import after integration-helpers import
const integrationImportIdx = lines.findIndex(l => l.includes(`from './integration-helpers.ts'`));
if (integrationImportIdx < 0) { console.error('integration-helpers import not found'); process.exit(1); }

const socialImport = [
  `import {`,
  `  LINKEDIN_DEFAULT_OAUTH_SCOPES, LINKEDIN_ORG_ADMIN_SCOPE_OPTIONS,`,
  `  getLinkedInOAuthScopeString, parseLinkedInScopeList,`,
  `  getLinkedInScopeSet, hasAnyLinkedInScope, hasAllLinkedInScopes,`,
  `  getLinkedInOrganizationScopeError, shouldEnableLinkedInExtendedLogin,`,
  `  computeIsoFromTtlSeconds,`,
  `  createNotification, logTaskActivity, checkTaskActions,`,
  `} from './social-helpers.ts';`,
].join('\n');

lines.splice(integrationImportIdx + 1, 0, socialImport);

writeFileSync(serverPath, lines.join('\n'), 'utf8');
const newLen = lines.length;
console.log(`\nDone: ${orig} → ${newLen} lines (net removed ${orig - newLen})`);
