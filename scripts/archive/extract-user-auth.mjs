// Extract user/auth helpers from server.ts into src/user-auth.ts
import { readFileSync, writeFileSync } from 'fs';

const serverPath = 'd:/Saas/packages/api/src/server.ts';
const outPath = 'd:/Saas/packages/api/src/user-auth.ts';

const lines = readFileSync(serverPath, 'utf8').split('\n');
const orig = lines.length;

// ── Find block boundaries ────────────────────────────────────────────────────

// Block A start: "type DbUserRow = {"
const blockAStart = lines.findIndex(l => l.startsWith('type DbUserRow = {'));
if (blockAStart < 0) { console.error('Block A start not found'); process.exit(1); }

// Block A end: just before the "let startSocialAutomation" block
// which starts at "// These are assigned after buildDistributionModule"
const syncCommentIdx = lines.findIndex(l => l.includes('These are assigned after buildDistributionModule'));
if (syncCommentIdx < 0) { console.error('sync comment not found'); process.exit(1); }
const blockAEnd = syncCommentIdx - 2; // skip blank line before

// Block B start: "async function getUserPlanName(" (after the startup chain)
const blockBStart = lines.findIndex(l => l.startsWith('async function getUserPlanName('));
if (blockBStart < 0) { console.error('Block B start not found'); process.exit(1); }

// Block B end: the closing brace of updateUserProfile
// Find "// ── Stripe helpers" which comes right after updateUserProfile
const stripeHelpersIdx = lines.findIndex(l => l.includes('// ── Stripe helpers'));
if (stripeHelpersIdx < 0) { console.error('Stripe helpers marker not found'); process.exit(1); }
let blockBEnd = stripeHelpersIdx - 1;
while (blockBEnd > blockBStart && lines[blockBEnd].trim() === '') blockBEnd--;

// Block C start: "function requireAuth("
const blockCStart = lines.findIndex(l => l.startsWith('function requireAuth('));
if (blockCStart < 0) { console.error('Block C start not found'); process.exit(1); }

// Block C end: "// ── Agent System Definitions"
const agentDefsIdx = lines.findIndex(l => l.includes('// ── Agent System Definitions'));
if (agentDefsIdx < 0) { console.error('Agent defs marker not found'); process.exit(1); }
let blockCEnd = agentDefsIdx - 1;
while (blockCEnd > blockCStart && lines[blockCEnd].trim() === '') blockCEnd--;

console.log(`Block A: lines ${blockAStart + 1}–${blockAEnd + 1} (${blockAEnd - blockAStart + 1} lines)`);
console.log(`  First: ${lines[blockAStart]?.substring(0, 60)}`);
console.log(`  Last:  ${lines[blockAEnd]?.substring(0, 60)}`);
console.log(`Block B: lines ${blockBStart + 1}–${blockBEnd + 1} (${blockBEnd - blockBStart + 1} lines)`);
console.log(`  First: ${lines[blockBStart]?.substring(0, 60)}`);
console.log(`  Last:  ${lines[blockBEnd]?.substring(0, 60)}`);
console.log(`Block C: lines ${blockCStart + 1}–${blockCEnd + 1} (${blockCEnd - blockCStart + 1} lines)`);
console.log(`  First: ${lines[blockCStart]?.substring(0, 60)}`);
console.log(`  Last:  ${lines[blockCEnd]?.substring(0, 60)}`);

// ── Build user-auth.ts ────────────────────────────────────────────────────────

const header = [
  `import { randomUUID } from 'crypto';`,
  `import bcrypt from 'bcryptjs';`,
  `import jwt from 'jsonwebtoken';`,
  `import type { Request, Response } from 'express';`,
  `import { config } from './config.ts';`,
  `import { logger } from './logger.ts';`,
  `import { dbQuery, hasDatabase, normalizeEmail, normalizeUsername, pool } from './db.ts';`,
  ``,
  `const JWT_SECRET = config.jwtSecret;`,
  ``,
];

const blockA = lines.slice(blockAStart, blockAEnd + 1);
const blockB = lines.slice(blockBStart, blockBEnd + 1);
const blockC = lines.slice(blockCStart, blockCEnd + 1);

