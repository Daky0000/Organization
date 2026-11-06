// Extract integration + WordPress helpers from server.ts into src/integration-helpers.ts
import { readFileSync, writeFileSync } from 'fs';

const serverPath = 'd:/Saas/packages/api/src/server.ts';
const outPath = 'd:/Saas/packages/api/src/integration-helpers.ts';

const lines = readFileSync(serverPath, 'utf8').split('\n');
const orig = lines.length;

// ── Find block boundaries ────────────────────────────────────────────────────

// Start: "// --- Integrations: encryption + logs ---"
const startIdx = lines.findIndex(l => l.includes('// --- Integrations: encryption + logs ---'));
if (startIdx < 0) { console.error('Start not found'); process.exit(1); }

// End: just before "// ─── WordPress Routes" comment
const wpRoutesIdx = lines.findIndex(l => l.includes('// ─── WordPress Routes'));
if (wpRoutesIdx < 0) { console.error('WordPress Routes marker not found'); process.exit(1); }

let endIdx = wpRoutesIdx - 1;
while (endIdx > startIdx && lines[endIdx].trim() === '') endIdx--;

console.log(`Block: lines ${startIdx + 1}–${endIdx + 1} (${endIdx - startIdx + 1} lines)`);
console.log(`  First: ${lines[startIdx]?.substring(0, 70)}`);
console.log(`  Last:  ${lines[endIdx]?.substring(0, 70)}`);

// ── Build integration-helpers.ts ─────────────────────────────────────────────

const header = [
  `import { randomBytes, createCipheriv, createDecipheriv, scryptSync, randomUUID } from 'crypto';`,
  `import axios from 'axios';`,
  `import { config } from './config.ts';`,
  `import { logger } from './logger.ts';`,
  `import { pool, dbQuery } from './db.ts';`,
  ``,
  `const INTEGRATIONS_ENCRYPTION_KEY = scryptSync(config.integrationsEncryptionKey, 'integrations', 32);`,
  `const WORDPRESS_ENCRYPTION_KEY = scryptSync(config.wordpressEncryptionKey, 'wordpress', 32);`,
  ``,
];

const bodyLines = lines.slice(startIdx, endIdx + 1);

// Remove the section comment since header is cleaner
// Add export to exported functions/interfaces
const exportNames = [
  'encryptIntegrationSecret', 'decryptIntegrationSecret', 'getIntegrationRowBySlug',
  'logIntegrationEvent', 'upsertUserIntegration',
  'WordPressConnection',
  'encryptWordPressPassword', 'decryptWordPressPassword', 'normalizeWordPressSiteUrl',
  'getWordPressConnection', 'getMakeWebhookConnection',
  'ensureWordPressSocialAccount', 'removeWordPressSocialAccount', 'isValidWebhookUrl', 'wpRequest',
];

const exportedBody = bodyLines.map(l => {
  for (const name of exportNames) {
    if (l.match(new RegExp(`^(function|async function|interface|const|type)\\s+${name}\\b`))) {
      return 'export ' + l;
    }
  }
  return l;
});

const content = [
  ...header,
  ...exportedBody,
  '',
].join('\n');

writeFileSync(outPath, content, 'utf8');
console.log(`\nWrote ${outPath} (${content.split('\n').length} lines)`);

// ── Remove block from server.ts + add import ─────────────────────────────────

lines.splice(startIdx, endIdx - startIdx + 1);
console.log(`Removed block (${endIdx - startIdx + 1} lines) from server.ts`);

// Add import after user-auth.ts import
const userAuthImportIdx = lines.findIndex(l => l.includes(`from './user-auth.ts'`));
if (userAuthImportIdx < 0) { console.error('user-auth import not found'); process.exit(1); }

const integrationImport = [
  `import {`,
  `  encryptIntegrationSecret, decryptIntegrationSecret, getIntegrationRowBySlug,`,
  `  logIntegrationEvent, upsertUserIntegration,`,
  `  encryptWordPressPassword, decryptWordPressPassword, normalizeWordPressSiteUrl,`,
  `  getWordPressConnection, getMakeWebhookConnection,`,
  `  ensureWordPressSocialAccount, removeWordPressSocialAccount, isValidWebhookUrl, wpRequest,`,
  `} from './integration-helpers.ts';`,
].join('\n');

lines.splice(userAuthImportIdx + 1, 0, integrationImport);

// Remove INTEGRATIONS_ENCRYPTION_KEY and WORDPRESS_ENCRYPTION_KEY from server.ts
// (they're now computed in integration-helpers.ts)
const intKeyIdx = lines.findIndex(l => l.startsWith('const INTEGRATIONS_ENCRYPTION_KEY'));
if (intKeyIdx >= 0) {
  // Remove the IIFE block: "const INTEGRATIONS_ENCRYPTION_KEY = (() => {" ... "})();"
  let iifEnd = intKeyIdx;
  for (let i = intKeyIdx; i < intKeyIdx + 5; i++) {
    if (lines[i]?.includes('})();')) { iifEnd = i; break; }
  }
  lines.splice(intKeyIdx, iifEnd - intKeyIdx + 1);
  console.log(`Removed INTEGRATIONS_ENCRYPTION_KEY block`);
}

const wpKeyIdx = lines.findIndex(l => l.startsWith('const WORDPRESS_ENCRYPTION_KEY'));
if (wpKeyIdx >= 0) {
  let iifEnd = wpKeyIdx;
  for (let i = wpKeyIdx; i < wpKeyIdx + 5; i++) {
    if (lines[i]?.includes('})();')) { iifEnd = i; break; }
  }
  lines.splice(wpKeyIdx, iifEnd - wpKeyIdx + 1);
  console.log(`Removed WORDPRESS_ENCRYPTION_KEY block`);
}

writeFileSync(serverPath, lines.join('\n'), 'utf8');
const newLen = lines.length;
console.log(`\nDone: ${orig} → ${newLen} lines (net removed ${orig - newLen})`);
