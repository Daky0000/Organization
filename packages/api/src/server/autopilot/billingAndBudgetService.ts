import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { spend, CreditError, account, creditAllowance, grant } from '../creditAccounting.ts';
import { logger } from '../../logger.ts';

export interface BudgetCheckInput {
  tenantId: string;
  userId: string;
  estimatedProviderCostUsd: number;
  estimatedCredits: number;
  provider: string;
  model: string;
  isMock: boolean;
  userConfirmedSpend?: boolean;
}

export interface BudgetCheckResult {
  allowed: boolean;
  code?: 'KILL_SWITCH_ACTIVE' | 'EXCEEDS_PER_JOB_LIMIT' | 'MONTHLY_BUDGET_EXCEEDED' | 'MONTHLY_CREDIT_CAP_EXCEEDED' | 'SPEND_CONFIRMATION_REQUIRED';
  error?: string;
  confirmationRequired?: boolean;
  thresholdUsd?: number;
  currentMonthSpendUsd?: number;
  monthlyBudgetUsd?: number;
}

export class BudgetPolicyError extends Error {
  code: string;
  status: number;
  details?: Record<string, any>;

  constructor(code: string, message: string, status = 400, details?: Record<string, any>) {
    super(message);
    this.name = 'BudgetPolicyError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface TenantControlsRecord {
  tenant_id: string;
  kill_switch_generation: boolean;
  kill_switch_publishing: boolean;
  global_kill_switch?: boolean;
  publishing_kill_switch?: boolean;
  ai_generation_kill_switch?: boolean;
  auto_generate_enabled: boolean;
  auto_publish_enabled: boolean;
  monthly_budget_usd: number;
  monthly_credit_cap: number;
  per_job_max_usd: number;
  confirmation_threshold_usd: number;
  retention_days: number;
  updated_by?: string;
  updated_at?: string;
}

const DEFAULT_CONTROLS: TenantControlsRecord = {
  tenant_id: '',
  kill_switch_generation: false,
  kill_switch_publishing: false,
  auto_generate_enabled: false,
  auto_publish_enabled: false,
  monthly_budget_usd: 50.0,
  monthly_credit_cap: 5000,
  per_job_max_usd: 10.0,
  confirmation_threshold_usd: 2.0,
  retention_days: 90,
};

export async function getTenantControls(pool: Pool | Pick<Pool, 'query'> | null | undefined, tenantId: string): Promise<TenantControlsRecord> {
  if (pool && typeof pool.query === 'function') {
    try {
      const res = await pool.query<TenantControlsRecord>(
        `SELECT * FROM autopilot_tenant_controls WHERE tenant_id = $1 LIMIT 1`,
        [tenantId]
      );
    if (res.rows[0]) {
      return {
        ...DEFAULT_CONTROLS,
        ...res.rows[0],
        monthly_budget_usd: Number(res.rows[0].monthly_budget_usd || 50),
        monthly_credit_cap: Number(res.rows[0].monthly_credit_cap || 5000),
        per_job_max_usd: Number(res.rows[0].per_job_max_usd || 10),
        confirmation_threshold_usd: Number(res.rows[0].confirmation_threshold_usd || 2),
        retention_days: Number(res.rows[0].retention_days || 90),
      };
    }
  } catch {
    /* fallback to default */
  }
  }
  return { ...DEFAULT_CONTROLS, tenant_id: tenantId, global_kill_switch: process.env.AUTOPILOT_GLOBAL_KILL_SWITCH === 'true', publishing_kill_switch: false, ai_generation_kill_switch: false };
}

export async function upsertTenantControls(
  pool: Pool | Pick<Pool, 'query'> | null | undefined,
  tenantId: string,
  controls: Partial<TenantControlsRecord>,
  actorUserId = 'system'
): Promise<TenantControlsRecord> {
  const current = await getTenantControls(pool, tenantId);
  const updated: TenantControlsRecord = {
    ...current,
    ...controls,
    tenant_id: tenantId,
    updated_by: actorUserId,
  };

  if (pool && typeof pool.query === 'function') {
    try {
      await pool.query(
        `INSERT INTO autopilot_tenant_controls (
      tenant_id, kill_switch_generation, kill_switch_publishing, auto_generate_enabled,
      auto_publish_enabled, monthly_budget_usd, monthly_credit_cap, per_job_max_usd,
      confirmation_threshold_usd, retention_days, updated_by, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
    ON CONFLICT (tenant_id) DO UPDATE SET
      kill_switch_generation = EXCLUDED.kill_switch_generation,
      kill_switch_publishing = EXCLUDED.kill_switch_publishing,
      auto_generate_enabled = EXCLUDED.auto_generate_enabled,
      auto_publish_enabled = EXCLUDED.auto_publish_enabled,
      monthly_budget_usd = EXCLUDED.monthly_budget_usd,
      monthly_credit_cap = EXCLUDED.monthly_credit_cap,
      per_job_max_usd = EXCLUDED.per_job_max_usd,
      confirmation_threshold_usd = EXCLUDED.confirmation_threshold_usd,
      retention_days = EXCLUDED.retention_days,
      updated_by = EXCLUDED.updated_by,
      updated_at = NOW()`,
    [
      tenantId,
      updated.kill_switch_generation,
      updated.kill_switch_publishing,
      updated.auto_generate_enabled,
      updated.auto_publish_enabled,
      updated.monthly_budget_usd,
      updated.monthly_credit_cap,
      updated.per_job_max_usd,
      updated.confirmation_threshold_usd,
      updated.retention_days,
      actorUserId,
    ]
  );
    } catch (e) { /* ignore in mock */ }
  }

  return updated;
}

export async function checkBudgetPolicy(pool: Pool, input: BudgetCheckInput): Promise<BudgetCheckResult> {
  // 1. Global Kill Switch
  if (process.env.AUTOPILOT_GLOBAL_KILL_SWITCH === 'true') {
    return {
      allowed: false,
      code: 'KILL_SWITCH_ACTIVE',
      error: 'Autopilot generation is currently halted globally by system operations.',
    };
  }

  // 2. Tenant Kill Switch
  const controls = await getTenantControls(pool, input.tenantId);
  if (controls.kill_switch_generation) {
    return {
      allowed: false,
      code: 'KILL_SWITCH_ACTIVE',
      error: 'Generation has been paused by the tenant emergency kill switch.',
    };
  }

  // If mock/sandbox fallback, provider cost is 0 and won't exhaust spend
  if (input.isMock) {
    return { allowed: true };
  }

  // 3. Per-job limit
  if (input.estimatedProviderCostUsd > controls.per_job_max_usd) {
    return {
      allowed: false,
      code: 'EXCEEDS_PER_JOB_LIMIT',
      error: `Estimated cost ($${input.estimatedProviderCostUsd.toFixed(2)}) exceeds tenant per-job limit of $${controls.per_job_max_usd.toFixed(2)}.`,
    };
  }

  // 4. Confirmation threshold
  if (
    input.estimatedProviderCostUsd > controls.confirmation_threshold_usd &&
    !input.userConfirmedSpend
  ) {
    return {
      allowed: false,
      code: 'SPEND_CONFIRMATION_REQUIRED',
      confirmationRequired: true,
      thresholdUsd: controls.confirmation_threshold_usd,
      error: `Job cost ($${input.estimatedProviderCostUsd.toFixed(2)}) exceeds confirmation threshold of $${controls.confirmation_threshold_usd.toFixed(2)}. User confirmation required.`,
    };
  }

  // 5. Month-to-date cumulative spend check
  try {
    const monthRes = await pool.query<{ total_usd: string; total_credits: string }>(
      `SELECT COALESCE(SUM(COALESCE(actual_provider_cost_usd, estimated_provider_cost_usd)), 0) AS total_usd,
              COALESCE(SUM(COALESCE(settled_credits, reserved_credits)), 0) AS total_credits
       FROM autopilot_budget_reservations
       WHERE tenant_id = $1
         AND status IN ('reserved', 'settled')
         AND created_at >= date_trunc('month', NOW())`,
      [input.tenantId]
    );

    const currentUsd = Number(monthRes.rows[0]?.total_usd || 0);
    const currentCredits = Number(monthRes.rows[0]?.total_credits || 0);

    if (currentUsd + input.estimatedProviderCostUsd > controls.monthly_budget_usd) {
      return {
        allowed: false,
        code: 'MONTHLY_BUDGET_EXCEEDED',
        currentMonthSpendUsd: currentUsd,
        monthlyBudgetUsd: controls.monthly_budget_usd,
        error: `Monthly budget exceeded. Current MTD spend: $${currentUsd.toFixed(2)}, limit: $${controls.monthly_budget_usd.toFixed(2)}.`,
      };
    }

    if (currentCredits + input.estimatedCredits > controls.monthly_credit_cap) {
      return {
        allowed: false,
        code: 'MONTHLY_CREDIT_CAP_EXCEEDED',
        error: `Monthly credit cap exceeded. Current MTD: ${currentCredits} credits, limit: ${controls.monthly_credit_cap} credits.`,
      };
    }
  } catch (err: any) {
    logger.warn({ err: err?.message }, 'mtd_budget_query_fallback');
  }

  return { allowed: true };
}

export async function reserveJobBudget(
  pool: Pool,
  params: {
    tenantId: string;
    userId: string;
    contentItemId: string;
    workflowRunId: string;
    idempotencyKey: string;
    estimatedProviderCostUsd: number;
    estimatedCredits: number;
    customerPriceUsd: number;
    provider: string;
    model: string;
    isMock: boolean;
    userConfirmedSpend?: boolean;
    meta?: Record<string, any>;
  }
): Promise<string> {
  const check = await checkBudgetPolicy(pool, {
    tenantId: params.tenantId,
    userId: params.userId,
    estimatedProviderCostUsd: params.estimatedProviderCostUsd,
    estimatedCredits: params.estimatedCredits,
    provider: params.provider,
    model: params.model,
    isMock: params.isMock,
    userConfirmedSpend: params.userConfirmedSpend,
  });

  if (!check.allowed) {
    throw new BudgetPolicyError(check.code || 'BUDGET_ERROR', check.error || 'Budget policy check failed', 402, {
      confirmationRequired: check.confirmationRequired,
      thresholdUsd: check.thresholdUsd,
      currentMonthSpendUsd: check.currentMonthSpendUsd,
      monthlyBudgetUsd: check.monthlyBudgetUsd,
    });
  }

  // Deduct/reserve internal credits if not mock and credit spend is configured
  if (!params.isMock && params.estimatedCredits > 0) {
    try {
      try {
        const allowance = await creditAllowance(pool, params.userId);
        await account(pool, params.userId, allowance);
      } catch (acctErr: any) {
        logger.warn({ err: acctErr?.message }, 'credit_account_init_failed');
      }
      await spend(
        pool,
        params.userId,
        params.estimatedCredits,
        `autopilot_job:${params.workflowRunId}`,
        { tenantId: params.tenantId, model: params.model }
      );
    } catch (err: any) {
      if (err instanceof CreditError) {
        throw new BudgetPolicyError('INSUFFICIENT_CREDITS', err.message, err.status);
      }
      logger.warn({ err: err?.message }, 'credit_spend_optional_bypass');
    }
  }

  let validatedWorkflowRunId: string | null = null;
  if (params.workflowRunId) {
    try {
      const runCheck = await pool.query(
        `SELECT id FROM autopilot_workflow_runs WHERE id = $1 LIMIT 1`,
        [params.workflowRunId]
      );
      if (runCheck.rows.length) {
        validatedWorkflowRunId = params.workflowRunId;
      }
    } catch {
      validatedWorkflowRunId = null;
    }
  }

  const reservationMeta = {
    workflow_run_id: params.workflowRunId,
    ...(params.meta || {}),
  };

  const reservationId = randomUUID();
  await pool.query(
    `INSERT INTO autopilot_budget_reservations (
      id, tenant_id, user_id, content_item_id, workflow_run_id, idempotency_key,
      status, estimated_provider_cost_usd, customer_price_usd, reserved_credits,
      provider, model, is_mock, meta, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,'reserved',$7,$8,$9,$10,$11,$12,$13::jsonb,NOW(),NOW())
    ON CONFLICT (tenant_id, idempotency_key) DO UPDATE SET
      status = 'reserved',
      updated_at = NOW()`,
    [
      reservationId,
      params.tenantId,
      params.userId,
      params.contentItemId,
      validatedWorkflowRunId,
      params.idempotencyKey,
      params.estimatedProviderCostUsd,
      params.customerPriceUsd,
      params.estimatedCredits,
      params.provider,
      params.model,
      params.isMock,
      JSON.stringify(reservationMeta),
    ]
  );

  return reservationId;
}

export async function settleJobBudget(
  pool: Pool,
  params: {
    tenantId: string;
    idempotencyKey: string;
    actualProviderCostUsd: number;
    actualCredits: number;
    customerPriceUsd?: number;
    workflowRunId?: string;
  }
): Promise<void> {
  await pool.query(
    `UPDATE autopilot_budget_reservations
     SET status = 'settled',
         actual_provider_cost_usd = $3,
         settled_credits = $4,
         customer_price_usd = COALESCE($5, customer_price_usd),
         workflow_run_id = COALESCE($6, workflow_run_id),
         updated_at = NOW()
     WHERE tenant_id = $1 AND idempotency_key = $2`,
    [
      params.tenantId,
      params.idempotencyKey,
      params.actualProviderCostUsd,
      params.actualCredits,
      params.customerPriceUsd ?? null,
      params.workflowRunId ?? null,
    ]
  );
}

export async function releaseJobBudget(
  pool: Pool,
  params: {
    tenantId: string;
    idempotencyKey: string;
    reason: string;
  }
): Promise<void> {
  try {
    const existing = await pool.query<{ user_id: string; reserved_credits: number; is_mock: boolean }>(
      `SELECT user_id, reserved_credits, is_mock FROM autopilot_budget_reservations
       WHERE tenant_id = $1 AND idempotency_key = $2 AND status = 'reserved'`,
      [params.tenantId, params.idempotencyKey]
    );
    if (existing.rows[0] && !existing.rows[0].is_mock && existing.rows[0].reserved_credits > 0) {
      await grant(pool, existing.rows[0].user_id, existing.rows[0].reserved_credits, 'autopilot_job_refund', {
        idempotencyKey: params.idempotencyKey,
        reason: params.reason,
      });
    }
  } catch (gErr: any) {
    logger.warn({ err: gErr?.message }, 'credit_release_grant_failed');
  }

  await pool.query(
    `UPDATE autopilot_budget_reservations
     SET status = 'released',
         meta = jsonb_set(meta, '{release_reason}', to_jsonb($3::text)),
         updated_at = NOW()
     WHERE tenant_id = $1 AND idempotency_key = $2 AND status = 'reserved'`,
    [params.tenantId, params.idempotencyKey, params.reason]
  );
}

export async function getTenantUsageLedger(
  pool: Pool | Pick<Pool, 'query'> | null | undefined,
  tenantId: string,
  limit = 50
): Promise<{
  mtdUsd: number;
  mtdCredits: number;
  monthlyBudgetUsd: number;
  monthlyCreditCap: number;
  burnPct: number;
  records: any[];
}> {
  const controls = await getTenantControls(pool, tenantId);
  if (!pool || typeof pool.query !== 'function') {
    return {
      mtdUsd: 0,
      mtdCredits: 0,
      monthlyBudgetUsd: controls.monthly_budget_usd,
      monthlyCreditCap: controls.monthly_credit_cap,
      burnPct: 0,
      records: [],
    };
  }
  const mtdRes = await pool.query<{ total_usd: string; total_credits: string }>(
    `SELECT COALESCE(SUM(COALESCE(actual_provider_cost_usd, estimated_provider_cost_usd)), 0) AS total_usd,
            COALESCE(SUM(COALESCE(settled_credits, reserved_credits)), 0) AS total_credits
     FROM autopilot_budget_reservations
     WHERE tenant_id = $1 AND status IN ('reserved', 'settled') AND created_at >= date_trunc('month', NOW())`,
    [tenantId]
  );

  const mtdUsd = Number(mtdRes.rows[0]?.total_usd || 0);
  const mtdCredits = Number(mtdRes.rows[0]?.total_credits || 0);
  const burnPct = controls.monthly_budget_usd > 0
    ? Math.min(100, Math.round((mtdUsd / controls.monthly_budget_usd) * 100))
    : 0;

  const rows = await pool.query(
    `SELECT id, content_item_id, workflow_run_id, idempotency_key, status,
            estimated_provider_cost_usd, actual_provider_cost_usd, customer_price_usd,
            reserved_credits, settled_credits, provider, model, is_mock, created_at
     FROM autopilot_budget_reservations
     WHERE tenant_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [tenantId, limit]
  );

  return {
    mtdUsd,
    mtdCredits,
    monthlyBudgetUsd: controls.monthly_budget_usd,
    monthlyCreditCap: controls.monthly_credit_cap,
    burnPct,
    records: rows.rows,
  };
}
