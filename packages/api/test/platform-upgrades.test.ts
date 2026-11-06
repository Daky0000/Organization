import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_SCHEMA_VERSION,
  computeMigrationChecksum,
} from '../src/db-migrations.ts';
import {
  resolvePlanQuotaLimits,
  checkPlanQuota,
  computeWebhookSignature,
} from '../src/middleware/planQuotaMiddleware.ts';
import {
  matchesTrigger,
  personalize,
} from '../src/server/automationEngine.ts';

describe('Platform Upgrades Suite', () => {
  it('computes deterministic SHA-256 checksums for schema_migrations tracking', () => {
    const c1 = computeMigrationChecksum(BASE_SCHEMA_VERSION);
    const c2 = computeMigrationChecksum(BASE_SCHEMA_VERSION);
    const c3 = computeMigrationChecksum('2026.10.01-next');
    assert.equal(c1.length, 64);
    assert.equal(c1, c2);
    assert.notEqual(c1, c3);
  });

  it('resolves plan quota limits accurately across Free, Starter, Growth, Pro, and Agency tiers', async () => {
    const freeLimits = resolvePlanQuotaLimits('Free');
    const growthLimits = resolvePlanQuotaLimits('Growth Plan');
    const agencyLimits = resolvePlanQuotaLimits('Enterprise Agency');

    assert.equal(freeLimits.social_accounts, 2);
    assert.equal(freeLimits.approval_links, 5);
    assert.equal(growthLimits.social_accounts, 25);
    assert.equal(agencyLimits.social_accounts, 9999);

    // Without DB pool, checkPlanQuota safely allows and reports tier limits
    const quotaCheck = await checkPlanQuota(null, 'usr_123', 'approval_links', 'Free');
    assert.equal(quotaCheck.allowed, false);
    assert.equal(quotaCheck.limit, 5);
    assert.equal(quotaCheck.planName, 'Free');
  });

  it('generates verifiable HMAC-SHA256 signatures for outbound webhook payloads', () => {
    const secret = 'whsec_test_key_12345';
    const ts = 1758618000;
    const payload = JSON.stringify({ event: 'lead.created', data: { email: 'lead@acme.com' } });
    const sig = computeWebhookSignature(secret, ts, payload);

    assert.ok(sig.startsWith(`t=${ts},v1=`));
    assert.equal(sig, computeWebhookSignature(secret, ts, payload));
    assert.notEqual(sig, computeWebhookSignature('whsec_other', ts, payload));
  });

  it('matches cross-module automation triggers and personalizes task/deal templates', () => {
    const dealFlow = {
      trigger_type: 'deal_won',
      steps: [{ type: 'trigger', config: { trigger: 'deal_won' } }],
    };
    assert.equal(matchesTrigger(dealFlow, 'deal_won'), true);
    assert.equal(matchesTrigger(dealFlow, 'signup'), false);

    const rendered = personalize('Onboarding task for {{first_name}} {{last_name}} ({{email}})', {
      id: 'c_1',
      email: 'elena@studio.io',
      first_name: 'Elena',
      last_name: 'Vance',
    });
    assert.equal(rendered, 'Onboarding task for Elena Vance (elena@studio.io)');
  });
});
