import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { CreditError, creditAllowance, account, holdCredits, releaseHeldCredits, debitWithinTransaction } from '../creditAccounting.ts';
import { logger } from '../../logger.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Job accounting. One reservation per logical attempt (job), keyed by an
// idempotency key. Every change is also written as an immutable ledger event
// with its own unique key, so a repeated settle/release/refund has one effect.
//
//   not_reserved → reserved → submitted → settled | released | reconciliation_required
//
// Per unit (one provider call): pending → submitted → succeeded | failed | unknown.
// Customer credits and provider USD are separate. Provider USD is "actual" only
// when the provider reported usage; otherwise it is "estimated". A unit whose
// outcome is unknown keeps its credit hold until it is reconciled.
// ─────────────────────────────────────────────────────────────────────────────

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

export const isGlobalGenerationKilled = (env: NodeJS.ProcessEnv = process.env) => env.AUTOPILOT_GLOBAL_KILL_SWITCH === 'true';
export const isGlobalPublishingKilled = (env: NodeJS.ProcessEnv = process.env) =>
  env.AUTOPILOT_GLOBAL_KILL_SWITCH === 'true' || env.AUTOPILOT_PUBLISHING_KILL_SWITCH === 'true';

function normalizeControls(row: any, tenantId: string): TenantControlsRecord {
  return {
    ...DEFAULT_CONTROLS,
    ...row,
    tenant_id: tenantId,
    monthly_budget_usd: Number(row.monthly_budget_usd ?? 50),
    monthly_credit_cap: Number(row.monthly_credit_cap ?? 5000),
    per_job_max_usd: Number(row.per_job_max_usd ?? 10),
    confirmation_threshold_usd: Number(row.confirmation_threshold_usd ?? 2),
    retention_days: Number(row.retention_days ?? 90),
    global_kill_switch: isGlobalGenerationKilled(),
  };
}

/**
 * Reads tenant controls. With failClosed, a database error throws instead of
 * returning defaults, because defaults mean "kill switches off".
 */
export async function getTenantControls(
  pool: Pool | Pick<Pool, 'query'> | PoolClient | null | undefined,
  tenantId: string,
  opts: { failClosed?: boolean } = {},
): Promise<TenantControlsRecord> {
  if (pool && typeof pool.query === 'function') {
    try {
      const res = await pool.query(`SELECT * FROM autopilot_tenant_controls WHERE tenant_id = $1 LIMIT 1`, [tenantId]);
      if (res.rows[0]) return normalizeControls(res.rows[0], tenantId);
    } catch (err) {
      if (opts.failClosed) throw new BudgetPolicyError('CONTROLS_UNAVAILABLE', 'Workspace spend controls could not be read; refusing to spend.', 503);
      logger.warn({ err: (err as any)?.message }, 'autopilot_controls_read_failed');
    }
  }
  return { ...DEFAULT_CONTROLS, tenant_id: tenantId, global_kill_switch: isGlobalGenerationKilled(), publishing_kill_switch: false, ai_generation_kill_switch: false };
}

export async function upsertTenantControls(
  pool: Pool | Pick<Pool, 'query'> | null | undefined,
  tenantId: string,
  controls: Partial<TenantControlsRecord>,
  actorUserId = 'system',
): Promise<TenantControlsRecord> {
  const current = await getTenantControls(pool, tenantId);
  const updated: TenantControlsRecord = {
    ...current,
    ...controls,
    tenant_id: tenantId,
    updated_by: actorUserId,
  };

  if (pool && typeof pool.query === 'function') {
    // A kill-switch change that silently fails to save is worse than an error.
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
      ],
    );
  }

  return updated;
}

/** Pure policy evaluation given the controls and month-to-date totals. */
export function evaluateBudgetPolicy(
  controls: TenantControlsRecord,
  input: BudgetCheckInput,
  mtd: { usd: number; credits: number },
): BudgetCheckResult {
  if (isGlobalGenerationKilled()) {
    return { allowed: false, code: 'KILL_SWITCH_ACTIVE', error: 'Autopilot generation is currently halted globally by system operations.' };
  }
  if (controls.kill_switch_generation) {
    return { allowed: false, code: 'KILL_SWITCH_ACTIVE', error: 'Generation has been paused by the tenant emergency kill switch.' };
  }
  if (input.isMock) return { allowed: true };
  if (input.estimatedProviderCostUsd > controls.per_job_max_usd) {
    return {
      allowed: false,
      code: 'EXCEEDS_PER_JOB_LIMIT',
      error: `Estimated cost ($${input.estimatedProviderCostUsd.toFixed(2)}) exceeds tenant per-job limit of $${controls.per_job_max_usd.toFixed(2)}.`,
    };
  }
  if (input.estimatedProviderCostUsd > controls.confirmation_threshold_usd && !input.userConfirmedSpend) {
    return {
      allowed: false,
      code: 'SPEND_CONFIRMATION_REQUIRED',
      confirmationRequired: true,
      thresholdUsd: controls.confirmation_threshold_usd,
      error: `Job cost ($${input.estimatedProviderCostUsd.toFixed(2)}) exceeds confirmation threshold of $${controls.confirmation_threshold_usd.toFixed(2)}. User confirmation required.`,
    };
  }
  if (mtd.usd + input.estimatedProviderCostUsd > controls.monthly_budget_usd) {
    return {
      allowed: false,
      code: 'MONTHLY_BUDGET_EXCEEDED',
      currentMonthSpendUsd: mtd.usd,
      monthlyBudgetUsd: controls.monthly_budget_usd,
      error: `Monthly budget exceeded. Current MTD spend: $${mtd.usd.toFixed(2)}, limit: $${controls.monthly_budget_usd.toFixed(2)}.`,
    };
  }
  if (mtd.credits + input.estimatedCredits > controls.monthly_credit_cap) {
    return {
      allowed: false,
      code: 'MONTHLY_CREDIT_CAP_EXCEEDED',
      error: `Monthly credit cap exceeded. Current MTD: ${mtd.credits} credits, limit: ${controls.monthly_credit_cap} credits.`,
    };
  }
  return { allowed: true };
}

