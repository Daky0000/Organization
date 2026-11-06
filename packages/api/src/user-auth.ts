import { randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Response } from 'express';
import type { Request } from './types/http.ts';
import { config } from './config.ts';
import { logger } from './logger.ts';
import { dbQuery, hasDatabase, normalizeEmail, normalizeUsername, pool } from './db.ts';
import { decryptPlatformConfig } from './integration-helpers.ts';
import { PLAN_TIER_NAMES, PLAN_TIER_ORDER, isPlanTierKey, resolvePlanTierKey, type PlanTierKey } from './middleware/planQuotaMiddleware.ts';

const JWT_SECRET = config.jwtSecret;

export type DbUserRow = {
  id: string;
  email: string;
  username: string | null;
  full_name: string | null;
  website: string | null;
  phone: string | null;
  country: string | null;
  role: string;
  status: string;
  avatar_url: string | null;
  cover_url: string | null;
  last_login_at: string | null;
  password_hash: string;
  token_version: number;
  email_verified: boolean;
  failed_login_attempts: number;
  locked_until: string | null;
  created_at: string;
};

export type AdminDbRole = 'admin' | 'user';
export type AdminDbStatus = 'active' | 'suspended' | 'pending' | 'banned';

export type DbPricingPlan = {
  id: string;
  name: string;
  description: string;
  price: number;
  billing_period: 'monthly' | 'yearly';
  features: string[];
  is_active: boolean;
  discount_percentage: number;
  is_on_sale: boolean;
  created_at: string;
  updated_at: string;
};

export type DbCardTemplate = {
  id: string;
  name: string;
  description?: string;
  design_data: any;
  cover_image_url?: string;
  is_published: boolean;
  created_at: string;
  updated_at: string;
};

export const inMemoryUsersById = new Map<string, DbUserRow>();
export const inMemoryUserIdByEmail = new Map<string, string>();
export const inMemoryUserIdByUsername = new Map<string, string>();
export const inMemoryPricingPlansById = new Map<string, DbPricingPlan>();
export const inMemoryCardTemplatesById = new Map<string, DbCardTemplate>();

export type PlatformConfigRow = { platform: string; config: Record<string, string>; enabled: boolean; updated_at: string };
export const inMemoryPlatformConfigs = new Map<string, PlatformConfigRow>();

export async function getPlatformConfig(platform: string): Promise<Record<string, string>> {
  if (hasDatabase()) {
    const result = await dbQuery('SELECT config, enabled FROM platform_configs WHERE platform = $1', [platform]);
    if (result.rows.length > 0) return { ...decryptPlatformConfig(result.rows[0].config), ...(platform === 'paystack' ? { _enabled: String(result.rows[0].enabled) } : {}) } as Record<string, string>;
    return {};
  }
  return decryptPlatformConfig(inMemoryPlatformConfigs.get(platform)?.config) as Record<string, string>;
}

export async function isPlatformEnabled(platform: string): Promise<boolean> {
  if (hasDatabase()) {
    const result = await dbQuery('SELECT enabled FROM platform_configs WHERE platform = $1', [platform]);
    return result.rows.length > 0 ? Boolean(result.rows[0].enabled) : false;
  }
  return inMemoryPlatformConfigs.get(platform)?.enabled ?? false;
}

// Returns { apiKey, fromEmail, fromName } for Resend, reading platform_configs first then env-var fallback.
export async function getResendConfig(): Promise<{ apiKey: string; fromEmail: string; fromName: string }> {
  const cfg = await getPlatformConfig('resend').catch(() => ({} as Record<string, string>));
  const apiKey    = String(cfg.apiKey    || process.env.RESEND_API_KEY    || '').trim();
  const fromEmail = String(cfg.fromEmail || process.env.RESEND_FROM_EMAIL || 'noreply@resend.dev').trim();
  const fromName  = String(cfg.fromName  || process.env.RESEND_FROM_NAME  || '').trim();
  return { apiKey, fromEmail, fromName };
}

