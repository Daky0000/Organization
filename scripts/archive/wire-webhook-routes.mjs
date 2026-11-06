// Replace inline webhook handlers (4114-4455) with registerWebhookRoutes mount call
import { readFileSync, writeFileSync } from 'fs';

const serverPath = 'd:/Saas/packages/api/src/server.ts';
const lines = readFileSync(serverPath, 'utf8').split('\n');
const orig = lines.length;

// Find the block boundaries dynamically
const startIdx = lines.findIndex(l => l.startsWith("app.post('/webhooks/stripe',"));
if (startIdx < 0) { console.error('Start marker not found'); process.exit(1); }

// End is the closing }); of the last webhook route: /api/v1/social/facebook/webhook-subscribe
const lastWebhookMarker = "app.post('/api/v1/social/facebook/webhook-subscribe',";
const lastWebhookStart = lines.findIndex(l => l.startsWith(lastWebhookMarker));
if (lastWebhookStart < 0) { console.error('Last webhook route not found'); process.exit(1); }

// Find the closing }); after lastWebhookStart
let endIdx = lastWebhookStart;
for (let i = lastWebhookStart + 1; i < lines.length; i++) {
  if (lines[i].trimStart().startsWith('});') && lines[i].trim() === '});') {
    // Make sure this is at column 0 (top-level)
    if (!lines[i].startsWith(' ') && !lines[i].startsWith('\t')) {
      endIdx = i;
      break;
    }
  }
}

console.log(`Block: lines ${startIdx + 1}–${endIdx + 1} (${endIdx - startIdx + 1} lines)`);
console.log(`First: ${lines[startIdx].substring(0, 60)}`);
console.log(`Last:  ${lines[endIdx].substring(0, 60)}`);

const mountCall = [
  'app.use(registerWebhookRoutes({',
  '  stripe, hasDatabase, dbQuery, pool, requireAuth,',
  '  getStripeWebhookSecret: () => STRIPE_WEBHOOK_SECRET,',
  '  markSocialAccountNeedsReapproval,',
  '  logIntegrationEvent,',
  '  decryptIntegrationSecret,',
  '}));',
  '',
];

lines.splice(startIdx, endIdx - startIdx + 1, ...mountCall);
writeFileSync(serverPath, lines.join('\n'), 'utf8');
const removed = orig - lines.length;
console.log(`Done: ${orig} → ${lines.length} lines (net removed ${removed})`);