// Holds count against the budget at their estimate; settled jobs at what was
// actually recorded. Released jobs count nothing.
const MTD_SQL = `
  SELECT
    COALESCE(SUM(CASE WHEN status = 'settled' THEN actual_provider_cost_usd
                      WHEN status IN ('reserved','submitted','reconciliation_required') THEN estimated_provider_cost_usd
                      ELSE 0 END), 0) AS total_usd,
    COALESCE(SUM(CASE WHEN status = 'settled' THEN settled_credits
                      WHEN status IN ('reserved','submitted','reconciliation_required') THEN COALESCE(credits_held, reserved_credits)
                      ELSE 0 END), 0) AS total_credits
  FROM autopilot_budget_reservations
  WHERE tenant_id = $1 AND created_at >= date_trunc('month', NOW())`;

/** Read-only policy preview (no lock, no reservation). */
export async function checkBudgetPolicy(pool: Pool | Pick<Pool, 'query'>, input: BudgetCheckInput): Promise<BudgetCheckResult> {
  const controls = await getTenantControls(pool, input.tenantId);
  let mtd = { usd: 0, credits: 0 };
  try {
    const r = await pool.query(MTD_SQL, [input.tenantId]);
    mtd = { usd: Number(r.rows[0]?.total_usd || 0), credits: Number(r.rows[0]?.total_credits || 0) };
  } catch (err: any) {
    logger.warn({ err: err?.message }, 'mtd_budget_query_fallback');
  }
  return evaluateBudgetPolicy(controls, input, mtd);
}

// ── Job accounting ───────────────────────────────────────────────────────────

export type UnitState = 'pending' | 'submitted' | 'succeeded' | 'failed' | 'unknown' | 'not_submitted';

export interface AccountingUnit {
  index: number;
  state: UnitState;
  delivered: boolean;
  provider_request_id: string | null;
  model: string;
  estimated_usd: number;
  actual_usd: number | null;
  cost_status: 'estimated' | 'actual' | 'none';
  usage: Record<string, any> | null;
  error_code: string | null;
}

export interface ReservationRecord {
  id: string;
  tenant_id: string;
  user_id: string;
  content_item_id: string | null;
  workflow_run_id: string | null;
  idempotency_key: string;
  status: 'reserved' | 'submitted' | 'settled' | 'released' | 'reconciliation_required';
  provider: string;
  model: string;
  is_mock: boolean;
  units_reserved: number;
  unit_credit_rate: number;
  unit_estimated_usd: number;
  estimated_provider_cost_usd: number;
  actual_provider_cost_usd: number;
  cost_status: 'estimated' | 'actual' | 'mixed' | 'none';
  reserved_credits: number;
  credits_held: number;
  settled_credits: number;
  units: AccountingUnit[];
  created_at: string;
  updated_at: string;
}

export interface ReserveJobInput {
  tenantId: string;
  userId: string;
  contentItemId: string;
  workflowRunId: string;
  idempotencyKey: string;
  units: number;
  unitCreditRate: number;
  unitEstimatedUsd: number;
  provider: string;
  model: string;
  isMock: boolean;
  userConfirmedSpend?: boolean;
  meta?: Record<string, any>;
}

export interface UnitOutcomeInput {
  index: number;
  state: Exclude<UnitState, 'pending' | 'submitted'>;
  delivered: boolean;
  providerRequestId?: string | null;
  model?: string;
  actualUsd?: number | null;
  usage?: Record<string, any> | null;
  errorCode?: string | null;
}

export interface JobAccounting {
  readonly kind: 'postgres' | 'memory';
  reserve(input: ReserveJobInput): Promise<ReservationRecord>;
  /** Re-checks kill switches immediately before an external side effect. */
  assertGenerationAllowed(tenantId: string): Promise<void>;
  markUnitSubmitted(tenantId: string, key: string, index: number, providerRequestId?: string | null): Promise<void>;
  recordUnitOutcome(tenantId: string, key: string, outcome: UnitOutcomeInput): Promise<void>;
  /** Final accounting: charges delivered units, records spend, releases the rest; unknown units stay held. */
  settle(tenantId: string, key: string): Promise<ReservationRecord>;
  /** Releases a job that never reached a provider. Refuses once any unit was submitted. */
  release(tenantId: string, key: string, reason: string): Promise<ReservationRecord>;
  /** Operator/reconciler resolution for unknown units: charge (provider did deliver) or release. */
  resolveUnknownUnit(tenantId: string, key: string, index: number, resolution: { delivered: boolean; spentUsd: number | null; note: string; actor: string }): Promise<ReservationRecord>;
  get(tenantId: string, key: string): Promise<ReservationRecord | null>;
}

