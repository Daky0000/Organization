// Wire card templates, pricing plans, and WordPress routes into server.ts
import { readFileSync, writeFileSync } from 'fs';

const serverPath = 'd:/Saas/packages/api/src/server.ts';
let lines = readFileSync(serverPath, 'utf8').split('\n');
const originalCount = lines.length;

// Find first line (0-based) matching predicate, starting from `from`
function findLine(arr, pred, from = 0) {
  for (let i = from; i < arr.length; i++) if (pred(arr[i])) return i;
  return -1;
}

// Replace lines[start..nextSectionStart-1] with `replacement` lines.
// nextSectionPred matches the FIRST LINE of the next section (preserved).
function splice(arr, startPred, nextSectionPred, replacement) {
  const start = findLine(arr, startPred);
  if (start < 0) { console.error('Start anchor not found for', startPred.toString()); process.exit(1); }
  const nextStart = findLine(arr, nextSectionPred, start + 1);
  if (nextStart < 0) { console.error('End anchor not found for', nextSectionPred.toString()); process.exit(1); }
  // end = last line of current section (exclusive of nextStart)
  let end = nextStart - 1;
  while (end > start && arr[end].trim() === '') end--;
  console.log(`  Splice lines ${start + 1}–${end + 1} (${end - start + 1} lines)`);
  return [...arr.slice(0, start), ...replacement, '', ...arr.slice(end + 1)];
  // arr.slice(end + 1) = blank lines + nextStart line onwards
}

// 1. Replace WordPress inline routes
console.log('Splicing WordPress routes...');
lines = splice(
  lines,
  l => l.includes("app.post('/api/wordpress/connect'"),
  l => l.includes("app.get('/api/pricing/plans'"),
  [
    '// ─── WordPress Routes ────────────────────────────────────────────────────────',
    'app.use(\'/api\', registerWordPressRoutes({',
    '  requireAuth, hasDatabase, dbQuery, pool,',
    '  encryptWordPressPassword, decryptWordPressPassword, getWordPressConnection, wpRequest,',
    '  upsertUserIntegration, logIntegrationEvent, ensureWordPressSocialAccount,',
    '}));',
  ]
);

// 2. Replace pricing plans
console.log('Splicing pricing routes...');
lines = splice(
  lines,
  l => l.includes("app.get('/api/pricing/plans'"),
  l => l.includes("app.get('/api/card-templates'"),
  [
    '// ─── Pricing Routes ──────────────────────────────────────────────────────────',
    'app.use(\'/api\', registerPricingRoutes({ requireAdmin, hasDatabase, dbQuery, stripe, inMemoryPricingPlansById }));',
  ]
);

// 3. Replace card templates
console.log('Splicing card template routes...');
lines = splice(
  lines,
  l => l.includes("app.get('/api/card-templates'"),
  l => l.includes('registerCreditsRoutes'),
  [
    '// ─── Card Template Routes ────────────────────────────────────────────────────',
    'app.use(\'/api\', registerCardTemplateRoutes({',
    '  requireAuth, requireAdmin, hasDatabase, dbQuery, pool,',
    '  inMemoryCardTemplatesById,',
    '  syncCardTemplateMedia: syncCardTemplateMediaFn,',
    '}));',
  ]
);

const finalContent = lines.join('\n');
writeFileSync(serverPath, finalContent, 'utf8');
const finalCount = lines.length;
console.log(`server.ts: ${originalCount} → ${finalCount} lines (removed ${originalCount - finalCount})`);