export function upsertInMemoryUser(input: {
  id: string;
  name: string;
  username: string;
  email: string;
  password: string;
  role: AdminDbRole;
  status?: AdminDbStatus;
}) {
  const normalizedEmail = normalizeEmail(input.email);
  const normalizedUsername = normalizeUsername(input.username);
  const existingId = inMemoryUserIdByUsername.get(normalizedUsername) || inMemoryUserIdByEmail.get(normalizedEmail);
  const id = existingId || input.id;
  const existing = inMemoryUsersById.get(id);
  const passwordHash =
    existing && bcrypt.compareSync(input.password, existing.password_hash)
      ? existing.password_hash
      : bcrypt.hashSync(input.password, 12);

  const nextUser: DbUserRow = {
    id,
    email: normalizedEmail,
    username: normalizedUsername,
    full_name: input.name,
    website: existing?.website || null,
    phone: existing?.phone || null,
    country: existing?.country || null,
    role: input.role,
    status: input.status || 'active',
    avatar_url: existing?.avatar_url || null,
    cover_url: existing?.cover_url || null,
    last_login_at: existing?.last_login_at || null,
    password_hash: passwordHash,
    token_version: existing?.token_version ?? 1,
    email_verified: existing?.email_verified ?? false,
    failed_login_attempts: existing?.failed_login_attempts ?? 0,
    locked_until: existing?.locked_until ?? null,
    created_at: existing?.created_at || new Date().toISOString(),
  };

  inMemoryUsersById.set(id, nextUser);
  inMemoryUserIdByEmail.set(normalizedEmail, id);
  inMemoryUserIdByUsername.set(normalizedUsername, id);
}

export function seedInMemoryUsers() {
  upsertInMemoryUser({
    id: 'admin-1',
    name: 'Dan Ayipah',
    username: 'daky',
    email: 'danayipah@gmail.com',
    password: process.env.DEV_ADMIN_PASSWORD || randomUUID(),
    role: 'admin',
  });
  upsertInMemoryUser({
    id: 'platform-user-1',
    name: 'User One',
    username: 'user',
    email: 'dakyayipah@gmail.com',
    password: process.env.DEV_USER_PASSWORD || randomUUID(),
    role: 'user',
  });
}



type PlanQuery = <T = any>(sql: string, params?: any[]) => Promise<{ rows: T[] }>;

async function getLocalPlanName(userId: string, query: PlanQuery): Promise<string> {
  const { rows } = await query<{ name: string }>(
    `SELECT pp.name FROM subscriptions s
     JOIN pricing_plans pp ON pp.id = s.plan_id
     WHERE s.user_id = $1 AND s.status IN ('active','trialing') AND (s.current_period_end IS NULL OR s.current_period_end > NOW())
     ORDER BY s.created_at DESC LIMIT 1`,
    [userId]
  );
  return rows[0]?.name ?? 'Free';
}

/** How long a DakyX grant is honoured after DakyX was last heard from. */
export const DAKYX_GRANT_STALE_HOURS = 72;

export type EffectivePlan = {
  name: string;
  tier: PlanTierKey;
  /** 'local' is a plan bought here; 'dakyx' is included with a DakyX retainer or comp. */
  source: 'local' | 'dakyx';
  reason?: string;
};

/**
 * The plan a person is on: the higher of what they bought here and what DakyX
 * grants them (a retainer includes every DakyX product). A grant is kept in
 * `plan_grants`, never in `subscriptions` — that table is this app's own
 * billing, one row per user, and a grant written there would be overwritten
 * by the first local purchase, or overwrite it. See server/dakyxRoutes.ts.
 */