function summarize(units: AccountingUnit[], rate: number) {
  const delivered = units.filter((u) => u.delivered && u.state === 'succeeded').length;
  const unknown = units.filter((u) => u.state === 'unknown' || u.state === 'submitted').length;
  // Spend is incurred whenever the provider did the work, whether or not we
  // managed to store the result.
  const spentUnits = units.filter((u) => u.state === 'succeeded');
  const usd = spentUnits.reduce((s, u) => s + (u.actual_usd ?? u.estimated_usd), 0);
  const allActual = spentUnits.length > 0 && spentUnits.every((u) => u.cost_status === 'actual');
  const anyActual = spentUnits.some((u) => u.cost_status === 'actual');
  const costStatus: ReservationRecord['cost_status'] = spentUnits.length === 0 ? 'none' : allActual ? 'actual' : anyActual ? 'mixed' : 'estimated';
  return { charge: delivered * rate, unknownHold: unknown * rate, usd: Number(usd.toFixed(6)), costStatus, unknown };
}

const toNum = (v: any) => (v === null || v === undefined ? 0 : Number(v));

function rowToReservation(r: any): ReservationRecord {
  return {
    id: r.id,
    tenant_id: r.tenant_id,
    user_id: r.user_id,
    content_item_id: r.content_item_id ?? null,
    workflow_run_id: r.workflow_run_id ?? null,
    idempotency_key: r.idempotency_key,
    status: r.status,
    provider: r.provider,
    model: r.model,
    is_mock: Boolean(r.is_mock),
    units_reserved: toNum(r.units_reserved),
    unit_credit_rate: toNum(r.unit_credit_rate),
    unit_estimated_usd: toNum(r.unit_estimated_usd),
    estimated_provider_cost_usd: toNum(r.estimated_provider_cost_usd),
    actual_provider_cost_usd: toNum(r.actual_provider_cost_usd),
    cost_status: r.cost_status ?? 'estimated',
    reserved_credits: toNum(r.reserved_credits),
    credits_held: toNum(r.credits_held),
    settled_credits: toNum(r.settled_credits),
    units: Array.isArray(r.units) ? r.units : [],
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    updated_at: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
  };
}

function initialUnits(input: ReserveJobInput): AccountingUnit[] {
  return Array.from({ length: input.units }, (_, i) => ({
    index: i,
    state: 'pending' as UnitState,
    delivered: false,
    provider_request_id: null,
    model: input.model,
    estimated_usd: input.unitEstimatedUsd,
    actual_usd: null,
    cost_status: 'estimated' as const,
    usage: null,
    error_code: null,
  }));
}

function applyOutcome(units: AccountingUnit[], o: UnitOutcomeInput) {
  const u = units[o.index];
  if (!u) throw new BudgetPolicyError('UNKNOWN_UNIT', `Unit ${o.index} is not part of this reservation.`, 409);
  if (['succeeded', 'failed', 'not_submitted'].includes(u.state)) return false; // final already: idempotent
  u.state = o.state;
  u.delivered = o.state === 'succeeded' && o.delivered;
  u.provider_request_id = o.providerRequestId ?? u.provider_request_id;
  if (o.model) u.model = o.model;
  u.usage = o.usage ?? u.usage;
  u.error_code = o.errorCode ?? null;
  if (o.state === 'succeeded') {
    u.actual_usd = typeof o.actualUsd === 'number' ? o.actualUsd : null;
    u.cost_status = typeof o.actualUsd === 'number' ? 'actual' : 'estimated';
  } else if (o.state === 'failed' || o.state === 'not_submitted') {
    u.actual_usd = typeof o.actualUsd === 'number' ? o.actualUsd : 0;
    u.cost_status = typeof o.actualUsd === 'number' && o.actualUsd > 0 ? 'actual' : 'none';
  }
  return true;
}

// ── Postgres implementation ──────────────────────────────────────────────────