// Collect all exported names for the export statement
const exportedNames = [
  // Types (use 'export type')
  'DbUserRow', 'AdminDbRole', 'AdminDbStatus', 'DbPricingPlan', 'DbCardTemplate', 'PlatformConfigRow',
  // Maps
  'inMemoryUsersById', 'inMemoryUserIdByEmail', 'inMemoryUserIdByUsername',
  'inMemoryPricingPlansById', 'inMemoryCardTemplatesById', 'inMemoryPlatformConfigs',
  // Functions
  'getPlatformConfig', 'isPlatformEnabled', 'getResendConfig',
  'upsertInMemoryUser', 'seedInMemoryUsers',
  'getUserPlanName', 'userToAuthPayload',
  'JWT_EXPIRES_IN', 'signToken', 'getAuthUser',
  'findUserByEmail', 'findUserByUsername', 'findUserByIdentifier', 'getUserById',
  'createUser', 'updateLastLogin', 'ensureSeedUser', 'ensureSeedUsers', 'ensureSeedPricingPlans',
  'updateUserProfile',
  'requireAuth', 'checkTokenVersion', 'requireAdmin',
  'ORG_ROLE_RANK', 'requireOrgMembership',
];

// Prepend 'export' keyword to type and const/function/async function declarations of the exported names
const allBodyLines = [...blockA, '', ...blockB, '', ...blockC];
const exportedBodyLines = allBodyLines.map(l => {
  for (const name of exportedNames) {
    if (l.match(new RegExp(`^(type|const|function|async function|let)\\s+${name}\\b`))) {
      return 'export ' + l;
    }
  }
  return l;
});

const userAuthContent = [
  ...header,
  ...exportedBodyLines,
  '',
].join('\n');

writeFileSync(outPath, userAuthContent, 'utf8');
console.log(`\nWrote ${outPath} (${userAuthContent.split('\n').length} lines)`);

// ── Remove extracted blocks from server.ts + add import ──────────────────────

// Remove blocks in reverse order (C last, so indices stay valid for A and B)
// Actually: A < B < C in line order, so remove C first, then B, then A

// Remove Block C
lines.splice(blockCStart, blockCEnd - blockCStart + 1);
console.log(`Removed Block C (${blockCEnd - blockCStart + 1} lines)`);

// Recalculate B end since C was after B (no shift needed for B)
// Block B is still valid
lines.splice(blockBStart, blockBEnd - blockBStart + 1);
console.log(`Removed Block B (${blockBEnd - blockBStart + 1} lines)`);

// Block A is still valid
lines.splice(blockAStart, blockAEnd - blockAStart + 1);
console.log(`Removed Block A (${blockAEnd - blockAStart + 1} lines)`);

// Add import from user-auth.ts after db.ts import
const dbImport = `import { pool, dbReady, setDbReady, hasDatabase, dbQuery, normalizeEmail, normalizeUsername } from './db.ts';`;
const dbImportIdx = lines.findIndex(l => l === dbImport);
if (dbImportIdx < 0) { console.error('db.ts import not found'); process.exit(1); }

const userAuthImport = `import {
  DbUserRow, AdminDbRole, AdminDbStatus, DbPricingPlan, DbCardTemplate, PlatformConfigRow,
  inMemoryUsersById, inMemoryUserIdByEmail, inMemoryUserIdByUsername,
  inMemoryPricingPlansById, inMemoryCardTemplatesById, inMemoryPlatformConfigs,
  getPlatformConfig, isPlatformEnabled, getResendConfig,
  upsertInMemoryUser, seedInMemoryUsers,
  getUserPlanName, userToAuthPayload, JWT_EXPIRES_IN, signToken, getAuthUser,
  findUserByEmail, findUserByUsername, findUserByIdentifier, getUserById,
  createUser, updateLastLogin, ensureSeedUser, ensureSeedUsers, ensureSeedPricingPlans,
  updateUserProfile,
  requireAuth, checkTokenVersion, requireAdmin, requireOrgMembership,
} from './user-auth.ts';`;

lines.splice(dbImportIdx + 1, 0, userAuthImport);

// Remove JWT_SECRET const from server.ts since it's now in user-auth.ts
const jwtSecretIdx = lines.findIndex(l => l === 'const JWT_SECRET = config.jwtSecret;');
if (jwtSecretIdx >= 0) {
  lines.splice(jwtSecretIdx, 1);
  console.log('Removed JWT_SECRET const from server.ts');
}

writeFileSync(serverPath, lines.join('\n'), 'utf8');
const newLen = lines.length;
console.log(`\nDone: ${orig} → ${newLen} lines (net removed ${orig - newLen})`);