export async function getEffectivePlan(userId: string, query?: PlanQuery): Promise<EffectivePlan> {
  if (!query && !hasDatabase()) return { name: 'Free', tier: 'free', source: 'local' };
  const run: PlanQuery = query ?? dbQuery;
  try {
    const [localName, grants] = await Promise.all([
      getLocalPlanName(userId, run),
      run<{ tier: string; reason: string }>(
        `SELECT tier, reason FROM plan_grants
         WHERE user_id = $1 AND source = 'dakyx'
           AND (valid_until IS NULL OR valid_until > NOW())
           AND synced_at > NOW() - ($2 || ' hours')::interval`,
        [userId, String(DAKYX_GRANT_STALE_HOURS)]
      ).catch(() => ({ rows: [] as Array<{ tier: string; reason: string }> })),
    ]);
    const local: EffectivePlan = { name: localName, tier: resolvePlanTierKey(localName), source: 'local' };
    const grant = grants.rows.find((row) => isPlanTierKey(row.tier));
    if (!grant || !isPlanTierKey(grant.tier)) return local;
    if (PLAN_TIER_ORDER.indexOf(grant.tier) <= PLAN_TIER_ORDER.indexOf(local.tier)) return local;
    return { name: PLAN_TIER_NAMES[grant.tier], tier: grant.tier, source: 'dakyx', reason: grant.reason };
  } catch (err) {
    logger.error('Unhandled error:', err);
    return { name: 'Free', tier: 'free', source: 'local' };
  }
}

/** The effective plan's name. Every quota check reads this, so a DakyX grant reaches all of them. */
export async function getUserPlanName(userId: string): Promise<string> {
  return (await getEffectivePlan(userId)).name;
}

export function userToAuthPayload(user: DbUserRow, planName?: string, planSource?: EffectivePlan['source']) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    name: user.full_name,
    website: user.website,
    phone: user.phone,
    country: user.country,
    role: user.role === 'admin' ? 'admin' : 'user',
    avatar: user.avatar_url,
    cover: user.cover_url,
    planName: planName ?? 'Free',
    planSource: planSource ?? 'local',
    emailVerified: user.email_verified ?? false,
  };
}

export const JWT_EXPIRES_IN = '7d';

export function signToken(userId: string, email: string, tokenVersion = 1) {
  return jwt.sign({ userId, email, tokenVersion }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function getAuthUser(req: Request) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (
      typeof decoded !== 'object' ||
      decoded === null ||
      typeof (decoded as Record<string, unknown>).userId !== 'string' ||
      !(decoded as Record<string, unknown>).userId
    ) {
      return null;
    }
    const payload = decoded as Record<string, unknown>;
    return {
      userId: payload.userId as string,
      email: typeof payload.email === 'string' ? payload.email : '',
      tokenVersion: typeof payload.tokenVersion === 'number' ? payload.tokenVersion : null,
    };
  } catch (err) {
    logger.error('Unhandled error:', err);
    return null;
  }
}