async function tx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function ledgerEvent(
  c: PoolClient,
  e: {
    reservation: ReservationRecord | { id: string; tenant_id: string; user_id: string; workflow_run_id: string | null; idempotency_key: string; provider: string; model: string };
    eventKey: string;
    entryType: 'reservation' | 'submission' | 'provider_outcome' | 'settlement' | 'release' | 'reconciliation' | 'adjustment';
    holdDelta?: number;
    chargeDelta?: number;
    estimatedUsd?: number | null;
    actualUsd?: number | null;
    costStatus?: string;
    providerRequestId?: string | null;
    status: string;
    meta?: Record<string, any>;
  },
): Promise<boolean> {
  const r = e.reservation;
  // Event keys are unique per reservation, not per caller-supplied job key: two
  // tenants (or a reused key) must never swallow each other's ledger rows.
  const eventKey = `${r.id}:${e.eventKey}`;
  const res = await c.query(
    `INSERT INTO autopilot_accounting_events (
       id, tenant_id, user_id, reservation_id, job_id, attempt_key, idempotency_key, entry_type,
       credit_hold_delta, credit_charge_delta, estimated_usd, actual_usd, cost_status,
       provider, model, provider_request_id, status, meta
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [
      randomUUID(), r.tenant_id, r.user_id, r.id, r.workflow_run_id, r.idempotency_key, eventKey, e.entryType,
      e.holdDelta ?? 0, e.chargeDelta ?? 0, e.estimatedUsd ?? null, e.actualUsd ?? null, e.costStatus ?? 'estimated',
      r.provider, r.model, e.providerRequestId ?? null, e.status, JSON.stringify(e.meta ?? {}),
    ],
  );
  return (res.rowCount ?? 0) > 0;
}

async function lockReservation(c: PoolClient, tenantId: string, key: string): Promise<ReservationRecord | null> {
  const { rows } = await c.query(
    `SELECT * FROM autopilot_budget_reservations WHERE tenant_id = $1 AND idempotency_key = $2 FOR UPDATE`,
    [tenantId, key],
  );
  return rows[0] ? rowToReservation(rows[0]) : null;
}

async function writeReservationState(c: PoolClient, r: ReservationRecord, patch: Partial<ReservationRecord> & { settled?: boolean }) {
  const next = { ...r, ...patch };
  await c.query(
    `UPDATE autopilot_budget_reservations SET
       status = $3, units = $4::jsonb, credits_held = $5, settled_credits = $6,
       actual_provider_cost_usd = $7, cost_status = $8, model = $9,
       settled_at = CASE WHEN $10 THEN NOW() ELSE settled_at END,
       version = version + 1, updated_at = NOW()
     WHERE tenant_id = $1 AND idempotency_key = $2`,
    [r.tenant_id, r.idempotency_key, next.status, JSON.stringify(next.units), next.credits_held, next.settled_credits,
      next.actual_provider_cost_usd, next.cost_status, next.model, Boolean(patch.settled)],
  );
  return next as ReservationRecord;
}

export function createPgJobAccounting(pool: Pool): JobAccounting {
  async function assertGenerationAllowed(tenantId: string) {
    if (isGlobalGenerationKilled()) throw new BudgetPolicyError('KILL_SWITCH_ACTIVE', 'Autopilot generation is currently halted globally by system operations.', 423);
    const controls = await getTenantControls(pool, tenantId, { failClosed: true });
    if (controls.kill_switch_generation) throw new BudgetPolicyError('KILL_SWITCH_ACTIVE', 'Generation has been paused by the tenant emergency kill switch.', 423);
  }

  return {
    kind: 'postgres',
    assertGenerationAllowed,

    async reserve(input) {
      if (!Number.isSafeInteger(input.units) || input.units < 0) throw new BudgetPolicyError('INVALID_UNITS', 'Invalid unit count.', 400);
      const estimatedCredits = input.isMock ? 0 : input.units * input.unitCreditRate;
      const estimatedUsd = input.isMock ? 0 : Number((input.units * input.unitEstimatedUsd).toFixed(6));
      // Monthly allowance reset happens in its own transaction, before the lock.
      if (!input.isMock && estimatedCredits > 0) {
        try { await account(pool, input.userId, await creditAllowance(pool, input.userId)); } catch (err: any) {
          throw new BudgetPolicyError('CREDIT_ACCOUNT_UNAVAILABLE', `Credit account could not be prepared: ${err?.message || 'error'}`, 503);
        }
      }
      return tx(pool, async (c) => {
        // Serialise every reservation for this tenant: two jobs cannot both
        // pass a monthly cap on a stale read.
        await c.query(`SELECT pg_advisory_xact_lock(hashtextextended('autopilot-budget:' || $1, 0))`, [input.tenantId]);
        const existing = await lockReservation(c, input.tenantId, input.idempotencyKey);
        if (existing) return existing;

        const controls = await getTenantControls(c, input.tenantId, { failClosed: true });
        const mtdRes = await c.query(MTD_SQL, [input.tenantId]);
        const mtd = { usd: Number(mtdRes.rows[0]?.total_usd || 0), credits: Number(mtdRes.rows[0]?.total_credits || 0) };
        const check = evaluateBudgetPolicy(controls, {
          tenantId: input.tenantId,
          userId: input.userId,
          estimatedProviderCostUsd: estimatedUsd,
          estimatedCredits,
          provider: input.provider,
          model: input.model,
          isMock: input.isMock,
          userConfirmedSpend: input.userConfirmedSpend,
        }, mtd);
        if (!check.allowed) {
          throw new BudgetPolicyError(check.code || 'BUDGET_ERROR', check.error || 'Budget policy check failed', check.code === 'KILL_SWITCH_ACTIVE' ? 423 : 402, {
            confirmationRequired: check.confirmationRequired,
            thresholdUsd: check.thresholdUsd,
            currentMonthSpendUsd: check.currentMonthSpendUsd,
            monthlyBudgetUsd: check.monthlyBudgetUsd,
          });
        }
        if (estimatedCredits > 0) {
          try {
            await holdCredits(c, input.userId, estimatedCredits, 'live');
          } catch (err) {
            if (err instanceof CreditError) throw new BudgetPolicyError('INSUFFICIENT_CREDITS', err.message, err.status);
            throw err;
          }
        }
        const runCheck = await c.query(`SELECT id FROM autopilot_workflow_runs WHERE id::text = $1 LIMIT 1`, [input.workflowRunId]);
        const id = randomUUID();
        const units = initialUnits(input);
        const { rows } = await c.query(
          `INSERT INTO autopilot_budget_reservations (
             id, tenant_id, user_id, content_item_id, workflow_run_id, idempotency_key, status,
             estimated_provider_cost_usd, actual_provider_cost_usd, customer_price_usd, reserved_credits, settled_credits,
             credits_held, units_reserved, unit_credit_rate, unit_estimated_usd, units, cost_status,
             provider, model, is_mock, meta, created_at, updated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,'reserved',$7,0,0,$8,0,$8,$9,$10,$11,$12::jsonb,'estimated',$13,$14,$15,$16::jsonb,NOW(),NOW())
           RETURNING *`,
          [id, input.tenantId, input.userId, input.contentItemId, runCheck.rows.length ? input.workflowRunId : null, input.idempotencyKey,
            estimatedUsd, estimatedCredits, input.units, input.isMock ? 0 : input.unitCreditRate, input.isMock ? 0 : input.unitEstimatedUsd,
            JSON.stringify(units), input.provider, input.model, input.isMock, JSON.stringify({ workflow_run_id: input.workflowRunId, ...(input.meta ?? {}) })],
        );
        const reservation = rowToReservation(rows[0]);
        await ledgerEvent(c, {
          reservation,
          eventKey: `${input.idempotencyKey}:reserve`,
          entryType: 'reservation',
          holdDelta: estimatedCredits,
          estimatedUsd,
          status: 'reserved',
          meta: { units: input.units, unit_credit_rate: input.unitCreditRate, unit_estimated_usd: input.unitEstimatedUsd, is_mock: input.isMock },
        });
        return reservation;
      });
    },

    async markUnitSubmitted(tenantId, key, index, providerRequestId) {
      await tx(pool, async (c) => {
        const r = await lockReservation(c, tenantId, key);
        if (!r) throw new BudgetPolicyError('RESERVATION_NOT_FOUND', 'No reservation for this job.', 409);
        if (r.status === 'settled' || r.status === 'released') throw new BudgetPolicyError('RESERVATION_CLOSED', `Reservation is already ${r.status}.`, 409);
        const u = r.units[index];
        if (!u) throw new BudgetPolicyError('UNKNOWN_UNIT', `Unit ${index} is not part of this reservation.`, 409);
        if (u.state !== 'pending') return;
        u.state = 'submitted';
        u.provider_request_id = providerRequestId ?? null;
        await writeReservationState(c, r, { status: 'submitted', units: r.units });
        await ledgerEvent(c, { reservation: r, eventKey: `${key}:unit:${index}:submitted`, entryType: 'submission', status: 'submitted', providerRequestId, meta: { unit: index } });
      });
    },

    async recordUnitOutcome(tenantId, key, o) {
      await tx(pool, async (c) => {
        const r = await lockReservation(c, tenantId, key);
        if (!r) throw new BudgetPolicyError('RESERVATION_NOT_FOUND', 'No reservation for this job.', 409);
        if (!applyOutcome(r.units, o)) return;
        await writeReservationState(c, r, { units: r.units, model: o.model ?? r.model });
        const u = r.units[o.index];
        await ledgerEvent(c, {
          reservation: r,
          eventKey: `${key}:unit:${o.index}:outcome:${o.state}`,
          entryType: 'provider_outcome',
          estimatedUsd: u.estimated_usd,
          actualUsd: u.actual_usd,
          costStatus: u.cost_status,
          providerRequestId: u.provider_request_id,
          status: o.state,
          meta: { unit: o.index, delivered: u.delivered, error_code: u.error_code, usage: u.usage },
        });
      });
    },

    async settle(tenantId, key) {
      return tx(pool, async (c) => {
        const r = await lockReservation(c, tenantId, key);
        if (!r) throw new BudgetPolicyError('RESERVATION_NOT_FOUND', 'No reservation for this job.', 409);
        if (r.status === 'settled' || r.status === 'released') return r;
        // Units never started are definitively not submitted.
        for (const u of r.units) if (u.state === 'pending') { u.state = 'not_submitted'; u.cost_status = 'none'; u.actual_usd = 0; }
        const s = summarize(r.units, r.unit_credit_rate);
        const alreadyCharged = r.settled_credits;
        const toCharge = Math.max(0, s.charge - alreadyCharged);
        const newHold = s.unknownHold;
        const releaseNow = Math.max(0, r.credits_held - newHold);
        if (!r.is_mock && releaseNow > 0) await releaseHeldCredits(c, r.user_id, releaseNow);
        if (!r.is_mock && toCharge > 0) {
          await debitWithinTransaction(c, r.user_id, toCharge, `autopilot_job:${r.workflow_run_id ?? r.id}`, { tenantId, idempotencyKey: key, model: r.model });
        }
        const status: ReservationRecord['status'] = s.unknown > 0 ? 'reconciliation_required' : 'settled';
        const next = await writeReservationState(c, r, {
          status,
          units: r.units,
          credits_held: newHold,
          settled_credits: alreadyCharged + toCharge,
          actual_provider_cost_usd: s.usd,
          cost_status: s.costStatus,
          settled: status === 'settled',
        });
        await ledgerEvent(c, {
          reservation: r,
          eventKey: `${key}:settle`,
          entryType: 'settlement',
          holdDelta: -releaseNow,
          chargeDelta: toCharge,
          estimatedUsd: r.estimated_provider_cost_usd,
          actualUsd: s.usd,
          costStatus: s.costStatus,
          status,
          meta: { unknown_units: s.unknown, delivered_units: r.units.filter((u) => u.delivered).length },
        });
        return next;
      });
    },

    async release(tenantId, key, reason) {
      return tx(pool, async (c) => {
        const r = await lockReservation(c, tenantId, key);
        if (!r) throw new BudgetPolicyError('RESERVATION_NOT_FOUND', 'No reservation for this job.', 409);
        if (r.status === 'released' || r.status === 'settled') return r;
        if (r.units.some((u) => u.state !== 'pending' && u.state !== 'not_submitted')) {
          throw new BudgetPolicyError('RELEASE_AFTER_SUBMISSION', 'Work reached a provider; settle or reconcile instead of releasing.', 409);
        }
        for (const u of r.units) { u.state = 'not_submitted'; u.cost_status = 'none'; u.actual_usd = 0; }
        if (!r.is_mock && r.credits_held > 0) await releaseHeldCredits(c, r.user_id, r.credits_held);
        const next = await writeReservationState(c, r, { status: 'released', units: r.units, credits_held: 0, actual_provider_cost_usd: 0, cost_status: 'none' });
        await ledgerEvent(c, { reservation: r, eventKey: `${key}:release`, entryType: 'release', holdDelta: -r.credits_held, actualUsd: 0, costStatus: 'none', status: 'released', meta: { reason: reason.slice(0, 300) } });
        return next;
      });
    },

    async resolveUnknownUnit(tenantId, key, index, resolution) {
      await tx(pool, async (c) => {
        const r = await lockReservation(c, tenantId, key);
        if (!r) throw new BudgetPolicyError('RESERVATION_NOT_FOUND', 'No reservation for this job.', 409);
        const u = r.units[index];
        if (!u || (u.state !== 'unknown' && u.state !== 'submitted')) return;
        applyOutcome(r.units, {
          index,
          state: resolution.delivered || (resolution.spentUsd ?? 0) > 0 ? 'succeeded' : 'failed',
          delivered: resolution.delivered,
          actualUsd: resolution.spentUsd,
          errorCode: resolution.delivered ? null : 'RECONCILED_NOT_DELIVERED',
        });
        await writeReservationState(c, r, { units: r.units });
        await ledgerEvent(c, {
          reservation: r,
          eventKey: `${key}:unit:${index}:reconciled`,
          entryType: 'reconciliation',
          actualUsd: resolution.spentUsd,
          status: r.units[index].state,
          meta: { unit: index, delivered: resolution.delivered, note: resolution.note.slice(0, 300), actor: resolution.actor },
        });
      });
      // Re-settle with its own idempotency key so a later resolution is not swallowed.
      return tx(pool, async (c) => {
        const r = await lockReservation(c, tenantId, key);
        if (!r) throw new BudgetPolicyError('RESERVATION_NOT_FOUND', 'No reservation for this job.', 409);
        const s = summarize(r.units, r.unit_credit_rate);
        const toCharge = Math.max(0, s.charge - r.settled_credits);
        const releaseNow = Math.max(0, r.credits_held - s.unknownHold);
        if (!r.is_mock && releaseNow > 0) await releaseHeldCredits(c, r.user_id, releaseNow);
        if (!r.is_mock && toCharge > 0) await debitWithinTransaction(c, r.user_id, toCharge, `autopilot_job:${r.workflow_run_id ?? r.id}`, { tenantId, idempotencyKey: key, reconciled: true });
        const status: ReservationRecord['status'] = s.unknown > 0 ? 'reconciliation_required' : 'settled';
        const next = await writeReservationState(c, r, {
          status, units: r.units, credits_held: s.unknownHold, settled_credits: r.settled_credits + toCharge,
          actual_provider_cost_usd: s.usd, cost_status: s.costStatus, settled: status === 'settled',
        });
        await ledgerEvent(c, {
          reservation: r, eventKey: `${key}:resettle:${index}`, entryType: 'settlement', holdDelta: -releaseNow, chargeDelta: toCharge,
          actualUsd: s.usd, costStatus: s.costStatus, status, meta: { after_reconciling_unit: index },
        });
        return next;
      });
    },

    async get(tenantId, key) {
      const { rows } = await pool.query(`SELECT * FROM autopilot_budget_reservations WHERE tenant_id = $1 AND idempotency_key = $2`, [tenantId, key]);
      return rows[0] ? rowToReservation(rows[0]) : null;
    },
  };
}

// ── In-memory implementation (tests, no-database development) ───────────────

export function createMemoryJobAccounting(opts: { controls?: (tenantId: string) => Partial<TenantControlsRecord>; credits?: Map<string, number> } = {}): JobAccounting & {
  reservations: Map<string, ReservationRecord>;
  events: Array<{ key: string; entryType: string; holdDelta: number; chargeDelta: number; status: string }>;
  wallets: Map<string, { credits: number; held: number }>;
} {
  const reservations = new Map<string, ReservationRecord>();
  const events: Array<{ key: string; entryType: string; holdDelta: number; chargeDelta: number; status: string }> = [];
  const wallets = new Map<string, { credits: number; held: number }>();
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T> | T): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run as Promise<T>;
  };
  const k = (t: string, key: string) => `${t}\u0000${key}`;
  const controlsFor = (t: string) => ({ ...DEFAULT_CONTROLS, tenant_id: t, ...(opts.controls?.(t) ?? {}) }) as TenantControlsRecord;
  const wallet = (u: string) => {
    if (!wallets.has(u)) wallets.set(u, { credits: opts.credits?.get(u) ?? 100000, held: 0 });
    return wallets.get(u)!;
  };
  const event = (key: string, entryType: string, status: string, holdDelta = 0, chargeDelta = 0) => {
    if (events.some((e) => e.key === key)) return false;
    events.push({ key, entryType, status, holdDelta, chargeDelta });
    return true;
  };
  const mtd = (t: string) => {
    let usd = 0;
    let credits = 0;
    for (const r of reservations.values()) {
      if (r.tenant_id !== t) continue;
      if (r.status === 'settled') { usd += r.actual_provider_cost_usd; credits += r.settled_credits; }
      else if (r.status !== 'released') { usd += r.estimated_provider_cost_usd; credits += r.credits_held; }
    }
    return { usd, credits };
  };
  const settleInto = (r: ReservationRecord, eventKey: string) => {
    for (const u of r.units) if (u.state === 'pending') { u.state = 'not_submitted'; u.cost_status = 'none'; u.actual_usd = 0; }
    const s = summarize(r.units, r.unit_credit_rate);
    const toCharge = Math.max(0, s.charge - r.settled_credits);
    const releaseNow = Math.max(0, r.credits_held - s.unknownHold);
    if (!r.is_mock) {
      const w = wallet(r.user_id);
      w.held -= releaseNow;
      w.credits -= toCharge;
    }
    r.credits_held = s.unknownHold;
    r.settled_credits += toCharge;
    r.actual_provider_cost_usd = s.usd;
    r.cost_status = s.costStatus;
    r.status = s.unknown > 0 ? 'reconciliation_required' : 'settled';
    r.updated_at = new Date().toISOString();
    event(eventKey, 'settlement', r.status, -releaseNow, toCharge);
    return structuredClone(r);
  };

  const api = {
    kind: 'memory' as const,
    reservations,
    events,
    wallets,
    async assertGenerationAllowed(tenantId: string) {
      if (isGlobalGenerationKilled()) throw new BudgetPolicyError('KILL_SWITCH_ACTIVE', 'Autopilot generation is currently halted globally by system operations.', 423);
      if (controlsFor(tenantId).kill_switch_generation) throw new BudgetPolicyError('KILL_SWITCH_ACTIVE', 'Generation has been paused by the tenant emergency kill switch.', 423);
    },
    reserve: (input: ReserveJobInput) => serial(async () => {
      const existing = reservations.get(k(input.tenantId, input.idempotencyKey));
      if (existing) return structuredClone(existing);
      const credits = input.isMock ? 0 : input.units * input.unitCreditRate;
      const usd = input.isMock ? 0 : Number((input.units * input.unitEstimatedUsd).toFixed(6));
      const check = evaluateBudgetPolicy(controlsFor(input.tenantId), {
        tenantId: input.tenantId, userId: input.userId, estimatedProviderCostUsd: usd, estimatedCredits: credits,
        provider: input.provider, model: input.model, isMock: input.isMock, userConfirmedSpend: input.userConfirmedSpend,
      }, mtd(input.tenantId));
      if (!check.allowed) throw new BudgetPolicyError(check.code || 'BUDGET_ERROR', check.error || 'Budget policy check failed', check.code === 'KILL_SWITCH_ACTIVE' ? 423 : 402);
      if (credits > 0) {
        const w = wallet(input.userId);
        if (w.credits - w.held < credits) throw new BudgetPolicyError('INSUFFICIENT_CREDITS', 'Insufficient AI credits', 402);
        w.held += credits;
      }
      const now = new Date().toISOString();
      const r: ReservationRecord = {
        id: randomUUID(), tenant_id: input.tenantId, user_id: input.userId, content_item_id: input.contentItemId,
        workflow_run_id: input.workflowRunId, idempotency_key: input.idempotencyKey, status: 'reserved',
        provider: input.provider, model: input.model, is_mock: input.isMock, units_reserved: input.units,
        unit_credit_rate: input.isMock ? 0 : input.unitCreditRate, unit_estimated_usd: input.isMock ? 0 : input.unitEstimatedUsd,
        estimated_provider_cost_usd: usd, actual_provider_cost_usd: 0, cost_status: 'estimated', reserved_credits: credits,
        credits_held: credits, settled_credits: 0, units: initialUnits(input), created_at: now, updated_at: now,
      };
      reservations.set(k(input.tenantId, input.idempotencyKey), r);
      event(`${input.idempotencyKey}:reserve`, 'reservation', 'reserved', credits, 0);
      return structuredClone(r);
    }),
    markUnitSubmitted: (tenantId: string, key: string, index: number, providerRequestId?: string | null) => serial(async () => {
      const r = reservations.get(k(tenantId, key));
      if (!r) throw new BudgetPolicyError('RESERVATION_NOT_FOUND', 'No reservation for this job.', 409);
      if (r.status === 'settled' || r.status === 'released') throw new BudgetPolicyError('RESERVATION_CLOSED', `Reservation is already ${r.status}.`, 409);
      const u = r.units[index];
      if (!u) throw new BudgetPolicyError('UNKNOWN_UNIT', `Unit ${index} is not part of this reservation.`, 409);
      if (u.state !== 'pending') return;
      u.state = 'submitted';
      u.provider_request_id = providerRequestId ?? null;
      r.status = 'submitted';
      event(`${key}:unit:${index}:submitted`, 'submission', 'submitted');
    }),
    recordUnitOutcome: (tenantId: string, key: string, o: UnitOutcomeInput) => serial(async () => {
      const r = reservations.get(k(tenantId, key));
      if (!r) throw new BudgetPolicyError('RESERVATION_NOT_FOUND', 'No reservation for this job.', 409);
      if (applyOutcome(r.units, o)) event(`${key}:unit:${o.index}:outcome:${o.state}`, 'provider_outcome', o.state);
    }),
    settle: (tenantId: string, key: string) => serial(async () => {
      const r = reservations.get(k(tenantId, key));
      if (!r) throw new BudgetPolicyError('RESERVATION_NOT_FOUND', 'No reservation for this job.', 409);
      if (r.status === 'settled' || r.status === 'released') return structuredClone(r);
      return settleInto(r, `${key}:settle`);
    }),
    release: (tenantId: string, key: string, _reason: string) => serial(async () => {
      const r = reservations.get(k(tenantId, key));
      if (!r) throw new BudgetPolicyError('RESERVATION_NOT_FOUND', 'No reservation for this job.', 409);
      if (r.status === 'released' || r.status === 'settled') return structuredClone(r);
      if (r.units.some((u) => u.state !== 'pending' && u.state !== 'not_submitted')) {
        throw new BudgetPolicyError('RELEASE_AFTER_SUBMISSION', 'Work reached a provider; settle or reconcile instead of releasing.', 409);
      }
      if (!r.is_mock) wallet(r.user_id).held -= r.credits_held;
      event(`${key}:release`, 'release', 'released', -r.credits_held, 0);
      r.credits_held = 0;
      r.status = 'released';
      r.cost_status = 'none';
      for (const u of r.units) { u.state = 'not_submitted'; u.cost_status = 'none'; u.actual_usd = 0; }
      return structuredClone(r);
    }),
    resolveUnknownUnit: (tenantId: string, key: string, index: number, resolution: { delivered: boolean; spentUsd: number | null; note: string; actor: string }) => serial(async () => {
      const r = reservations.get(k(tenantId, key));
      if (!r) throw new BudgetPolicyError('RESERVATION_NOT_FOUND', 'No reservation for this job.', 409);
      const u = r.units[index];
      if (u && (u.state === 'unknown' || u.state === 'submitted')) {
        applyOutcome(r.units, {
          index,
          state: resolution.delivered || (resolution.spentUsd ?? 0) > 0 ? 'succeeded' : 'failed',
          delivered: resolution.delivered,
          actualUsd: resolution.spentUsd,
        });
        event(`${key}:unit:${index}:reconciled`, 'reconciliation', u.state);
      }
      return settleInto(r, `${key}:resettle:${index}`);
    }),
    async get(tenantId: string, key: string) {
      const r = reservations.get(k(tenantId, key));
      return r ? structuredClone(r) : null;
    },
  };
  return api;
}

export function createJobAccounting(pool: Pick<Pool, 'query'> | null | undefined, hasDatabase?: () => boolean): JobAccounting {
  if (pool && hasDatabase?.() && typeof (pool as Pool).connect === 'function') return createPgJobAccounting(pool as Pool);
  if (process.env.NODE_ENV === 'production') {
    throw new BudgetPolicyError('ACCOUNTING_UNAVAILABLE', 'Job accounting needs the database; refusing to run unmetered in production.', 503);
  }
  return createMemoryJobAccounting();
}

// ── Reconciliation sweep ─────────────────────────────────────────────────────

/**
 * Jobs that crashed mid-flight. A reservation still in `reserved` after the
 * grace period never reached a provider (submission is recorded before the
 * call), so it is released. One still `submitted` may have run, so it becomes
 * reconciliation_required and keeps its hold until resolved.
 */
export async function sweepStaleReservations(pool: Pool, accounting: JobAccounting, opts: { graceMinutes?: number; limit?: number } = {}) {
  const grace = Math.max(5, opts.graceMinutes ?? 30);
  const { rows } = await pool.query(
    `SELECT tenant_id, idempotency_key, status FROM autopilot_budget_reservations
     WHERE status IN ('reserved','submitted') AND updated_at < NOW() - ($1 || ' minutes')::interval
     ORDER BY updated_at ASC LIMIT $2`,
    [String(grace), opts.limit ?? 50],
  );
  let released = 0;
  let flagged = 0;
  for (const row of rows) {
    try {
      if (row.status === 'reserved') {
        await accounting.release(row.tenant_id, row.idempotency_key, 'Stale reservation: job never reached a provider');
        released++;
      } else {
        await tx(pool, async (c) => {
          const r = await lockReservation(c, row.tenant_id, row.idempotency_key);
          if (!r || r.status !== 'submitted') return;
          for (const u of r.units) if (u.state === 'submitted') u.state = 'unknown';
          await writeReservationState(c, r, { units: r.units });
        });
        await accounting.settle(row.tenant_id, row.idempotency_key);
        flagged++;
      }
    } catch (err: any) {
      logger.error({ err: err?.message, key: row.idempotency_key }, 'autopilot_reservation_sweep_failed');
    }
  }
  return { released, flagged };
}

// ── Usage ledger for the UI ──────────────────────────────────────────────────

export async function getTenantUsageLedger(
  pool: Pool | Pick<Pool, 'query'> | null | undefined,
  tenantId: string,
  limit = 50,
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
    return { mtdUsd: 0, mtdCredits: 0, monthlyBudgetUsd: controls.monthly_budget_usd, monthlyCreditCap: controls.monthly_credit_cap, burnPct: 0, records: [] };
  }
  const mtdRes = await pool.query(MTD_SQL, [tenantId]);
  const mtdUsd = Number(mtdRes.rows[0]?.total_usd || 0);
  const mtdCredits = Number(mtdRes.rows[0]?.total_credits || 0);
  const burnPct = controls.monthly_budget_usd > 0 ? Math.min(100, Math.round((mtdUsd / controls.monthly_budget_usd) * 100)) : 0;

  const rows = await pool.query(
    `SELECT id, content_item_id, workflow_run_id, idempotency_key, status,
            estimated_provider_cost_usd, actual_provider_cost_usd, cost_status, customer_price_usd,
            reserved_credits, credits_held, settled_credits, units_reserved, provider, model, is_mock, created_at, settled_at
     FROM autopilot_budget_reservations
     WHERE tenant_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [tenantId, limit],
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
