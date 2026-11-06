import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, '..');
const webDistDir = resolve(rootDir, 'packages', 'web', 'dist');
const apiPublicDir = resolve(rootDir, 'packages', 'api', '.railway-build', 'public');

if (!existsSync(webDistDir)) {
  console.log('[copy-web-dist] Skipping: packages/web/dist not found.');
  process.exit(0);
}

// Clean old public dir so removed assets don’t linger.
if (existsSync(apiPublicDir)) {
  rmSync(apiPublicDir, { recursive: true, force: true });
}
mkdirSync(apiPublicDir, { recursive: true });
cpSync(webDistDir, apiPublicDir, { recursive: true });

console.log('[copy-web-dist] Copied packages/web/dist -> packages/api/.railway-build/public');