export async function findUserByEmail(email: string): Promise<DbUserRow | undefined> {
  const normalizedEmail = normalizeEmail(email);
  if (!hasDatabase()) {
    const userId = inMemoryUserIdByEmail.get(normalizedEmail);
    return userId ? inMemoryUsersById.get(userId) : undefined;
  }
  const result = await dbQuery<DbUserRow>('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
  return result.rows[0];
}

export async function findUserByUsername(username: string): Promise<DbUserRow | undefined> {
  const normalizedUsername = normalizeUsername(username);
  if (!hasDatabase()) {
    const userId = inMemoryUserIdByUsername.get(normalizedUsername);
    return userId ? inMemoryUsersById.get(userId) : undefined;
  }
  const result = await dbQuery<DbUserRow>('SELECT * FROM users WHERE LOWER(username) = $1', [normalizedUsername]);
  return result.rows[0];
}

export async function findUserByIdentifier(identifier: string): Promise<DbUserRow | undefined> {
  const normalized = identifier.trim();
  if (!normalized) return undefined;
  if (normalized.includes('@')) {
    return findUserByEmail(normalized);
  }
  return findUserByUsername(normalized);
}

export async function getUserById(id: string): Promise<DbUserRow | undefined> {
  if (!hasDatabase()) {
    return inMemoryUsersById.get(id);
  }
  const result = await dbQuery<DbUserRow>('SELECT * FROM users WHERE id = $1', [id]);
  return result.rows[0];
}

export async function createUser(
  name: string,
  username: string,
  email: string,
  password: string,
  options?: { role?: AdminDbRole; status?: AdminDbStatus; avatarUrl?: string | null; coverUrl?: string | null }
): Promise<DbUserRow> {
  const hash = await bcrypt.hash(password, 12);
  const id = randomUUID();
  const normalizedEmail = normalizeEmail(email);
  const normalizedUsername = normalizeUsername(username);

  if (!hasDatabase()) {
    const user: DbUserRow = {
      id,
      email: normalizedEmail,
      username: normalizedUsername,
      full_name: name || null,
      website: null,
      phone: null,
      country: null,
      role: options?.role || 'user',
      status: options?.status || 'active',
      avatar_url: options?.avatarUrl || null,
      cover_url: options?.coverUrl || null,
      last_login_at: null,
      password_hash: hash,
      token_version: 1,
      email_verified: false,
      failed_login_attempts: 0,
      locked_until: null,
      created_at: new Date().toISOString(),
    };
    inMemoryUsersById.set(id, user);
    inMemoryUserIdByEmail.set(normalizedEmail, id);
    inMemoryUserIdByUsername.set(normalizedUsername, id);
    return user;
  }

  const result = await dbQuery<DbUserRow>(
    'INSERT INTO users (id, email, username, password_hash, full_name, phone, country, role, status, avatar_url, cover_url, last_login_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *',
    [id, normalizedEmail, normalizedUsername, hash, name || null, null, null, options?.role || 'user', options?.status || 'active', options?.avatarUrl || null, options?.coverUrl || null, null]
  );
  return result.rows[0];
}

export async function updateLastLogin(userId: string) {
  if (!hasDatabase()) {
    const user = inMemoryUsersById.get(userId);
    if (!user) return;
    inMemoryUsersById.set(userId, { ...user, last_login_at: new Date().toISOString() });
    return;
  }
  await dbQuery('UPDATE users SET last_login_at = NOW() WHERE id = $1', [userId]);
}

export async function ensureSeedUser(input: {
  name: string;
  username: string;
  email: string;
  password: string;
  role: AdminDbRole;
  status?: AdminDbStatus;
}) {
  const existing = await findUserByUsername(input.username);
  if (existing) {
    return existing;
  }
  return createUser(input.name, input.username, input.email, input.password, {
    role: input.role,
    status: input.status || 'active',
  });
}

export async function ensureSeedUsers() {
  if (config.nodeEnv === 'production' || process.env.ALLOW_DEMO_DATA !== 'true') return;
  if (!hasDatabase()) {
    seedInMemoryUsers();
    return;
  }

  await ensureSeedUser({
    name: 'Dan Ayipah',
    username: 'daky',
    email: 'danayipah@gmail.com',
    password: process.env.DEV_ADMIN_PASSWORD || randomUUID(),
    role: 'admin',
  });
  await ensureSeedUser({
    name: 'User One',
    username: 'user',
    email: 'dakyayipah@gmail.com',
    password: process.env.DEV_USER_PASSWORD || randomUUID(),
    role: 'user',
  });
}

export async function ensureSeedPricingPlans() {
  const plans = [
    {
      name: 'Free',
      description: 'For creators exploring AI content with no commitment.',
      monthlyPrice: 0,
      yearlyPrice: 0,
      monthlyFeatures: [
        '100 AI credits per month',
        '2 social accounts',
        'AI text generation (✦1 per post)',
        'Content calendar',
        '20+ card templates',
        'Basic analytics',
        '1 team seat',
      ],
      yearlyFeatures: [
        '100 AI credits per month',
        '2 social accounts',
        'AI text generation (✦1 per post)',
        'Content calendar',
        '20+ card templates',
        'Basic analytics',
        '1 team seat',
      ],
    },
    {
      name: 'Pro',
      description: 'For active brands and creators that need real AI power to publish at scale.',
      monthlyPrice: 29,
      yearlyPrice: 276,
      featured: true,
      monthlyFeatures: [
        '2,000 AI credits per month',
        '8 social accounts',
        'AI image generation — 6 models (✦3–8)',
        'Improve Prompt AI feature',
        'Custom brand voice',
        'Bulk scheduling & auto-republish',
        'Advanced analytics & audience insights',
        '200+ card templates + custom templates',
        '3 team seats',
        'Priority support',
      ],
      yearlyFeatures: [
        '2,000 AI credits per month',
        '8 social accounts',
        'AI image generation — 6 models (✦3–8)',
        'Improve Prompt AI feature',
        'Custom brand voice',
        'Bulk scheduling & auto-republish',
        'Advanced analytics & audience insights',
        '200+ card templates + custom templates',
        '3 team seats',
        'Priority support',
        'Save ~20% vs monthly billing',
      ],
    },
    {
      name: 'Agency',
      description: 'For agencies and power users running full-stack content operations.',
      monthlyPrice: 79,
      yearlyPrice: 756,
      monthlyFeatures: [
        '6,000 AI credits per month',
        'Unlimited social accounts',
        'AI video generation — 3 models (✦20–35)',
        'Full image editing suite (✦1–5)',
        'Premium AI models — Mystic (✦8)',
        'White-label exports',
        'Client workspaces (up to 10)',
        'API access',
        'Dedicated support',
        '10 team seats',
      ],
      yearlyFeatures: [
        '6,000 AI credits per month',
        'Unlimited social accounts',
        'AI video generation — 3 models (✦20–35)',
        'Full image editing suite (✦1–5)',
        'Premium AI models — Mystic (✦8)',
        'White-label exports',
        'Client workspaces (up to 10)',
        'API access',
        'Dedicated support',
        '10 team seats',
        'Save ~20% vs monthly billing',
      ],
    },
    {
      name: 'Enterprise / Dakyworld OS Pro',
      description: 'For multi-brand operators & Dakyworld OS nodes requiring full autonomous AI orchestration.',
      monthlyPrice: 199,
      yearlyPrice: 1908,
      monthlyFeatures: [
        '25,000 AI credits per month + Auto-Recharge',
        'Full Dakyworld OS Bidirectional Bridge (/api/v1/os/*)',
        '21 Autonomous Specialist AI Agents + Brand Vault',
        'High-throughput API Rate Limit (1,200 req/min)',
        'Outbound HMAC-SHA256 OS Webhooks & Event Stream',
        'Unlimited social accounts & client workspaces',
        'AI Sales OS (Autonomous Outbound Caller + Objection Mining)',
        'White-label executive PDF/Excel reporting',
        '25 team seats + priority SLA',
      ],
      yearlyFeatures: [
        '25,000 AI credits per month + Auto-Recharge',
        'Full Dakyworld OS Bidirectional Bridge (/api/v1/os/*)',
        '21 Autonomous Specialist AI Agents + Brand Vault',
        'High-throughput API Rate Limit (1,200 req/min)',
        'Outbound HMAC-SHA256 OS Webhooks & Event Stream',
        'Unlimited social accounts & client workspaces',
        'AI Sales OS (Autonomous Outbound Caller + Objection Mining)',
        'White-label executive PDF/Excel reporting',
        '25 team seats + priority SLA',
        'Save ~20% vs monthly billing',
      ],
    },
  ];

  if (!hasDatabase()) {
    // Seed in-memory pricing plans
    const now = new Date().toISOString();
    plans.forEach((plan) => {
      const monthlyId = randomUUID();
      const yearlyId = randomUUID();

      inMemoryPricingPlansById.set(monthlyId, {
        id: monthlyId,
        name: `${plan.name} (Monthly)`,
        description: plan.description,
        price: plan.monthlyPrice,
        billing_period: 'monthly',
        features: plan.monthlyFeatures,
        is_active: true,
        discount_percentage: 0,
        is_on_sale: false,
        created_at: now,
        updated_at: now,
      });

      inMemoryPricingPlansById.set(yearlyId, {
        id: yearlyId,
        name: `${plan.name} (Yearly)`,
        description: plan.description,
        price: plan.yearlyPrice,
        billing_period: 'yearly',
        features: plan.yearlyFeatures,
        is_active: true,
        discount_percentage: 20,
        is_on_sale: true,
        created_at: now,
        updated_at: now,
      });
    });
    logger.info(`Seeded ${inMemoryPricingPlansById.size} pricing plans in-memory`);
    return;
  }

  // Check if plans already exist
  const existing = await dbQuery<{ count: number }>(
    'SELECT COUNT(*) as count FROM pricing_plans'
  );

  if (existing.rows[0]?.count > 0) {
    logger.info('Pricing plans already seeded in database');
    return; // Plans already seeded
  }

  const now = new Date().toISOString();

  for (const plan of plans) {
    const monthlyId = randomUUID();
    const yearlyId = randomUUID();

    await dbQuery(
      'INSERT INTO pricing_plans (id, name, description, price, billing_period, features, is_active, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [
        monthlyId,
        `${plan.name} (Monthly)`,
        plan.description,
        plan.monthlyPrice,
        'monthly',
        plan.monthlyFeatures,
        true,
        now,
        now,
      ]
    );

    await dbQuery(
      'INSERT INTO pricing_plans (id, name, description, price, billing_period, features, is_active, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [
        yearlyId,
        `${plan.name} (Yearly)`,
        plan.description,
        plan.yearlyPrice,
        'yearly',
        plan.yearlyFeatures,
        true,
        now,
        now,
      ]
    );
  }
  logger.info(`Seeded 6 pricing plans in database (${plans.length} plan types)`);
}

