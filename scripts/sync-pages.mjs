import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';

const rootDir = resolve(process.cwd());
const buildDir = resolve(rootDir, 'packages', 'web', 'dist');
const buildIndex = resolve(buildDir, 'index.html');
const buildAssets = resolve(buildDir, 'assets');
const buildNoJekyll = resolve(buildDir, '.nojekyll');
const docsDir = resolve(rootDir, 'docs');
const rootCname = resolve(rootDir, 'CNAME');

console.log('Starting post-build sync process for GitHub Pages (from packages/web)...');

if (!existsSync(buildIndex)) {
  throw new Error('dist/index.html not found. Run the Vite build before syncing.');
}

if (!existsSync(buildAssets)) {
  throw new Error('dist/assets not found. Run the Vite build before syncing.');
}

// index.html is the SPA entry — also serve it as 404.html so GitHub Pages
// routes all unknown paths back to the React app (client-side routing).
const builtHtml = readFileSync(buildIndex, 'utf8');
writeFileSync(resolve(buildDir, '404.html'), builtHtml, 'utf8');
writeFileSync(buildNoJekyll, '', 'utf8');

if (existsSync(rootCname)) {
  cpSync(rootCname, resolve(buildDir, 'CNAME'));
}

console.log('Built GitHub Pages files in dist directory. Entry files retain hash-based names for cache busting.');

const mirrorStaticSite = (targetDir, label) => {
  const targetAssets = resolve(targetDir, 'assets');

  // Remove old assets entirely so stale chunk files don't linger
  if (existsSync(targetAssets)) {
    rmSync(targetAssets, { recursive: true, force: true });
  }

  mkdirSync(targetAssets, { recursive: true });
  cpSync(buildAssets, targetAssets, { recursive: true });

  // Copy brand and fonts directories plus root favicons
  for (const subDir of ['brand', 'fonts']) {
    const srcSub = resolve(buildDir, subDir);
    if (existsSync(srcSub)) {
      const dstSub = resolve(targetDir, subDir);
      mkdirSync(dstSub, { recursive: true });
      cpSync(srcSub, dstSub, { recursive: true });
    }
  }
  for (const rootAsset of ['favicon.svg', 'favicon.ico', 'favicon.png', 'apple-touch-icon.png', 'vite.svg']) {
    const srcAsset = resolve(buildDir, rootAsset);
    if (existsSync(srcAsset)) {
      cpSync(srcAsset, resolve(targetDir, rootAsset));
    }
  }

  // Write index.html and 404.html (404 = SPA fallback for client-side routes)
  writeFileSync(resolve(targetDir, 'index.html'), builtHtml, 'utf8');
  writeFileSync(resolve(targetDir, '404.html'), builtHtml, 'utf8');
  writeFileSync(resolve(targetDir, '.nojekyll'), '', 'utf8');

  if (existsSync(rootCname) && resolve(targetDir, 'CNAME') !== rootCname) {
    cpSync(rootCname, resolve(targetDir, 'CNAME'));
  }

  console.log(`Mirrored GitHub Pages files to ${label}.`);
};

mirrorStaticSite(docsDir, "'docs' directory");
mirrorStaticSite(rootDir, 'repository root');
