// Wire server.ts to import pool/dbQuery/dbReady/hasDatabase from db.ts
import { readFileSync, writeFileSync } from 'fs';

const serverPath = 'd:/Saas/packages/api/src/server.ts';
let src = readFileSync(serverPath, 'utf8');
const origLen = src.split('\n').length;

// 1. Add db.ts import after the db-migrations import
const dbMigrImport = `import { runDatabaseMigrations } from './db-migrations.ts';`;
const dbImport = `import { pool, dbReady, setDbReady, hasDatabase, dbQuery, normalizeEmail, normalizeUsername } from './db.ts';`;
if (src.includes(dbImport)) {
  console.log('db.ts import already present');
} else {
  src = src.replace(dbMigrImport, `${dbMigrImport}\n${dbImport}`);
  console.log('Added db.ts import');
}

// 2. Remove DATABASE_URL const definition
src = src.replace(/^const DATABASE_URL = config\.databaseUrl;\n/m, '');
console.log('Removed DATABASE_URL const');

// 3. Replace DATABASE_URL usage in /api/debug/db handler
src = src.replace(
  /databaseUrlConfigured: Boolean\(DATABASE_URL && DATABASE_URL\.trim\(\)\)/,
  `databaseUrlConfigured: Boolean(config.databaseUrl && config.databaseUrl.trim())`
);
console.log('Updated databaseUrlConfigured');

// 4. Remove pool initialization block (let pool = null; try { pool = ... } catch { ... } let dbReady = false;)
// This spans from "let pool: Pool | null = null;" to "let dbReady = false;"
// We need to remove everything from "let pool" through "let dbReady = false;"
src = src.replace(
  /let pool: Pool \| null = null;\ntry \{[\s\S]*?}\s*\nlet dbReady = false;\n/,
  ''
);
console.log('Removed pool initialization block');

// 5. Remove hasDatabase function definition
src = src.replace(
  /function hasDatabase\(\) \{[\s\S]*?return Boolean\(pool && dbReady\);\n}\n/,
  ''
);
console.log('Removed hasDatabase function');

// 6. Remove dbQuery function definition
src = src.replace(
  /\/\/ Helpers\nasync function dbQuery<T = any>\(sql: string, params: any\[\] = \[\]\) \{[\s\S]*?return pool!\.query<T>\(sql, params\);\n}\n/,
  ''
);
// Try simpler match if above didn't work
if (src.includes('async function dbQuery<T = any>')) {
  src = src.replace(
    /async function dbQuery<T = any>\(sql: string, params: any\[\] = \[\]\) \{[\s\S]*?return pool!?\.query<T>\(sql, params\);\n}\n/,
    ''
  );
  console.log('Removed dbQuery function (simpler match)');
} else {
  console.log('Removed dbQuery function');
}

// 7. Remove normalizeEmail + normalizeUsername definitions
src = src.replace(
  /function normalizeEmail\(value: string\) \{[\s\S]*?return value\.trim\(\)\.toLowerCase\(\);\n}\n\nfunction normalizeUsername\(value: string\) \{[\s\S]*?return value\.trim\(\)\.toLowerCase\(\);\n}\n/,
  ''
);
console.log('Removed normalizeEmail/Username');

// 8. Replace "dbReady = true;" with "setDbReady(true);"
src = src.replace(/\bdbReady = true;/g, 'setDbReady(true);');
console.log('Replaced dbReady = true');

// 9. Replace "dbReady = false;" with "setDbReady(false);"
src = src.replace(/\bdbReady = false;/g, 'setDbReady(false);');
console.log('Replaced dbReady = false');

// 10. Remove Pool import from 'pg' if pool is no longer instantiated here
// Check if 'new Pool(' still appears in server.ts (it shouldn't after step 4)
if (!src.includes('new Pool(')) {
  // Remove Pool from the pg import line
  src = src.replace(/import \{ Pool \} from 'pg';\n/, '');
  console.log('Removed Pool from pg import');
} else {
  console.log('Pool still used directly — keeping import');
}

writeFileSync(serverPath, src, 'utf8');
const newLen = src.split('\n').length;
console.log(`\nDone: ${origLen} → ${newLen} lines (net removed ${origLen - newLen})`);
