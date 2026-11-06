import { cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const rootDir = resolve(process.cwd());
const webDir = resolve(rootDir, 'packages', 'web');
const sourceIndex = resolve(webDir, 'index.source.html');
const webIndex = resolve(webDir, 'index.html');
const web404 = resolve(webDir, '404.html');

if (!existsSync(sourceIndex)) {
  throw new Error('packages/web/index.source.html not found. Cannot prepare Vite entry HTML.');
}

cpSync(sourceIndex, webIndex);
cpSync(sourceIndex, web404);

console.log('Prepared source index files for Vite.');
