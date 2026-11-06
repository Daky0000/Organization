// Extract ensureDatabase body into src/db-migrations.ts
import { readFileSync, writeFileSync } from 'fs';

const serverPath = 'd:/Saas/packages/api/src/server.ts';
const migrationsPath = 'd:/Saas/packages/api/src/db-migrations.ts';

const lines = readFileSync(serverPath, 'utf8').split('\n');
const orig = lines.length;

// Find the start of ensureDatabase function
const fnStartIdx = lines.findIndex(l => l.startsWith('async function ensureDatabase()'));
if (fnStartIdx < 0) { console.error('ensureDatabase not found'); process.exit(1); }
console.log(`ensureDatabase starts at line ${fnStartIdx + 1}: ${lines[fnStartIdx]?.substring(0, 70)}`);

// Find the closing brace of ensureDatabase
// The function body ends at the first top-level "}" after fnStartIdx
// We need to track brace depth
let braceDepth = 0;
let fnEndIdx = -1;
for (let i = fnStartIdx; i < lines.length; i++) {
  const line = lines[i];
  for (const ch of line) {
    if (ch === '{') braceDepth++;
    else if (ch === '}') {
      braceDepth--;
      if (braceDepth === 0) {
        fnEndIdx = i;
        break;
      }
    }
  }
  if (fnEndIdx >= 0) break;
}
if (fnEndIdx < 0) { console.error('Could not find end of ensureDatabase'); process.exit(1); }
console.log(`ensureDatabase ends at line ${fnEndIdx + 1}: ${lines[fnEndIdx]?.substring(0, 70)}`);
console.log(`Function body: ${fnEndIdx - fnStartIdx + 1} lines`);

// The body to extract is lines fnStartIdx+1 through fnEndIdx-1 (exclusive of opening/closing braces)
// BUT: lines fnStartIdx+1 to fnStartIdx+10 handle the no-pool case — we keep those in server.ts
// The "no pool" block ends at line: "    return;\n  }" ... let's find the first "}" that closes the if(!pool) block
// Lines in no-pool block:
//   fnStartIdx+0: async function ensureDatabase() {
//   fnStartIdx+1:   if (!pool) {
//   fnStartIdx+2:     if (config.nodeEnv === 'production') {
//   fnStartIdx+3:       logger.fatal(...)
//   fnStartIdx+4:       process.exit(1);
//   fnStartIdx+5:     }
//   fnStartIdx+6:     logger.warn(...)
//   fnStartIdx+7:     dbReady = false;
//   fnStartIdx+8:     seedInMemoryUsers();
//   fnStartIdx+9:     return;
//   fnStartIdx+10:  }

// Find end of no-pool block (the "  }" after "return;")
let noPoolEndIdx = -1;
for (let i = fnStartIdx + 1; i < fnStartIdx + 20; i++) {
  if (lines[i]?.match(/^\s+\}\s*$/) && noPoolEndIdx < 0) {
    // check that there's a "return;" or "seedInMemoryUsers" nearby before this
    const prevLine = lines[i - 1]?.trim();
    if (prevLine === 'return;') {
      noPoolEndIdx = i;
      break;
    }
  }
}
if (noPoolEndIdx < 0) { console.error('Could not find end of no-pool block'); process.exit(1); }
console.log(`No-pool block ends at line ${noPoolEndIdx + 1}: ${lines[noPoolEndIdx]?.substring(0, 70)}`);

// The migration body starts at noPoolEndIdx+1 (first blank line after the no-pool block)
// and ends at fnEndIdx-1 (line before the closing "}")
// But we need to skip the final "  dbReady = true;" line
let migrationsBodyStart = noPoolEndIdx + 1;
// Skip blank line(s)
while (lines[migrationsBodyStart]?.trim() === '') migrationsBodyStart++;

// Body ends at fnEndIdx - 1 (before "}")
// The last real statement should be:  dbReady = true;
// We want to end just before "  dbReady = true;"
let migrationsBodyEnd = fnEndIdx - 1;
while (migrationsBodyEnd > migrationsBodyStart && lines[migrationsBodyEnd]?.trim() === '') migrationsBodyEnd--;
if (lines[migrationsBodyEnd]?.trim() === 'dbReady = true;') {
  migrationsBodyEnd--;
  while (migrationsBodyEnd > migrationsBodyStart && lines[migrationsBodyEnd]?.trim() === '') migrationsBodyEnd--;
}

console.log(`Migrations body: lines ${migrationsBodyStart + 1}–${migrationsBodyEnd + 1} (${migrationsBodyEnd - migrationsBodyStart + 1} lines)`);
console.log(`  First: ${lines[migrationsBodyStart]?.substring(0, 70)}`);
console.log(`  Last:  ${lines[migrationsBodyEnd]?.substring(0, 70)}`);

// Build db-migrations.ts content
const bodyLines = lines.slice(migrationsBodyStart, migrationsBodyEnd + 1);
// De-indent by 2 spaces (from inside ensureDatabase body)
const dedented = bodyLines.map(l => l.startsWith('  ') ? l.slice(2) : l);

const migrationsFile = [
  `import type { Pool } from 'pg';`,
  `import { logger } from './logger.ts';`,
  ``,
  `export async function runDatabaseMigrations(pool: Pool): Promise<void> {`,
  ...dedented,
  `}`,
  ``,
].join('\n');

writeFileSync(migrationsPath, migrationsFile, 'utf8');
console.log(`\nWrote ${migrationsPath} (${migrationsFile.split('\n').length} lines)`);

// Now replace the body of ensureDatabase in server.ts
// Keep: lines fnStartIdx through noPoolEndIdx (the no-pool guard)
// Replace the rest (noPoolEndIdx+1 through fnEndIdx-1) with:
//   await runDatabaseMigrations(pool);
//   dbReady = true;
// Then keep fnEndIdx (the closing "}")

const newBody = [
  `  await runDatabaseMigrations(pool);`,
  `  dbReady = true;`,
];

// Remove lines from noPoolEndIdx+1 to fnEndIdx-1, insert newBody
const removeStart = noPoolEndIdx + 1;
const removeEnd = fnEndIdx - 1;
console.log(`Removing lines ${removeStart + 1}–${removeEnd + 1} from server.ts`);
lines.splice(removeStart, removeEnd - removeStart + 1, '', ...newBody, '');

// Add import at top of server.ts (after existing imports)
const importLine = `import { runDatabaseMigrations } from './db-migrations.ts';`;
// Find last import line
let lastImportIdx = 0;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].startsWith('import ') || lines[i].startsWith('} from ')) {
    lastImportIdx = i;
  }
  if (lines[i].trim() === '' && lastImportIdx > 0 && i > lastImportIdx) break;
}
console.log(`Inserting import after line ${lastImportIdx + 1}`);
lines.splice(lastImportIdx + 1, 0, importLine);

writeFileSync(serverPath, lines.join('\n'), 'utf8');
const newLen = lines.length;
console.log(`\nDone: ${orig} → ${newLen} lines (net removed ${orig - newLen})`);
