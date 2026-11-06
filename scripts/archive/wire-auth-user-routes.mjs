// Remove inline auth + user routes from server.ts, replace with module mount calls
import { readFileSync, writeFileSync } from 'fs';

const serverPath = 'd:/Saas/packages/api/src/server.ts';
const content = readFileSync(serverPath, 'utf8');
const lines = content.split('\n');

// Find start: "// ─── Auth Routes" header line
const startIdx = lines.findIndex(l => l.trim() === '// ─── Auth Routes ──────────────────────────────────────────────────────────────');
if (startIdx < 0) { console.error('Auth Routes start not found'); process.exit(1); }

// Find end: last user route ends just before "// OAuth state registration (for CSRF protection)"
const endMarker = '// OAuth state registration (for CSRF protection)';
const endIdx = lines.findIndex(l => l.includes(endMarker));
if (endIdx < 0) { console.error('End marker not found'); process.exit(1); }

console.log(`Replacing lines ${startIdx + 1}–${endIdx} (${endIdx - startIdx} lines)`);

const replacement = [
  '// ─── Auth Routes ─────────────────────────────────────────────────────────────',
  'app.use(\'/api\', registerAuthRoutes({',
  '  requireAuth, hasDatabase, dbQuery,',
  '  getUserById, findUserByEmail, findUserByUsername, findUserByIdentifier,',
  '  createUser, updateUserProfile, updateLastLogin,',
  '  getUserPlanName, signToken, userToAuthPayload, checkTokenVersion,',
  '  provisionUserAgents, createNotification, getResendConfig,',
  '  jwtSecret: JWT_SECRET,',
  '  appUrl: config.appUrl,',
  '  syncProfileMedia: syncProfileMediaFn,',
  '}));',
  '// ─── User Management Routes ───────────────────────────────────────────────────',
  'app.use(\'/api\', registerUserRoutes({',
  '  requireAdmin, hasDatabase, dbQuery,',
  '  getUserById, findUserByEmail, findUserByUsername, createUser,',
  '  normalizeEmail, normalizeUsername,',
  '  inMemoryUsersById, inMemoryUserIdByEmail, inMemoryUserIdByUsername,',
  '}));',
  '',
];

const newLines = [
  ...lines.slice(0, startIdx),
  ...replacement,
  ...lines.slice(endIdx),
];

writeFileSync(serverPath, newLines.join('\n'), 'utf8');
console.log(`Done: ${lines.length} → ${newLines.length} lines (removed ${lines.length - newLines.length})`);
