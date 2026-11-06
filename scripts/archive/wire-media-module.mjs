// Wire mediaRoutes.ts into server.ts — replace the inline media section with module mount
import { readFileSync, writeFileSync } from 'fs';

const serverPath = 'd:/Saas/packages/api/src/server.ts';
const lines = readFileSync(serverPath, 'utf8').split('\n');

// Find the media section start
let mediaStart = -1, mediaEnd = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('// ─── Media Library')) { mediaStart = i; }
  if (mediaStart > 0 && lines[i].includes('// ── DB Audit') && i > mediaStart) { mediaEnd = i - 1; break; }
}

if (mediaStart < 0 || mediaEnd < 0) {
  console.error('Could not find media section boundaries');
  process.exit(1);
}

console.log(`Media section: lines ${mediaStart + 1}–${mediaEnd + 1} (${mediaEnd - mediaStart + 1} lines)`);

// Find trailing blank lines in the section
while (mediaEnd > mediaStart && lines[mediaEnd].trim() === '') mediaEnd--;

const mountBlock = [
  '// ─── Media Library ─────────────────────────────────────────────────────────────',
  'const mediaModule = buildMediaModule({ requireAuth, requireAdmin, hasDatabase, pool });',
  'app.use(\'/\', mediaModule.router);',
  'syncProfileMedia = mediaModule.syncProfileMedia;',
  'syncCardTemplateMedia = mediaModule.syncCardTemplateMedia;',
  'syncUserDesignMedia = mediaModule.syncUserDesignMedia;',
  'const syncBlogPostMedia = mediaModule.syncBlogPostMedia;',
];

const before = lines.slice(0, mediaStart);
const after = lines.slice(mediaEnd + 1);
const result = [...before, ...mountBlock, '', ...after].join('\n');

writeFileSync(serverPath, result, 'utf8');
const finalLines = result.split('\n').length;
console.log(`server.ts: ${lines.length} → ${finalLines} lines (removed ${lines.length - finalLines})`);