export async function updateUserProfile(
  userId: string,
  updates: {
    name: string;
    username: string;
    email: string;
    phone: string;
    country: string;
    website: string;
    avatar?: string;
    cover?: string;
  }
): Promise<DbUserRow | undefined> {
  const normalizedEmail = normalizeEmail(updates.email);
  const normalizedUsername = normalizeUsername(updates.username);
  const normalizedPhone = updates.phone.trim();
  const normalizedCountry = updates.country.trim();
  const normalizedName = updates.name.trim();
  const normalizedWebsite = updates.website.trim();

  if (!hasDatabase()) {
    const existing = inMemoryUsersById.get(userId);
    if (!existing) return undefined;

    const byEmail = inMemoryUserIdByEmail.get(normalizedEmail);
    if (byEmail && byEmail !== userId) {
      throw new Error('Email is already in use');
    }
    const byUsername = inMemoryUserIdByUsername.get(normalizedUsername);
    if (byUsername && byUsername !== userId) {
      throw new Error('Username is already in use');
    }

    inMemoryUserIdByEmail.delete(normalizeEmail(existing.email));
    if (existing.username) {
      inMemoryUserIdByUsername.delete(normalizeUsername(existing.username));
    }

    const nextUser: DbUserRow = {
      ...existing,
      email: normalizedEmail,
      username: normalizedUsername,
      full_name: normalizedName || null,
      website: normalizedWebsite || null,
      phone: normalizedPhone || null,
      country: normalizedCountry || null,
      avatar_url: typeof updates.avatar === 'string' ? updates.avatar || null : existing.avatar_url,
      cover_url: typeof updates.cover === 'string' ? updates.cover || null : existing.cover_url,
    };

    inMemoryUsersById.set(userId, nextUser);
    inMemoryUserIdByEmail.set(normalizedEmail, userId);
    inMemoryUserIdByUsername.set(normalizedUsername, userId);
    return nextUser;
  }

  const duplicateEmail = await dbQuery<{ id: string }>('SELECT id FROM users WHERE email = $1 AND id <> $2', [
    normalizedEmail,
    userId,
  ]);
  if (duplicateEmail.rowCount) {
    throw new Error('Email is already in use');
  }

  const duplicateUsername = await dbQuery<{ id: string }>(
    'SELECT id FROM users WHERE LOWER(username) = $1 AND id <> $2',
    [normalizedUsername, userId]
  );
  if (duplicateUsername.rowCount) {
    throw new Error('Username is already in use');
  }

  const result = await dbQuery<DbUserRow>(
    `
    UPDATE users
    SET email = $1,
        username = $2,
        full_name = $3,
        website = $4,
        phone = $5,
        country = $6,
        avatar_url = COALESCE($7, avatar_url),
        cover_url = COALESCE($8, cover_url)
    WHERE id = $9
    RETURNING *;
  `,
    [
      normalizedEmail,
      normalizedUsername,
      normalizedName || null,
      normalizedWebsite || null,
      normalizedPhone || null,
      normalizedCountry || null,
      typeof updates.avatar === 'string' ? updates.avatar || null : null,
      typeof updates.cover === 'string' ? updates.cover || null : null,
      userId,
    ]
  );

  return result.rows[0];
}

