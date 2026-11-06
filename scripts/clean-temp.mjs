import { readdirSync, unlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';

function removeFile(path) {
  try {
    unlinkSync(path);
    console.log('Removed', path);
  } catch (err) {
    // ignore
  }
}

// Clean root tmp_*.tsx files
for (const file of readdirSync(process.cwd())) {
  if (/^tmp_.*\.tsx?$/.test(file)) {
    removeFile(join(process.cwd(), file));
  }
}

// Clean any tmp_*.tsx inside packages/web/src/pages (if present)
const pagesDir = join(process.cwd(), 'packages', 'web', 'src', 'pages');
try {
  for (const file of readdirSync(pagesDir)) {
    if (/^tmp_.*\.tsx?$/.test(file)) {
      removeFile(join(pagesDir, file));
    }
  }
} catch (err) {
  // ignore if src/pages doesn't exist
}
