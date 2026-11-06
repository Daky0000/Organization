import fs from 'node:fs';
import { createHash } from 'node:crypto';
const sql=fs.readFileSync(new URL('../packages/api/src/db-migrations.ts',import.meta.url),'utf8');
const hash=createHash('sha256').update(sql).digest('hex');
const tables=[...new Set([...sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+"?([A-Za-z_][A-Za-z0-9_]*)"?\s*\(/gi)].map(match=>match[1]))].sort();
const text=`// Generated from the migration source. Regenerate before build or development.\nexport const SCHEMA_SOURCE_HASH = '${hash}';\nexport const REQUIRED_SCHEMA_TABLES = ${JSON.stringify(tables,null,2)} as const;\n`;
fs.writeFileSync(new URL('../packages/api/src/schema-fingerprint.ts',import.meta.url),text);
