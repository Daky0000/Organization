import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const files = [
  '../packages/api/backend/src/routes/analytics.routes.ts',
  '../packages/api/backend/src/routes/automation.routes.ts',
  '../packages/api/backend/src/routes/integrations.routes.ts',
  '../packages/api/backend/src/routes/posts.routes.ts',
  '../packages/api/backend/src/services/account-metrics.service.ts',
  '../packages/api/backend/src/services/analytics-sync.service.ts',
  '../packages/api/backend/src/services/analytics.service.ts',
  '../packages/api/backend/src/services/auth.service.ts',
  '../packages/api/backend/src/services/automation/post-automation.service.ts',
  '../packages/api/backend/src/services/automation/queue.ts',
  '../packages/api/backend/src/services/automation/scheduler.ts',
  '../packages/api/backend/src/services/integration.service.ts',
  '../packages/api/backend/src/services/post.service.ts',
  '../packages/api/backend/src/utils/integration-log.ts',
  '../packages/api/backend/src/utils/seed-default-users.ts',
].map(f => path.resolve(__dirname, f));

const singletonAbs = path.resolve(__dirname, '../packages/api/backend/src/utils/prisma.ts');

for (const filePath of files) {
  let content = fs.readFileSync(filePath, 'utf-8');

  // Compute relative import path
  const fileDir = path.dirname(filePath);
  let relPath = path.relative(fileDir, singletonAbs)
    .split(path.sep).join('/')
    .replace(/\.ts$/, '');
  if (!relPath.startsWith('.')) relPath = './' + relPath;

  const before = content;

  // Strip `import { PrismaClient, ...extras } from "@prisma/client";`
  content = content.replace(
    /import \{([^}]+)\} from "@prisma\/client";\n/g,
    (match, names) => {
      const kept = names
        .split(',')
        .map(n => n.trim())
        .filter(n => n && n !== 'PrismaClient');
      return kept.length > 0
        ? `import { ${kept.join(', ')} } from "@prisma/client";\n`
        : '';
    }
  );

  // Strip `const prisma = new PrismaClient();\n`
  content = content.replace(/const prisma = new PrismaClient\(\);\n/g, '');

  // Inject singleton import after the last import line at the top
  const singletonImport = `import { prisma } from "${relPath}";\n`;
  // Find position after the first contiguous block of imports
  const importBlockEnd = content.search(/^(?!import )/m);
  if (importBlockEnd !== -1) {
    content = content.slice(0, importBlockEnd) + singletonImport + content.slice(importBlockEnd);
  }

  if (content !== before) {
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log('Updated:', path.basename(filePath), '  import:', relPath);
  } else {
    console.log('No change:', path.basename(filePath));
  }
}
