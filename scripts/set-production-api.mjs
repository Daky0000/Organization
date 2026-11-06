/**
 * Usage: node scripts/set-production-api.mjs https://your-app.onrender.com
 *
 * Updates .env with the production API URL, rebuilds the frontend,
 * and commits + pushes to GitHub Pages.
 */

import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

const url = process.argv[2];
if (!url || !url.startsWith('https://')) {
  console.error('Usage: node scripts/set-production-api.mjs https://your-app.onrender.com');
  process.exit(1);
}

// 1. Update .env
const envPath = new URL('../.env', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
let env = readFileSync(envPath, 'utf8');
env = env.replace(/^VITE_API_BASE_URL=.*/m, `VITE_API_BASE_URL=${url}`);
writeFileSync(envPath, env, 'utf8');
console.log(`✓ Updated .env: VITE_API_BASE_URL=${url}`);

// 2. Rebuild
console.log('Building frontend...');
execSync('npm run build', { stdio: 'inherit' });

// 3. Stage built files
execSync('git add assets/ dist/ index.html 404.html', { stdio: 'inherit' });

// 4. Commit & push
const msg = `Point frontend to production backend (${url})`;
execSync(`git commit -m "${msg}\n\nCo-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"`, { stdio: 'inherit' });
execSync('git push origin master', { stdio: 'inherit' });

console.log('\n✅ Done! Your site at marketing.dakyx.com now points to the production backend.');