export function requireAuth(req: Request, res: Response): { userId: string; email: string; role: string; tokenVersion: number | null } | null {
  const auth = getAuthUser(req);
  if (!auth) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return null;
  }
  return { ...auth, role: (req as Request & { authRole?: string }).authRole || 'user' };
}

// Validates that the token_version embedded in the JWT matches the DB.
// Returns false and sends 401 if mismatched (user ran logout-all-devices).
export async function checkTokenVersion(auth: { userId: string; tokenVersion: number | null }, res: Response): Promise<boolean> {
  if (auth.tokenVersion === null || !hasDatabase()) return true; // old tokens without version — allow through
  try {
    const { rows } = await dbQuery<{ token_version: number }>(
      `SELECT token_version FROM users WHERE id = $1`,
      [auth.userId]
    );
    if (!rows[0]) { res.status(401).json({ success: false, error: 'Unauthorized' }); return false; }
    if (rows[0].token_version !== auth.tokenVersion) {
      res.status(401).json({ success: false, error: 'Session has been revoked. Please log in again.' });
      return false;
    }
    return true;
  } catch (err) {
    logger.error('Unhandled error:', err);
    res.status(503).json({ success: false, error: 'Authentication service unavailable' });
    return false;
  }
}

export async function requireAdmin(req: Request, res: Response): Promise<(DbUserRow & { userId: string }) | null> {
  const auth = requireAuth(req, res);
  if (!auth) return null;
  // Admin routes require DB access — fail-closed if DB is unavailable so a
  // revoked session can't slip through when the DB is down.
  if (!hasDatabase()) {
    res.status(503).json({ success: false, error: 'Admin operations require a database connection.' });
    return null;
  }
  const user = await getUserById(auth.userId);
  if (!user || user.role !== 'admin' || user.status !== 'active') {
    res.status(403).json({ success: false, error: 'Admin access required' });
    return null;
  }
  // Always validate token_version for admin operations.
  if (auth.tokenVersion !== null && user.token_version !== auth.tokenVersion) {
    res.status(401).json({ success: false, error: 'Session has been revoked. Please log in again.' });
    return null;
  }
  return { ...user, userId: user.id };
}

export const ORG_ROLE_RANK: Record<string, number> = { owner: 4, admin: 3, editor: 2, viewer: 1 };

export async function requireOrgMembership(
  req: Request,
  res: Response,
  orgId: string,
  minRole: 'viewer' | 'editor' | 'admin' | 'owner' = 'viewer'
): Promise<{ userId: string; role: string } | null> {
  const auth = requireAuth(req, res);
  if (!auth) return null;
  if (!hasDatabase()) { res.status(503).json({ success: false, error: 'Database unavailable' }); return null; }
  const { rows } = await dbQuery(
    `SELECT role FROM organization_memberships WHERE org_id = $1 AND user_id = $2`,
    [orgId, auth.userId]
  );
  if (!rows.length || (ORG_ROLE_RANK[rows[0].role] ?? 0) < (ORG_ROLE_RANK[minRole] ?? 0)) {
    res.status(403).json({ success: false, error: 'Not authorized for this organization' });
    return null;
  }
  return { userId: auth.userId, role: rows[0].role as string };
}
