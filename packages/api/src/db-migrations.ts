import { SCHEMA_SOURCE_HASH, REQUIRED_SCHEMA_TABLES } from './schema-fingerprint.ts';
import { createHash } from 'crypto';
import type { Pool } from 'pg';
import { logger } from './logger.ts';

// The "User One" 1M-credit top-up is a test-environment convenience. It must
// be explicitly opted into: without this flag, a production signup that
// happens to be named "User One" would receive free credits on every deploy.
export function isTestUserCreditGrantEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ENABLE_TEST_USER_CREDITS === 'true';
}

export const BASE_SCHEMA_VERSION = '2026.09.23-v2-core';
export function computeMigrationChecksum(versionTag: string): string {
  return createHash('sha256').update(`contentflow-schema:${versionTag}:${SCHEMA_SOURCE_HASH}`).digest('hex');
}

export async function runDatabaseMigrations(pool: Pool): Promise<void> {
  const client=await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(18473021)');
    await runDatabaseMigrationsUnlocked(client as unknown as Pool);
    const result=await client.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`);
    const present=new Set(result.rows.map(row=>row.table_name));
    const missing=REQUIRED_SCHEMA_TABLES.filter(name=>!present.has(name));
    if(missing.length) throw new Error(`Database migration did not create required tables: ${missing.join(', ')}`);
    await client.query(`INSERT INTO schema_migrations(version,checksum) VALUES($1,$2) ON CONFLICT(version) DO UPDATE SET checksum=EXCLUDED.checksum`, [BASE_SCHEMA_VERSION,computeMigrationChecksum(BASE_SCHEMA_VERSION)]);
  } finally { await client.query('SELECT pg_advisory_unlock(18473021)');client.release(); }
}

async function runDatabaseMigrationsUnlocked(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `).catch(() => undefined);

  const baseChecksum = computeMigrationChecksum(BASE_SCHEMA_VERSION);
  const existingBase = await pool.query(
    `SELECT checksum FROM schema_migrations WHERE version = $1 LIMIT 1`,
    [BASE_SCHEMA_VERSION]
  ).catch(() => ({ rows: [] as Array<{ checksum: string }> }));

  if (existingBase.rows[0]?.checksum === baseChecksum && process.env.FORCE_FULL_MIGRATIONS !== 'true') {
    await runIncrementalUpgradeMigrations(pool);
    logger.info({ version: BASE_SCHEMA_VERSION }, 'Skipped base DDL (checksum matched); applied incremental upgrade migrations');
    return;
  }

await pool.query(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    username TEXT,
    password_hash TEXT NOT NULL,
    full_name TEXT,
    website TEXT,
    phone TEXT,
    country TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`);

await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;`);
await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS website TEXT;`);
await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;`);
await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS country TEXT;`);
await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';`);
await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';`);
await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;`);
await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS cover_url TEXT;`);
await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;`);
// onboarding: wizard answers + completed_at/skipped_at so the wizard never re-shows across devices
await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding JSONB NOT NULL DEFAULT '{}'::jsonb;`);
await pool.query(`
  CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique_idx
  ON users (LOWER(username))
  WHERE username IS NOT NULL;
`);

// token_version: increment to invalidate all sessions for a user (logout-all-devices)
await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 1;`);
// email_verified: set to true after the user confirms their email
await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;`);
// account lockout: track consecutive failures and lock after threshold
await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0;`);
await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;`);

await pool.query(`
  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS pwd_reset_user_idx ON password_reset_tokens(user_id);
`);

await pool.query(`
  CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS email_verif_user_idx ON email_verification_tokens(user_id);
`);

await pool.query(`
  CREATE TABLE IF NOT EXISTS oauth_states (
    state TEXT PRIMARY KEY,
    user_id TEXT,
    platform TEXT NOT NULL,
    return_to TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '15 minutes')
  );
`);

await pool.query(`ALTER TABLE oauth_states ADD COLUMN IF NOT EXISTS return_to TEXT;`).catch(() => undefined);
await pool.query(`ALTER TABLE oauth_states ADD COLUMN IF NOT EXISTS code_verifier TEXT;`).catch(() => undefined);

// Social Automation v2 schema (platform registry + richer account metadata)
// CREATE social_platforms FIRST before social_accounts (which has a FK to it)
await pool.query(`
  CREATE TABLE IF NOT EXISTS social_platforms (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    api_base_url TEXT,
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`);
await pool.query(
  `INSERT INTO social_platforms (name, slug, api_base_url, enabled)
   VALUES 
    ('Facebook', 'facebook', 'https://graph.facebook.com', true),
    ('Instagram', 'instagram', 'https://graph.instagram.com', true),
    ('LinkedIn', 'linkedin', 'https://api.linkedin.com', true),
    ('X (Twitter)', 'twitter', 'https://api.twitter.com', true),
    ('Pinterest', 'pinterest', 'https://api.pinterest.com', true),
    ('TikTok', 'tiktok', 'https://api.tiktok.com', true),
    ('Threads', 'threads', 'https://graph.threads.net', true)
   ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name, api_base_url=EXCLUDED.api_base_url;`
).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS social_accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    platform_id BIGINT REFERENCES social_platforms(id) ON DELETE SET NULL,
    account_type TEXT,
    account_id TEXT,
    account_name TEXT,
    profile_image TEXT,
    handle TEXT,
    followers INTEGER DEFAULT 0,
    connected BOOLEAN DEFAULT TRUE,
    connected_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    token_expires_at TIMESTAMPTZ,
    access_token TEXT,
    refresh_token TEXT,
    access_token_encrypted TEXT,
    refresh_token_encrypted TEXT,
    token_data JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`);

// Migrate: remove legacy uniqueness constraint so users can save multiple accounts per platform.
await pool.query(`ALTER TABLE social_accounts DROP CONSTRAINT IF EXISTS social_accounts_user_id_platform_key;`).catch(() => undefined);
// Ensure a single OAuth profile token row per (user, platform).
await pool.query(
  `CREATE UNIQUE INDEX IF NOT EXISTS social_accounts_user_platform_profile_unique_idx
   ON social_accounts (user_id, platform)
   WHERE account_type = 'profile';`
).catch(() => undefined);
// Prevent duplicate saved targets per (user, platform, type, id).
await pool.query(
  `CREATE UNIQUE INDEX IF NOT EXISTS social_accounts_user_platform_account_unique_idx
   ON social_accounts (user_id, platform, account_type, account_id)
   WHERE account_id IS NOT NULL AND account_type IS NOT NULL;`
).catch(() => undefined);

// social_platforms and platform_id columns already created above, now just handle migrations
await pool.query(`ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS platform_id BIGINT REFERENCES social_platforms(id) ON DELETE SET NULL;`).catch(() => undefined);
await pool.query(`ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS account_type TEXT;`).catch(() => undefined);
await pool.query(`ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS account_id TEXT;`).catch(() => undefined);
await pool.query(`ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS account_name TEXT;`).catch(() => undefined);
await pool.query(`ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS profile_image TEXT;`).catch(() => undefined);
await pool.query(`ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ;`).catch(() => undefined);
await pool.query(`ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();`).catch(() => undefined);
await pool.query(`ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS access_token_encrypted TEXT;`).catch(() => undefined);
await pool.query(`ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS refresh_token_encrypted TEXT;`).catch(() => undefined);
await pool.query(`ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS needs_reapproval BOOLEAN DEFAULT FALSE;`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS social_accounts_user_platform_idx ON social_accounts (user_id, platform_id);`).catch(() => undefined);

// Best-effort backfill of `platform_id` for existing connections.
await pool.query(
  `UPDATE social_accounts sa
   SET platform_id = sp.id
   FROM social_platforms sp
   WHERE sa.platform_id IS NULL
     AND LOWER(sa.platform) = sp.slug;`
).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS social_connections (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    social_account_id TEXT NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`);
await pool.query(`CREATE INDEX IF NOT EXISTS social_connections_user_idx ON social_connections (user_id);`).catch(() => undefined);
await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS social_connections_user_account_unique_idx ON social_connections (user_id, social_account_id);`).catch(() => undefined);

// Admin OAuth/app credentials (separate from platform_configs/auth_providers legacy tables)
await pool.query(`
  CREATE TABLE IF NOT EXISTS integrations (
    id BIGSERIAL PRIMARY KEY,
    provider TEXT NOT NULL,
    name TEXT,
    slug TEXT,
    type TEXT,
    client_id TEXT,
    client_secret TEXT,
    redirect_url TEXT,
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`);
await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS integrations_provider_unique_idx ON integrations (LOWER(provider));`).catch(() => undefined);
await pool.query(`ALTER TABLE integrations ADD COLUMN IF NOT EXISTS name TEXT;`).catch(() => undefined);
await pool.query(`ALTER TABLE integrations ADD COLUMN IF NOT EXISTS slug TEXT;`).catch(() => undefined);
await pool.query(`ALTER TABLE integrations ADD COLUMN IF NOT EXISTS type TEXT;`).catch(() => undefined);
await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS integrations_slug_unique_idx ON integrations (slug);`).catch(() => undefined);
await pool.query(`UPDATE integrations SET slug = LOWER(COALESCE(slug, provider)) WHERE slug IS NOT NULL OR provider IS NOT NULL;`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS user_integrations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    integration_id BIGINT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
    access_token TEXT,
    refresh_token TEXT,
    token_expiry TIMESTAMPTZ,
    account_id TEXT,
    account_name TEXT,
    status TEXT NOT NULL DEFAULT 'connected',
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`);
await pool.query(`CREATE INDEX IF NOT EXISTS user_integrations_user_id_idx ON user_integrations (user_id);`).catch(() => undefined);
await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS user_integrations_user_integration_unique_idx ON user_integrations (user_id, integration_id);`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS integration_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    integration_id BIGINT REFERENCES integrations(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    status TEXT NOT NULL,
    response JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`);
await pool.query(`CREATE INDEX IF NOT EXISTS integration_logs_user_idx ON integration_logs (user_id);`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS integration_logs_integration_idx ON integration_logs (integration_id);`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS data_deletion_requests (
    code TEXT PRIMARY KEY,
    platform TEXT NOT NULL DEFAULT 'meta',
    meta_user_id TEXT,
    status TEXT NOT NULL DEFAULT 'received',
    payload JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
  );
`);
await pool.query(`
  CREATE INDEX IF NOT EXISTS data_deletion_requests_meta_user_id_idx
  ON data_deletion_requests (meta_user_id);
`);

await pool.query(`
  CREATE TABLE IF NOT EXISTS wordpress_connections (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    site_url TEXT NOT NULL,
    username TEXT NOT NULL,
    app_password_encrypted TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id)
  );
`);

await pool.query(`
  CREATE TABLE IF NOT EXISTS make_webhook_connections (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    webhook_url_encrypted TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id)
  );
`);

await pool.query(`
  CREATE TABLE IF NOT EXISTS pricing_plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    billing_period TEXT NOT NULL DEFAULT 'monthly',
    features TEXT[] DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE,
    discount_percentage DECIMAL(5,2) DEFAULT 0,
    is_on_sale BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS card_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    design_data JSON NOT NULL,
    cover_image_url TEXT,
    is_published BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`);

await pool.query(`
  CREATE TABLE IF NOT EXISTS platform_configs (
    platform TEXT PRIMARY KEY,
    config JSONB NOT NULL DEFAULT '{}',
    enabled BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`);
await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS platform_configs_platform_unique_idx ON platform_configs (platform);`).catch(() => undefined);
await pool.query(`
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'platform_configs'::regclass
        AND contype = 'u'
        AND conname = 'platform_configs_platform_key'
    ) THEN
      ALTER TABLE platform_configs ADD CONSTRAINT platform_configs_platform_key UNIQUE (platform);
    END IF;
  END
  $$;
`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS user_settings (
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, key)
  );
  CREATE INDEX IF NOT EXISTS user_settings_user_id_idx ON user_settings (user_id);

  CREATE TABLE IF NOT EXISTS auth_providers (
    provider TEXT PRIMARY KEY,
    config JSONB NOT NULL DEFAULT '{}',
    enabled BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS payment_transactions (
    id TEXT PRIMARY KEY,
    amount NUMERIC(12,2) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'GHS',
    description TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    provider TEXT NOT NULL DEFAULT 'hubtel',
    client_reference TEXT UNIQUE,
    provider_reference TEXT,
    customer_name TEXT,
    customer_email TEXT,
    customer_phone TEXT,
    checkout_url TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`);

await pool.query(`
  CREATE TABLE IF NOT EXISTS page_content (
    slug TEXT PRIMARY KEY,
    content JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`);

// Migrate: add discount columns to existing pricing_plans tables
await pool.query(`
  ALTER TABLE pricing_plans ADD COLUMN IF NOT EXISTS discount_percentage DECIMAL(5,2) DEFAULT 0;
  ALTER TABLE pricing_plans ADD COLUMN IF NOT EXISTS is_on_sale BOOLEAN DEFAULT FALSE;
`).catch(() => { /* ignore if columns already exist or table doesn't exist yet */ });

await pool.query(`
  CREATE TABLE IF NOT EXISTS user_designs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT 'Untitled Design',
    canvas_width INTEGER NOT NULL DEFAULT 1080,
    canvas_height INTEGER NOT NULL DEFAULT 1080,
    canvas_data JSONB NOT NULL DEFAULT '{}',
    thumbnail_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`);

await pool.query(`
  CREATE TABLE IF NOT EXISTS media_images (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    original_name TEXT NOT NULL,
    file_size INTEGER NOT NULL DEFAULT 0,
    file_type TEXT NOT NULL DEFAULT 'image/jpeg',
    width INTEGER,
    height INTEGER,
    upload_date TIMESTAMPTZ DEFAULT NOW(),
    url TEXT NOT NULL,
    thumbnail_url TEXT,
    alt_text TEXT DEFAULT '',
    caption TEXT DEFAULT '',
    description TEXT DEFAULT '',
    tags TEXT[] DEFAULT '{}',
    used_in JSONB DEFAULT '[]',
    category TEXT DEFAULT 'user'
  );
`);
await pool.query(`ALTER TABLE media_images ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'user'`);
// Fix: non-admin users could previously self-assign category='admin' via upload body.
// Reset all non-admin-owned rows that were incorrectly marked as 'admin' shared assets.
await pool.query(
  `UPDATE media_images SET category='user' WHERE category='admin' AND user_id NOT IN (SELECT id FROM users WHERE role='admin')`
).catch(() => undefined);
await pool.query(`ALTER TABLE media_images ADD COLUMN IF NOT EXISTS alt_text TEXT DEFAULT ''`).catch(() => undefined);
await pool.query(`ALTER TABLE media_images ADD COLUMN IF NOT EXISTS caption TEXT DEFAULT ''`).catch(() => undefined);
await pool.query(`ALTER TABLE media_images ADD COLUMN IF NOT EXISTS description TEXT DEFAULT ''`).catch(() => undefined);
await pool.query(`
  CREATE TABLE IF NOT EXISTS media_image_links (
    id TEXT PRIMARY KEY,
    media_image_id TEXT NOT NULL REFERENCES media_images(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_table TEXT NOT NULL,
    source_id TEXT NOT NULL,
    source_field TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, media_image_id, source_table, source_id, source_field)
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS media_images_user_upload_idx ON media_images (user_id, upload_date DESC)`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS media_images_category_upload_idx ON media_images (category, upload_date DESC)`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS media_images_user_url_idx ON media_images (user_id, url)`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS media_image_links_user_source_idx ON media_image_links (user_id, source_table, source_id, source_field)`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS media_image_links_media_idx ON media_image_links (media_image_id)`).catch(() => undefined);

// ── Credits & Likes (additive migrations) ────────────────────────────────────
await pool.query(`
  CREATE TABLE IF NOT EXISTS user_credits (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    credits INTEGER NOT NULL DEFAULT 0,
    reset_date TIMESTAMPTZ NOT NULL DEFAULT (date_trunc('month', NOW()) + INTERVAL '1 month'),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS design_likes (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    design_id TEXT NOT NULL,
    design_type TEXT NOT NULL DEFAULT 'user',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, design_id)
  )
`).catch(() => undefined);

await pool.query(`ALTER TABLE card_templates ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0`).catch(() => undefined);
await pool.query(`ALTER TABLE card_templates ADD COLUMN IF NOT EXISTS like_count INTEGER NOT NULL DEFAULT 0`).catch(() => undefined);
await pool.query(`ALTER TABLE pricing_plans ADD COLUMN IF NOT EXISTS credits_per_month INTEGER NOT NULL DEFAULT 0`).catch(() => undefined);
await pool.query(`ALTER TABLE user_designs ADD COLUMN IF NOT EXISTS like_count INTEGER NOT NULL DEFAULT 0`).catch(() => undefined);
await pool.query(`ALTER TABLE user_designs ADD COLUMN IF NOT EXISTS media_type TEXT NOT NULL DEFAULT 'image'`).catch(() => undefined);

// Update existing pricing plans with credit allocations (idempotent — only sets if 0)
await pool.query(`UPDATE pricing_plans SET credits_per_month = 100  WHERE name ILIKE '%free%'    AND credits_per_month = 0`).catch(() => undefined);
await pool.query(`UPDATE pricing_plans SET credits_per_month = 100  WHERE name ILIKE '%starter%' AND credits_per_month = 0`).catch(() => undefined);
await pool.query(`UPDATE pricing_plans SET credits_per_month = 2000 WHERE name ILIKE '%pro%'     AND credits_per_month = 0`).catch(() => undefined);
await pool.query(`UPDATE pricing_plans SET credits_per_month = 2000 WHERE name ILIKE '%growth%'  AND credits_per_month = 0`).catch(() => undefined);
await pool.query(`UPDATE pricing_plans SET credits_per_month = 6000 WHERE name ILIKE '%agency%'  AND credits_per_month = 0`).catch(() => undefined);
await pool.query(`UPDATE pricing_plans SET credits_per_month = 6000 WHERE name ILIKE '%scale%'   AND credits_per_month = 0`).catch(() => undefined);
// ── end Credits & Likes ───────────────────────────────────────────────────────

// Seed integrations registry (best-effort; idempotent)
await pool.query(
  `INSERT INTO integrations (provider, name, slug, type, enabled)
   VALUES
    ('wordpress','WordPress','wordpress','cms', true),
    ('facebook','Facebook','facebook','social', true),
    ('instagram','Instagram','instagram','social', true),
    ('linkedin','LinkedIn','linkedin','social', true),
    ('twitter','X (Twitter)','twitter','social', true),
    ('pinterest','Pinterest','pinterest','social', true),
    ('mailchimp','Mailchimp','mailchimp','marketing', true),
    ('gmail','Gmail','gmail','messaging', true),
    ('slack','Slack','slack','messaging', true),
    ('whatsapp','WhatsApp','whatsapp','messaging', true),
    ('zoom','Zoom','zoom','messaging', true)
   ON CONFLICT (slug) DO UPDATE
    SET name = EXCLUDED.name, provider = EXCLUDED.provider, type = EXCLUDED.type;`
).catch(() => undefined);

// Blog post management tables
await pool.query(`
  CREATE TABLE IF NOT EXISTS blog_categories (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`);
await pool.query(`
  CREATE TABLE IF NOT EXISTS blog_tags (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`);
await pool.query(`
  CREATE TABLE IF NOT EXISTS blog_posts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '',
    slug TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    excerpt TEXT DEFAULT '',
    featured_image TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',
    category_id TEXT REFERENCES blog_categories(id) ON DELETE SET NULL,
    meta_title TEXT DEFAULT '',
    meta_description TEXT DEFAULT '',
    focus_keyword TEXT DEFAULT '',
    social_title TEXT DEFAULT '',
    social_description TEXT DEFAULT '',
    social_image TEXT DEFAULT '',
    scheduled_at TIMESTAMPTZ,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`);

await pool.query(`ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS social_automation JSONB DEFAULT '{}'::jsonb;`).catch(() => undefined);
await pool.query(`
  CREATE TABLE IF NOT EXISTS link_metadata (
    id TEXT PRIMARY KEY,
    url TEXT UNIQUE NOT NULL,
    title TEXT DEFAULT '',
    description TEXT DEFAULT '',
    image TEXT,
    fetched_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
  );
`);
await pool.query(`CREATE INDEX IF NOT EXISTS link_metadata_url_idx ON link_metadata (url);`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS link_metadata_expires_idx ON link_metadata (expires_at);`).catch(() => undefined);
await pool.query(`
  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    post_ids JSONB DEFAULT '[]'::jsonb,
    changes JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`);
await pool.query(`
  CREATE TABLE IF NOT EXISTS blog_post_tags (
    post_id TEXT NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES blog_tags(id) ON DELETE CASCADE,
    PRIMARY KEY (post_id, tag_id)
  );
`);

// Social Templates: per-user per-platform template settings + share frequency tracking
await pool.query(`
  CREATE TABLE IF NOT EXISTS social_template_settings (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    content_source TEXT NOT NULL DEFAULT 'EXCERPT',
    template_string TEXT NOT NULL DEFAULT '{title}\n\n{content}\n\n{url}\n\n{tags}',
    status_limit INTEGER NOT NULL DEFAULT 280,
    max_status_limit INTEGER NOT NULL DEFAULT 280,
    share_limit_per_post INTEGER NOT NULL DEFAULT 0,
    add_categories_as_tags BOOLEAN NOT NULL DEFAULT false,
    remove_css BOOLEAN NOT NULL DEFAULT false,
    show_thumbnail BOOLEAN NOT NULL DEFAULT false,
    add_image_link BOOLEAN NOT NULL DEFAULT false,
    content_type TEXT,
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, platform)
  );
`);
await pool.query(`CREATE INDEX IF NOT EXISTS social_template_settings_user_idx ON social_template_settings (user_id);`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS post_share_counts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id TEXT NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    share_count INTEGER NOT NULL DEFAULT 0,
    last_shared_at TIMESTAMPTZ,
    UNIQUE (user_id, post_id, platform)
  );
`);
await pool.query(
  `CREATE INDEX IF NOT EXISTS post_share_counts_user_post_platform_idx ON post_share_counts (user_id, post_id, platform);`
).catch(() => undefined);

// Social Automation v2: per-post settings + targets + logs
await pool.query(`
  CREATE TABLE IF NOT EXISTS social_post_settings (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
    template TEXT DEFAULT '',
    publish_type TEXT NOT NULL DEFAULT 'immediate',
    scheduled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`);
await pool.query(
  `ALTER TABLE social_post_settings
   ADD CONSTRAINT social_post_settings_publish_type_chk
   CHECK (publish_type IN ('immediate','scheduled','delayed'))`
).catch(() => undefined);
await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS social_post_settings_post_unique_idx ON social_post_settings (post_id);`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS social_post_targets (
    id TEXT PRIMARY KEY,
    social_post_id TEXT NOT NULL REFERENCES social_post_settings(id) ON DELETE CASCADE,
    social_account_id TEXT NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT true
  );
`);
await pool.query(`CREATE INDEX IF NOT EXISTS social_post_targets_post_idx ON social_post_targets (social_post_id);`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS social_post_logs (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
    social_account_id TEXT REFERENCES social_accounts(id) ON DELETE SET NULL,
    platform TEXT NOT NULL,
    status TEXT NOT NULL,
    api_response JSONB,
    posted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`);
await pool.query(`CREATE INDEX IF NOT EXISTS social_post_logs_post_idx ON social_post_logs (post_id);`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS publishing_logs (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    platform_post_id TEXT,
    account TEXT,
    error_message TEXT,
    response JSONB,
    scheduled_for TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`);

await pool.query(`ALTER TABLE publishing_logs ADD COLUMN IF NOT EXISTS account TEXT;`).catch(() => undefined);
await pool.query(`ALTER TABLE publishing_logs ADD COLUMN IF NOT EXISTS response JSONB;`).catch(() => undefined);
await pool.query(`ALTER TABLE publishing_logs ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;`).catch(() => undefined);
await pool.query(`ALTER TABLE publishing_logs ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ;`).catch(() => undefined);
// Ensure post_id FK exists so deleting a blog post cascades to its publishing logs
await pool.query(`
  ALTER TABLE publishing_logs
  ADD CONSTRAINT publishing_logs_post_fk
  FOREIGN KEY (post_id) REFERENCES blog_posts(id) ON DELETE CASCADE
  NOT VALID;
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS publishing_logs_post_idx ON publishing_logs (post_id);`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS social_automation_tasks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id TEXT NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    run_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled',
    payload JSONB DEFAULT '{}'::jsonb,
    log_id TEXT,
    attempts INTEGER DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`);
await pool.query(`CREATE INDEX IF NOT EXISTS social_automation_tasks_due_idx ON social_automation_tasks (status, run_at);`).catch(() => undefined);
await pool.query(`
  CREATE TABLE IF NOT EXISTS platform_rate_counters (
    id BIGSERIAL PRIMARY KEY,
    platform TEXT NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`);
await pool.query(
  `CREATE UNIQUE INDEX IF NOT EXISTS platform_rate_counters_unique_idx
   ON platform_rate_counters (platform, period_start, period_end);`
).catch(() => undefined);

// ─── AI Skills ────────────────────────────────────────────────────────────────
await pool.query(`
  CREATE TABLE IF NOT EXISTS ai_skills (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    system_prompt TEXT NOT NULL DEFAULT '',
    scope TEXT NOT NULL DEFAULT 'all',
    enabled BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`).catch(() => undefined);

// Seed the built-in Content Generator skill (ON CONFLICT = skip if already exists)
try {
  const cgId = 'skill-content-generator-v1';
  const cgPrompt = `## CONTENT GENERATION SKILL — THREE-STAGE PIPELINE

When a user asks you to generate content, write an article, create SEO content, or produce a blog post about a topic, activate this three-stage pipeline and execute all three stages in sequence before presenting output.

---

### STAGE 1 — IDEA INSPIRATION RESEARCHER

Analyze how the topic is commonly covered. Extract structured insights, angles, gaps, and opportunities using your training knowledge. For every insight you derive, note the type of source that would typically cover it.

Deliver these sections:

1. Topic Overview — Summarize the core job readers want done. What questions are they asking? What outcomes do they want?
2. Common Angles in Existing Content — List the angles other writers commonly use.
3. High-Performing Themes — Identify content patterns and structures that appear frequently and perform well.
4. Identified Gaps — Highlight areas that are often ignored, weakly explained, or missing depth.
5. Unique Angles to Explore — Recommend angles not commonly used.
6. Must-Cover Subtopics — List subtopics essential for comprehensive coverage.
7. Reader Questions — List real questions readers expect answered but remain underserved.
8. Format Recommendations — Suggest formats based on what performs well (how-to guides, checklists, templates, comparisons, case examples).
9. Overused or Weak Ideas — Identify repetitive or saturated angles to avoid.
10. Final Inspiration Summary — A brief original synthesis of the strongest opportunities discovered.

Rules:
- Never reproduce external text. All insights must be original.
- No summaries of external content. Every insight must be your own synthesis.

---

### STAGE 2 — KEYWORD AND POWER WORD EXTRACTION

Pull structured keyword data from the Stage 1 research output to fuel the article.

Deliver the following:

Main Keyword or Keyphrase — The single strongest keyword to anchor the article.
Alternative Keywords or Keyphrases — Secondary terms closely related to the main keyword.
Long-Tail Keyphrases — Specific multi-word phrases that reflect precise reader intent. These must later appear in article body content or FAQs.
Matched Power Words — Select the most relevant power words from this list to use in the SEO title and throughout the article:

Power Word Reference: Absolute, Accurate, Achieve, Actionable, Adaptable, Advantage, Affordable, Amazing, Approved, Assured, Astonishing, Astounding, Authentic, Authoritative, Authority, Awesome, Backed, Badass, Balanced, Bargain, Genius, Genuine, Gift, Giveaway, Glamorous, Glorious, Guaranteed, Growth, Hack, Happiness, Healthy, Hero, Hidden, Highly Effective, Hilarious, Honest, Hope, Hopeful, How To, Huge, Ignite, Important, Improved, Increase, Incredible, Indulgent, Inexpensive, Fundamentals, Funny, Greatest, Greatness, Grit, Grounded.

Output format (use plain text, no markdown code fences):
Main Keyword: [keyword]
Alternative Keywords: [keyword 1], [keyword 2], [keyword 3]
Long-Tail Keyphrases:
- [phrase 1]
- [phrase 2]
- [phrase 3]
Power Words Selected: [word 1], [word 2], [word 3]

---

### STAGE 3 — SEO ARTICLE GENERATION

Produce a complete, fully optimized HTML article using all outputs from Stages 1 and 2.

Output must follow this exact order:
1. Keyword or Keyphrase
2. SEO Title
3. Meta Description
4. Full HTML Content
5. FAQs (numbered)
6. Conclusion
7. Internal Link Placement notes
8. External Link Placement notes
9. Call to Action

STRICT RULES:

SEO Title: Must be under 60 characters. Must contain the main keyword. Must include positive or negative sentiment. Must contain a power word from Stage 2.

Meta Description: Must be under 160 characters. Must contain the main keyword.

Main Keyword Usage: Must appear in title, meta description, first sentence, and at least one heading. Natural placement only. Target density 1.5% to 3.5%.

Word Count: Minimum 900 words.

Sentence Limit: No sentence may exceed 20 words.

Paragraph Limit: Short paragraphs only — 2 to 4 lines maximum.

Structure: Use one h1 only (the article title). Use h2 for major sections. Use h3 for subsections.

FAQs: Must be numbered. Must be derived from the long-tail keyphrases in Stage 2.

Conclusion: Include a clear summary. Include a CTA with an internal link embedded in a relevant phrase.

Skimmability: Use lists, bullets, and bold text. Bold text must use HTML b tags only. No Markdown asterisks anywhere in the output.

Internal Links: Insert only where they genuinely help the reader. Use short anchor text of six words maximum. Use exact URLs only — never place a bare URL in the text.

External Links: Include at least 3 external links sourced from Stage 1 research. Link to relevant words or phrases inside body content. Do not place external links at the end of paragraphs in isolation.

No Asterisks: Remove all asterisks from output. Bold any cleaned phrase using b tags instead.

All output must be valid HTML. No plain text, no Markdown.

---

### FINAL INSTRUCTION

Execute all three stages in sequence for the topic provided. Do not skip stages. Do not present partial output. Deliver the complete three-stage result as one unified response, clearly labeled by stage.`;

  await pool.query(
    `INSERT INTO ai_skills (id, name, description, system_prompt, scope, enabled, sort_order)
     VALUES ($1, $2, $3, $4, 'all', true, 0)
     ON CONFLICT (id) DO NOTHING`,
    [cgId, 'Content Generator', 'Three-stage content pipeline: research inspiration, keyword extraction, and full SEO article generation.', cgPrompt]
  );

  const magSkillId = 'skill-magnific-multimodal-v1';
  const magSkillPrompt = `## MAGNIFIC ACADEMY MULTIMODAL ENGINE & SPACES/FLOWS DOCTRINE
Magnific (https://api.magnific.com & MCP https://mcp.magnific.com) is the primary engine for ALL non-text generation across the platform. Always specify the exact model, aspect ratio, resolution, and background rules explicitly:

1. **Magnific One (\`magnific_one_generate\`) & Brand Kit**:
   - Endpoint: \`POST /v1/ai/magnific-one\`
   - **Draft → Final Funnel**: Explore with \`mode: "draft"\` and \`tiles: 16\` (exact proportions across all 10 aspect ratios; \`tiles: 8\` is only exact for \`1:1, 2:3, 3:2, 3:4\`), then recreate the winning composition in \`mode: "quality"\` at \`2k\` or \`4k\` (\`high\` or \`max\` quality).
   - **2–3 Style Reference Sweet Spot**: Supports up to 10 \`reference_images\`, with **2 to 3 visually consistent style references** as the sweet spot. Keep text prompts concise when strong style references are attached.
   - **3-Part Brand Pipeline**: Magnific One generates the image → Brand Kit enforces palette/style/tone/channel safe zones → Designer with Auto Layers refines deterministic typography, logos, and exact colors.

2. **Nano Banana Pro & Nano Banana 2 (\`magnific_generate_image\`) — Product Text, Mockups & Character Sheets**:
   - **Plain White Background & Character Profile Sheet Rule**: Generate reusable characters, vehicles, or products first on a **clean plain white studio background** using \`nano-banana-2\` in \`4k\` (\`3:4\` or \`4:3\`). Combine front, side, back, and passport face views into a single **Character Profile Sheet** to anchor consistency across all scenes. Keep Character, Location, and Object nodes separate.
   - **Nano Banana Pro (\`nano-banana-pro\`) 7-Part Product Typography Hierarchy**: To keep small product text/logos tack-sharp without warped glyphs, structure prompts in this exact order:
     1) **Composition First** (e.g. diagonal editorial still life + controlled directional lighting)
     2) **Exact Product Identity** (lock proportions, silhouette, stitching, panel geometry to studio references)
     3) **Dedicated Typography Block** (quote exact words, location, alignment, and state: "no misspellings, no extra letters, no warped glyphs")
     4) **True Color Accuracy** (specific color names like "deep cobalt blue upper, neon lime laces" instead of "blue shoe")
     5) **Lighting & Harmony**
     6) **Optical Control** ("shallow depth of field, tack-sharp focus on the product and its typography, no oversaturation")
     7) **Negative Constraints** ("no extra logos, no duplicated text, no invented branding, no distorted lettering").
   - **Branded Surface Mockups (\`nano-banana-2\` in \`4k\`)**: Chain unbranded base product shots via references so lighting matches the same photoshoot → connect a black logo on a white background → specify physical surface finish: **deboss effect** (glass/bottles), **emboss finish** (packaging boxes), or **embroidered thread matching fabric color** (towels/apparel), respecting edge margins, contact shadows, and surface texture.
   - **Sketches to Modular Interiors (\`nano-banana-pro\`)**: Turn Sketch 1 into a realistic standalone object (\`@img2\`) and Sketch 2 into a realistic room (\`@img1\`), then combine \`@img1\` + \`@img2\` with a minimal prompt defining **only their spatial relationship**.
   - **Editing & Variations (\`magnific_edit_image\`)**: \`upscale\` (Creative), \`upscale-precision\` (faithful upscaling for clean designs, logos, and split Variations grids—since a 4K Variations grid applies 4K to the whole container, always split into a List and upscale individual frames), \`relight\`, \`style-transfer\`, \`remove-background\`, \`image-expand\`.

3. **Cinematic Video Generation & Motion Control (\`magnific_generate_video\`)**:
   - **Start/End Images vs. Image References**: Use \`image_url\` (Start) and \`end_image_url\` (End) to lock exact first/last visual states (e.g. closed door → reveal frame, or continuing from an extracted last frame). Use \`reference_images\` (Character Sheet + Location + Product without a rigid Start Image) in \`seedance-2-5\` or \`kling-3-0-omni\` for natural multi-shot movement.
   - **Seedance 2.5 (\`seedance-2-5\`)**: Up to 30s, 50 references, multi-shot cuts, and 3D Scenes motion transfer (\`reference_video_url\`). **15-Second Chunking Rule**: Build 1-minute films in four 15s sections (\`480p/720p\` exploration → \`1080p\` production with 4 candidate outputs watched start-to-finish → \`4k\` Video Upscaler Precision/Creative + FPS Boost). **Multi-Clip Audio Rule**: Enable native dialogue/foley, **but set \`exclude_music: true\` (or write "no music" in the prompt)** so separate clips don't generate clashing soundtracks! **Surgical Corrections**: Never regenerate a full clip for one flaw—either extract the frame via Media Extractor (\`Manual selection\`) → fix with \`nano-banana-pro\` → generate a 2–3s replacement clip, or use Seedance 2.5 Clip Editor \`Modify\` mode.
   - **Kling 3.0 (\`kling-3-0\` / \`kling-3-pro\`)**:
     - *Single-Shot without Start Image*: Follow the **7-Part Formula** (1. Environment/Lighting -> 2. Shot Framing -> 3. Specific Character Traits -> 4. Physical Action -> 5. Cinematic Camera Move -> 6. Visual Detail -> 7. Ambient Sound).
     - *Single-Shot with Start Image*: Do NOT re-describe the visible environment/character; prompt **only physical action and camera behavior**.
     - *Multi-Shot Mode (\`shot_mode: "multi"\`, \`shots\`)*: Up to 6 scene cuts in one ≤15s generation; **each shot prompt must be ≤512 characters** (supports Start Image, no End Image).
   - **Kling 3.0 Omni (\`kling-3-0-omni\`)**: Multi-reference character dialogue lip-sync, mid-shot object transformations, and keeping small product typography tack-sharp across motion using clean white studio product references.
   - **Kling 2.6 Motion Control (\`kling-motion\`, 720p–1080p max)**: Transfers biomechanics from \`reference_video_url\` onto \`image_url\`. **CRITICAL**: **NEVER describe the physical action in the prompt!** Describe **ONLY camera framing and camera movement**. Swap backgrounds in \`nano-banana-pro\` *before* running Motion Control.

4. **Lip Sync, 3-Layer Audio & Spaces/Lists/Flows (\`magnific_lip_sync\`, \`magnific_generate_audio\`, \`magnific_space_or_flow\`)**:
   - **OmniHuman 1.5 & UGC Influencers**: Drive portrait/full-body images with voiceover audio, or combine white-background Character Profile Sheet + Car/Studio setting (\`9:16, 4k\`) + Product in hands + Voiceover/Kling 3.0 Omni.
   - **3-Layer Audio Mixing**: (1) Native video audio for dialogue/foley ("no music"); (2) \`sound-effects\` (\`loop: true\`) for atmosphere; (3) \`music-generation\` (ElevenLabs Music) scored across story sections; plus \`audio-isolation\` (SAM Audio).
   - **Spaces, Lists & Flows**: Use Assistant \`Export as List\` + \`List\` nodes (\`Keep items\` vs. \`Replace items\`) to batch-localize ads into 20+ languages or batch-upscale grouped images; organize productions in the 6-folder Candela structure (\`character, locations, still frames, videos, audio, final edit\`); always run \`simulate_cost\` before executing multi-node pipelines.`;

  await pool.query(
    `INSERT INTO ai_skills (id, name, description, system_prompt, scope, enabled, sort_order)
     VALUES ($1, $2, $3, $4, 'all', true, 1)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       system_prompt = EXCLUDED.system_prompt,
       updated_at = NOW()`,
    [magSkillId, 'Magnific Academy Multimodal & Spaces/Flows Engine', 'Trains all agents on Magnific Academy methodologies: Magnific One (Draft->Final, 2-3 style refs, Brand Kit), Nano Banana Pro (7-part product typography, sketches, surgical edits), Nano Banana 2 (4K white-bg Character Profile Sheets & deboss/emboss/embroidered mockups), Seedance 2.5 (15s chunks, 50 refs, "no music" rule, surgical fixes), Kling 3.0 (7-part & 6-cut Multi-Shot), Kling 3.0 Omni, Kling 2.6 Motion Control (camera-only prompt rule), 3D Scenes, OmniHuman 1.5, 3-layer Audio, and Spaces/Lists/Flows.', magSkillPrompt]
  );
} catch (e) {
  logger.warn('ai_skills seed skipped:', e);
}

// Ensure cover_image_url exists on card_templates (added in v6.4)
await pool.query(`ALTER TABLE card_templates ADD COLUMN IF NOT EXISTS cover_image_url TEXT`);

// Seed card templates once if the table is empty
try {
  const { rows: existingRows } = await pool.query<{ id: string }>('SELECT id FROM card_templates LIMIT 1');
  if (existingRows.length === 0) {
    // const now = new Date().toISOString();
    // for (const t of SAMPLE_TEMPLATES) {
    //   const tid = randomUUID();
    //   await pool.query(
    //     'INSERT INTO card_templates (id, name, description, design_data, cover_image_url, is_published, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    //     [tid, t.name, t.description, JSON.stringify(t.designData), '', true, now, now],
    //   );
    // }
    // logger.info(`Seeded ${SAMPLE_TEMPLATES.length} card templates.`);
  }
} catch (e) {
  logger.warn('Card template seed skipped:', e);
}

// ─── Seed: Solo Leveling promotional poster template ──────────────────────
try {
  const SOLO_LEVELING_ID = 'a1b2c3d4-0001-4000-8000-solo1eveling1';
  // Always upsert so a previously wrong-format row gets corrected
  {
    const now = new Date().toISOString();
    const imageUrl = 'https://d8j0ntlcm91z4.cloudfront.net/user_3DSPVF70hppaORlPqQfWVzMK0VX/hf_20260509_180211_c9c8fcf9-10fd-4e0e-9bfa-c6254a39fa8f.png';
    // Must use FabricDesignData wrapper so isFabricDesign() returns true in the frontend
    const fabricJson = {
      version: '5.3.0',
      background: '#050510',
      width: 1080,
      height: 1350,
      objects: [
        {
          type: 'image', version: '5.3.0',
          originX: 'left', originY: 'top',
          left: 0, top: 0,
          width: 1856, height: 2304,
          scaleX: 1080 / 1856, scaleY: 1350 / 2304,
          angle: 0, flipX: false, flipY: false, opacity: 1,
          fill: 'rgb(0,0,0)', stroke: null, strokeWidth: 0,
          strokeDashArray: null, strokeLineCap: 'butt', strokeDashOffset: 0,
          strokeLineJoin: 'miter', strokeUniform: false, strokeMiterLimit: 4,
          shadow: null, visible: true, backgroundColor: '',
          fillRule: 'nonzero', paintFirst: 'fill',
          globalCompositeOperation: 'source-over', skewX: 0, skewY: 0,
          cropX: 0, cropY: 0,
          src: imageUrl,
          crossOrigin: 'anonymous', filters: [],
        },
        {
          type: 'rect', version: '5.3.0',
          originX: 'left', originY: 'top',
          left: 0, top: 900, width: 1080, height: 450,
          fill: 'rgba(5,5,16,0.72)', stroke: null, strokeWidth: 0,
          strokeDashArray: null, strokeLineCap: 'butt', strokeDashOffset: 0,
          strokeLineJoin: 'miter', strokeUniform: false, strokeMiterLimit: 4,
          angle: 0, flipX: false, flipY: false, opacity: 1,
          shadow: null, visible: true, backgroundColor: '',
          fillRule: 'nonzero', paintFirst: 'fill',
          globalCompositeOperation: 'source-over', skewX: 0, skewY: 0, rx: 0, ry: 0,
        },
        {
          type: 'textbox', version: '5.3.0',
          originX: 'center', originY: 'center',
          left: 540, top: 990, width: 960,
          text: 'SOLO LEVELING',
          fontSize: 88, fontFamily: 'Inter', fontWeight: '900', fontStyle: 'normal',
          fill: '#ffffff', stroke: null, strokeWidth: 1,
          strokeDashArray: null, strokeLineCap: 'butt', strokeDashOffset: 0,
          strokeLineJoin: 'miter', strokeUniform: false, strokeMiterLimit: 4,
          angle: 0, flipX: false, flipY: false, opacity: 1,
          shadow: { color: 'rgba(120,80,255,0.7)', blur: 28, offsetX: 0, offsetY: 0 },
          visible: true, backgroundColor: '',
          fillRule: 'nonzero', paintFirst: 'fill',
          globalCompositeOperation: 'source-over', skewX: 0, skewY: 0,
          textAlign: 'center', lineHeight: 1.16, charSpacing: 320,
          styles: [], direction: 'ltr', pathStartOffset: 0,
          pathSide: 'left', pathAlign: 'baseline',
          overline: false, underline: false, linethrough: false,
          textBackgroundColor: '', splitByGrapheme: false,
        },
        {
          type: 'textbox', version: '5.3.0',
          originX: 'center', originY: 'center',
          left: 540, top: 1100, width: 760,
          text: 'ARISE',
          fontSize: 52, fontFamily: 'Inter', fontWeight: '300', fontStyle: 'italic',
          fill: '#a78bfa', stroke: null, strokeWidth: 1,
          strokeDashArray: null, strokeLineCap: 'butt', strokeDashOffset: 0,
          strokeLineJoin: 'miter', strokeUniform: false, strokeMiterLimit: 4,
          angle: 0, flipX: false, flipY: false, opacity: 1,
          shadow: { color: 'rgba(120,80,255,0.5)', blur: 18, offsetX: 0, offsetY: 0 },
          visible: true, backgroundColor: '',
          fillRule: 'nonzero', paintFirst: 'fill',
          globalCompositeOperation: 'source-over', skewX: 0, skewY: 0,
          textAlign: 'center', lineHeight: 1.16, charSpacing: 600,
          styles: [], direction: 'ltr', pathStartOffset: 0,
          pathSide: 'left', pathAlign: 'baseline',
          overline: false, underline: false, linethrough: false,
          textBackgroundColor: '', splitByGrapheme: false,
        },
        {
          type: 'textbox', version: '5.3.0',
          originX: 'center', originY: 'center',
          left: 540, top: 1280, width: 900,
          text: 'Edit your promotional text here',
          fontSize: 28, fontFamily: 'Inter', fontWeight: '400', fontStyle: 'normal',
          fill: 'rgba(200,180,255,0.7)', stroke: null, strokeWidth: 1,
          strokeDashArray: null, strokeLineCap: 'butt', strokeDashOffset: 0,
          strokeLineJoin: 'miter', strokeUniform: false, strokeMiterLimit: 4,
          angle: 0, flipX: false, flipY: false, opacity: 1,
          shadow: null, visible: true, backgroundColor: '',
          fillRule: 'nonzero', paintFirst: 'fill',
          globalCompositeOperation: 'source-over', skewX: 0, skewY: 0,
          textAlign: 'center', lineHeight: 1.4, charSpacing: 80,
          styles: [], direction: 'ltr', pathStartOffset: 0,
          pathSide: 'left', pathAlign: 'baseline',
          overline: false, underline: false, linethrough: false,
          textBackgroundColor: '', splitByGrapheme: false,
        },
      ],
    };
    const designData = {
      fabricVersion: true as const,
      canvasWidth: 1080,
      canvasHeight: 1350,
      fabricJson,
    };
    await pool.query(
      `INSERT INTO card_templates (id, name, description, design_data, cover_image_url, is_published, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET design_data = EXCLUDED.design_data, cover_image_url = EXCLUDED.cover_image_url, updated_at = EXCLUDED.updated_at`,
      [
        SOLO_LEVELING_ID,
        'Solo Leveling — Shadow Monarch',
        'Dark fantasy promotional poster (1080×1350 · 4:5 Facebook portrait). Shadow Monarch silhouette with glowing purple eyes and cinematic lighting. Generated with Higgsfield Nano Banana Pro 2K.',
        JSON.stringify(designData),
        imageUrl,
        true,
        now, now,
      ]
    );
    logger.info('Solo Leveling card template upserted.');
  }
} catch (e) {
  logger.warn('Solo Leveling template seed skipped:', e);
}
// ── end Solo Leveling seed ─────────────────────────────────────────────────

// ── Verdant Dark Studio card templates (Card 03 + Card 04) ────────────────
try {
  const now = new Date().toISOString();
  const VBG = '#0E1F2A';
  const VACC = '#6DFF5B';
  const VINK = '#FFFFFF';
  const VMUT = '#8FA5B0';

  const mkRings = (cx: number, cy: number) =>
    [200, 350, 500, 650].map((r, i) => ({
      type: 'circle', radius: r, left: cx - r, top: cy - r,
      fill: '', stroke: `rgba(255,255,255,${(0.12 - i * 0.02).toFixed(2)})`,
      strokeWidth: 1.5, selectable: false, evented: false,
      originX: 'left', originY: 'top', scaleX: 1, scaleY: 1, angle: 0,
      opacity: 1, shadow: null, visible: true, strokeDashArray: null,
      strokeLineCap: 'butt', strokeDashOffset: 0, strokeLineJoin: 'miter',
      strokeUniform: false, strokeMiterLimit: 4, flipX: false, flipY: false,
      skewX: 0, skewY: 0, rx: 0, ry: 0,
    }));

  const mkStamp = (cx: number, cy: number, label: string) => [
    { type: 'circle', radius: 58, left: cx - 58, top: cy - 58, fill: '', stroke: VACC, strokeWidth: 2, strokeDashArray: [6, 4], selectable: false, evented: false, originX: 'left', originY: 'top', scaleX: 1, scaleY: 1, angle: 0, opacity: 1, shadow: null, visible: true, strokeLineCap: 'butt', strokeDashOffset: 0, strokeLineJoin: 'miter', strokeUniform: false, strokeMiterLimit: 4, flipX: false, flipY: false, skewX: 0, skewY: 0, rx: 0, ry: 0 },
    { type: 'circle', radius: 45, left: cx - 45, top: cy - 45, fill: VACC, stroke: VBG, strokeWidth: 6, strokeDashArray: null, selectable: false, evented: false, originX: 'left', originY: 'top', scaleX: 1, scaleY: 1, angle: 0, opacity: 1, shadow: null, visible: true, strokeLineCap: 'butt', strokeDashOffset: 0, strokeLineJoin: 'miter', strokeUniform: false, strokeMiterLimit: 4, flipX: false, flipY: false, skewX: 0, skewY: 0, rx: 0, ry: 0 },
    { type: 'textbox', text: '✦', left: cx - 20, top: cy - 18, width: 40, fontSize: 28, fontFamily: 'Arial', fontWeight: 'bold', fill: VBG, textAlign: 'center', selectable: false, evented: false, originX: 'left', originY: 'top', scaleX: 1, scaleY: 1, angle: 0, opacity: 1, shadow: null, visible: true, underline: false, overline: false, linethrough: false, charSpacing: 0, lineHeight: 1.16, splitByGrapheme: false, styles: {}, strokeWidth: 0, stroke: null, backgroundColor: '', textBackgroundColor: '' },
    { type: 'textbox', text: label, left: cx - 55, top: cy + 52, width: 110, fontSize: 10, fontFamily: 'Arial', fontWeight: 'normal', fill: VMUT, textAlign: 'center', selectable: false, evented: false, originX: 'left', originY: 'top', scaleX: 1, scaleY: 1, angle: 0, opacity: 1, shadow: null, visible: true, underline: false, overline: false, linethrough: false, charSpacing: 100, lineHeight: 1.16, splitByGrapheme: false, styles: {}, strokeWidth: 0, stroke: null, backgroundColor: '', textBackgroundColor: '' },
  ];

  const mkRect = (left: number, top: number, width: number, height: number, fill: string, extra: Record<string, unknown> = {}) => ({
    type: 'rect', left, top, width, height, fill,
    stroke: null, strokeWidth: 0, strokeDashArray: null, strokeLineCap: 'butt',
    strokeDashOffset: 0, strokeLineJoin: 'miter', strokeUniform: false, strokeMiterLimit: 4,
    selectable: false, evented: false, originX: 'left', originY: 'top',
    scaleX: 1, scaleY: 1, angle: 0, opacity: 1, shadow: null, visible: true,
    flipX: false, flipY: false, skewX: 0, skewY: 0, rx: 0, ry: 0, ...extra,
  });

  const mkText = (text: string, left: number, top: number, width: number, fontSize: number, extra: Record<string, unknown> = {}) => ({
    type: 'textbox', text, left, top, width, fontSize,
    fontFamily: 'Arial', fontWeight: 'normal', fill: VINK, textAlign: 'left',
    selectable: false, evented: false, originX: 'left', originY: 'top',
    scaleX: 1, scaleY: 1, angle: 0, opacity: 1, shadow: null, visible: true,
    underline: false, overline: false, linethrough: false,
    charSpacing: 0, lineHeight: 1.16, splitByGrapheme: false, styles: {},
    strokeWidth: 0, stroke: null, backgroundColor: '', textBackgroundColor: '', ...extra,
  });

  // ── Card 03 — Agency Hero ──────────────────────────────────────────────────
  const card03Fabric = {
    version: '5.3.0',
    background: VBG,
    objects: [
      mkRect(0, 0, 1080, 1350, VBG),
      ...mkRings(1080, 0),
      ...mkRings(0, 1350),
      // S-curve swoosh
      { type: 'path', path: [['M', 0, 680], ['C', 270, 560, 810, 800, 1080, 680]], left: 0, top: 560, fill: '', stroke: 'rgba(109,255,91,0.25)', strokeWidth: 2.5, strokeDashArray: null, strokeLineCap: 'round', strokeDashOffset: 0, strokeLineJoin: 'round', strokeUniform: false, strokeMiterLimit: 4, selectable: false, evented: false, originX: 'left', originY: 'top', scaleX: 1, scaleY: 1, angle: 0, opacity: 1, shadow: null, visible: true, flipX: false, flipY: false, skewX: 0, skewY: 0 },
      // Nav logo
      mkText('✦ VERDANT', 60, 60, 200, 20, { fontWeight: 'bold', charSpacing: 200 }),
      // Nav links
      mkText('Work    About    Services    Contact', 520, 64, 500, 15, { fill: VMUT, textAlign: 'right' }),
      // Eyebrow
      mkText('CREATIVE AGENCY', 60, 360, 400, 13, { fill: VACC, fontWeight: 'bold', charSpacing: 260 }),
      // Accent bar
      mkRect(60, 388, 60, 3, VACC),
      // Headline (lines 0 & 2 in accent)
      mkText('Custom\nDesigns,\nJust for You!', 60, 420, 700, 108, {
        fontFamily: 'Arial Black', fontWeight: 'bold', charSpacing: -20, lineHeight: 1.0,
        styles: {
          '0': { '0': { fill: VACC }, '1': { fill: VACC }, '2': { fill: VACC }, '3': { fill: VACC }, '4': { fill: VACC }, '5': { fill: VACC } },
          '2': { '0': { fill: VACC }, '1': { fill: VACC }, '2': { fill: VACC }, '3': { fill: VACC }, '4': { fill: VACC }, '5': { fill: VACC }, '6': { fill: VACC }, '7': { fill: VACC }, '8': { fill: VACC }, '9': { fill: VACC }, '10': { fill: VACC }, '11': { fill: VACC }, '12': { fill: VACC } },
        },
      }),
      // Body text
      mkText('We craft purposeful identities, digital experiences,\nand brand strategies that move people.', 60, 850, 680, 24, { fill: VMUT, lineHeight: 1.5 }),
      // CTA button
      mkRect(60, 948, 380, 64, VACC, { rx: 8, ry: 8 }),
      mkText('— Connect With Us Today', 60, 964, 380, 20, { fill: VBG, fontWeight: 'bold', textAlign: 'center' }),
      // Stamp badge mid-right
      ...mkStamp(900, 810, 'VERDANT STUDIO'),
      // Footer divider + text
      mkRect(60, 1290, 960, 1, 'rgba(255,255,255,0.15)'),
      mkText('verdant.studio  ·  @verdantagency  ·  2026', 60, 1305, 960, 13, { fill: VMUT, textAlign: 'center', charSpacing: 80 }),
    ],
  };

  // ── Card 04 — Carousel Cover ───────────────────────────────────────────────
  const card04Fabric = {
    version: '5.3.0',
    background: VBG,
    objects: [
      mkRect(0, 0, 1080, 1350, VBG),
      ...mkRings(1080, 0),
      ...mkRings(0, 1350),
      // Loop swoosh (bottom half, behind content)
      { type: 'path', path: [['M', 80, 1000], ['C', 300, 900, 700, 1150, 950, 950], ['C', 1100, 830, 1050, 1100, 900, 1200]], left: 0, top: 830, fill: '', stroke: 'rgba(109,255,91,0.20)', strokeWidth: 2, strokeDashArray: null, strokeLineCap: 'round', strokeDashOffset: 0, strokeLineJoin: 'round', strokeUniform: false, strokeMiterLimit: 4, selectable: false, evented: false, originX: 'left', originY: 'top', scaleX: 1, scaleY: 1, angle: 0, opacity: 1, shadow: null, visible: true, flipX: false, flipY: false, skewX: 0, skewY: 0 },
      // Nav logo
      mkText('✦ VERDANT', 60, 60, 200, 20, { fontWeight: 'bold', charSpacing: 200 }),
      // Nav links ("Discover" chars 11–18 in accent)
      mkText('Process    Discover    Results    Contact', 440, 64, 580, 15, {
        fill: VMUT, textAlign: 'right',
        styles: { '0': { '11': { fill: VACC }, '12': { fill: VACC }, '13': { fill: VACC }, '14': { fill: VACC }, '15': { fill: VACC }, '16': { fill: VACC }, '17': { fill: VACC }, '18': { fill: VACC } } },
      }),
      // Eyebrow
      mkText('BRAND CASE STUDY', 60, 320, 500, 13, { fill: VACC, fontWeight: 'bold', charSpacing: 260 }),
      // Accent bar
      mkRect(60, 346, 60, 3, VACC),
      // "Before" outline accent box (behind headline line 0)
      { type: 'rect', left: 58, top: 378, width: 330, height: 108, fill: '', stroke: VACC, strokeWidth: 2, strokeDashArray: null, strokeLineCap: 'butt', strokeDashOffset: 0, strokeLineJoin: 'miter', strokeUniform: false, strokeMiterLimit: 4, selectable: false, evented: false, originX: 'left', originY: 'top', scaleX: 1, scaleY: 1, angle: 0, opacity: 1, shadow: null, visible: true, flipX: false, flipY: false, skewX: 0, skewY: 0, rx: 4, ry: 4 },
      // Headline ("After" chars 0–4 on line 1 in accent)
      mkText('Before and\nAfter Brand\nTransformation', 60, 380, 800, 100, {
        fontFamily: 'Arial Black', fontWeight: 'bold', charSpacing: -20, lineHeight: 1.0,
        styles: {
          '1': { '0': { fill: VACC }, '1': { fill: VACC }, '2': { fill: VACC }, '3': { fill: VACC }, '4': { fill: VACC } },
        },
      }),
      // Body text
      mkText('See how we transformed a struggling brand\ninto a market leader in 90 days.', 60, 780, 680, 24, { fill: VMUT, lineHeight: 1.5 }),
      // Swipe pill
      { type: 'rect', left: 60, top: 870, width: 160, height: 46, fill: 'rgba(109,255,91,0.12)', stroke: VACC, strokeWidth: 1.5, strokeDashArray: null, strokeLineCap: 'butt', strokeDashOffset: 0, strokeLineJoin: 'miter', strokeUniform: false, strokeMiterLimit: 4, selectable: false, evented: false, originX: 'left', originY: 'top', scaleX: 1, scaleY: 1, angle: 0, opacity: 1, shadow: null, visible: true, flipX: false, flipY: false, skewX: 0, skewY: 0, rx: 23, ry: 23 },
      mkText('Swipe →', 60, 882, 160, 17, { fill: VACC, fontWeight: 'bold', textAlign: 'center' }),
      // Stamp badge lower-right
      ...mkStamp(920, 1080, 'CASE STUDY'),
      // Corner caption
      mkText('Brand Lessons\nfor StartUp Owners', 60, 1180, 340, 20, { fontWeight: 'bold', lineHeight: 1.3 }),
      // Footer divider + text
      mkRect(60, 1290, 960, 1, 'rgba(255,255,255,0.15)'),
      mkText('verdant.studio  ·  @verdantagency  ·  2026', 60, 1305, 960, 13, { fill: VMUT, textAlign: 'center', charSpacing: 80 }),
    ],
  };

  const c03data = { fabricVersion: true as const, canvasWidth: 1080, canvasHeight: 1350, fabricJson: card03Fabric };
  const c04data = { fabricVersion: true as const, canvasWidth: 1080, canvasHeight: 1350, fabricJson: card04Fabric };

  await pool.query(
    `INSERT INTO card_templates (id, name, description, design_data, is_published, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (id) DO UPDATE SET design_data=EXCLUDED.design_data, name=EXCLUDED.name, updated_at=EXCLUDED.updated_at`,
    ['verdant03-dark-studio-agency-hero-2026', 'Verdant Dark Studio — Agency Hero', 'Dark teal + neon green agency card. Concentric rings, mixed-colour headline, S-curve swoosh, stamp badge, CTA. Fully editable.', JSON.stringify(c03data), true, now, now]
  );
  await pool.query(
    `INSERT INTO card_templates (id, name, description, design_data, is_published, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (id) DO UPDATE SET design_data=EXCLUDED.design_data, name=EXCLUDED.name, updated_at=EXCLUDED.updated_at`,
    ['verdant04-dark-studio-carousel-cover-2026', 'Verdant Dark Studio — Carousel Cover', 'Before-and-after brand transformation carousel cover. Swipe pill, loop swoosh, stamp badge, accent outline box on "Before". Fully editable.', JSON.stringify(c04data), true, now, now]
  );
  logger.info('Verdant Dark Studio card templates upserted.');
} catch (e) {
  logger.warn('Verdant Dark Studio template seed skipped:', e);
}
// ── end Verdant Dark Studio seed ────────────────────────────────────────────

// ── Social Media Templates (5 editable templates) ─────────────────────────
try {
  const now = new Date().toISOString();
  const R = (left: number, top: number, w: number, h: number, fill: string, ex: Record<string, unknown> = {}) => ({
    type: 'rect', left, top, width: w, height: h, fill,
    stroke: null, strokeWidth: 1, strokeDashArray: null, strokeLineCap: 'butt',
    strokeDashOffset: 0, strokeLineJoin: 'miter', strokeUniform: false, strokeMiterLimit: 4,
    selectable: false, evented: false, originX: 'left', originY: 'top',
    scaleX: 1, scaleY: 1, angle: 0, opacity: 1, shadow: null, visible: true,
    flipX: false, flipY: false, skewX: 0, skewY: 0, rx: 0, ry: 0, ...ex,
  });
  const T = (text: string, left: number, top: number, w: number, size: number, ex: Record<string, unknown> = {}) => ({
    type: 'textbox', text, left, top, width: w, fontSize: size,
    fontFamily: 'Arial', fontWeight: 'normal', fill: '#FFFFFF', textAlign: 'left',
    selectable: false, evented: false, originX: 'left', originY: 'top',
    scaleX: 1, scaleY: 1, angle: 0, opacity: 1, shadow: null, visible: true,
    underline: false, overline: false, linethrough: false,
    charSpacing: 0, lineHeight: 1.2, splitByGrapheme: false, styles: {},
    strokeWidth: 0, stroke: null, backgroundColor: '', textBackgroundColor: '', ...ex,
  });
  const C = (cx: number, cy: number, radius: number, ex: Record<string, unknown> = {}) => ({
    type: 'circle', radius, left: cx - radius, top: cy - radius,
    fill: '#3AE53A', stroke: null, strokeWidth: 1, strokeDashArray: null,
    strokeLineCap: 'butt', strokeDashOffset: 0, strokeLineJoin: 'miter',
    strokeUniform: false, strokeMiterLimit: 4,
    selectable: false, evented: false, originX: 'left', originY: 'top',
    scaleX: 1, scaleY: 1, angle: 0, opacity: 1, shadow: null, visible: true,
    flipX: false, flipY: false, skewX: 0, skewY: 0, ...ex,
  });
  const PT = (path: unknown[][], stroke: string, sw: number, ex: Record<string, unknown> = {}) => ({
    type: 'path', path, fill: '', stroke, strokeWidth: sw, strokeDashArray: null,
    strokeLineCap: 'round', strokeDashOffset: 0, strokeLineJoin: 'round',
    strokeUniform: false, strokeMiterLimit: 4, left: 0, top: 0,
    selectable: false, evented: false, originX: 'left', originY: 'top',
    scaleX: 1, scaleY: 1, angle: 0, opacity: 1, shadow: null, visible: true,
    flipX: false, flipY: false, skewX: 0, skewY: 0, ...ex,
  });
  const wrapFab = (json: unknown, h = 1350) => ({ fabricVersion: true as const, canvasWidth: 1080, canvasHeight: h, fabricJson: json });

  // ── 1. Finance Hero (Avante Capital style) ────────────────────────────────
  const finance_hero = {
    version: '5.3.0', background: '#0D4A2C',
    objects: [
      R(0, 0, 1080, 1350, '#0D4A2C'),
      // Photo placeholder right
      R(540, 130, 500, 620, '#0A3D22', { rx: 20, ry: 20 }),
      T('PHOTO\nAREA', 668, 390, 260, 18, { fill: '#1A6B3C', textAlign: 'center', charSpacing: 200, fontWeight: 'bold', lineHeight: 1.6 }),
      // Top header
      T('@avantecapital', 60, 52, 300, 16, { fill: 'rgba(255,255,255,0.45)', charSpacing: 50 }),
      T('consultoria financeira', 680, 52, 340, 16, { fill: 'rgba(255,255,255,0.45)', textAlign: 'right', charSpacing: 30 }),
      // White content card
      R(40, 650, 760, 620, '#FFFFFF', { rx: 24, ry: 24, stroke: null, strokeWidth: 0 }),
      // Headline inside card
      T('Seu futuro\nfinanceiro\nmais perto!', 80, 690, 620, 56, { fill: '#0D2E1A', fontFamily: 'Arial Black', fontWeight: 'bold', lineHeight: 1.05, charSpacing: -10 }),
      // Body
      T('Com planejamento e estratégia, você conquista estabilidade e realiza seus sonhos.', 80, 900, 620, 22, { fill: '#4A6B55', lineHeight: 1.55 }),
      // Gold check badge
      C(754, 860, 50, { fill: '#F5C518', stroke: '#FFFFFF', strokeWidth: 4, strokeDashArray: null }),
      T('✓', 730, 840, 48, 34, { fill: '#0D4A2C', fontWeight: 'bold', textAlign: 'center' }),
      // CTA button
      R(80, 1000, 268, 58, '#0D4A2C', { rx: 29, ry: 29, stroke: null, strokeWidth: 0 }),
      T('Saiba mais →', 80, 1017, 268, 18, { fill: '#FFFFFF', fontWeight: 'bold', textAlign: 'center' }),
      // Brand logo bottom
      T('▶  avante capital', 80, 1272, 340, 22, { fill: '#FFFFFF', fontWeight: 'bold' }),
      T('@avantecapital', 80, 1302, 340, 14, { fill: 'rgba(255,255,255,0.4)' }),
    ],
  };

  // ── 2. Creator Dark (Slyso style) ────────────────────────────────────────
  const creator_dark = {
    version: '5.3.0', background: '#0B1F18',
    objects: [
      R(0, 0, 1080, 1350, '#0B1F18'),
      // Subtle dot grid
      ...Array.from({ length: 16 }, (_, i) => C(100 + (i % 4) * 260, 100 + Math.floor(i / 4) * 320, 3, { fill: 'rgba(58,229,58,0.12)', stroke: null })),
      // Inner bordered card
      R(65, 145, 950, 1060, '#0F2A20', { rx: 28, ry: 28, stroke: 'rgba(255,255,255,0.18)', strokeWidth: 2, strokeDashArray: null }),
      // Logo circle + symbol
      C(138, 234, 30, { fill: '#3AE53A', stroke: null }),
      T('✦', 120, 217, 36, 21, { fill: '#0B1F18', fontWeight: 'bold', textAlign: 'center' }),
      T('Slyso', 182, 218, 200, 22, { fill: '#FFFFFF', fontWeight: 'bold' }),
      T('• • •', 870, 220, 110, 20, { fill: 'rgba(255,255,255,0.4)', textAlign: 'right', charSpacing: 80 }),
      T('terilapfinance.com', 740, 254, 280, 14, { fill: 'rgba(255,255,255,0.3)', textAlign: 'right' }),
      // Headline with "Creators," in accent on line 1
      T('Empowering\nCreators,\nMaximizing\nEarnings.', 110, 348, 800, 88, {
        fill: '#FFFFFF', fontFamily: 'Arial Black', fontWeight: 'bold', lineHeight: 1.05, charSpacing: -15,
        styles: { '1': { '0': { fill: '#3AE53A' }, '1': { fill: '#3AE53A' }, '2': { fill: '#3AE53A' }, '3': { fill: '#3AE53A' }, '4': { fill: '#3AE53A' }, '5': { fill: '#3AE53A' }, '6': { fill: '#3AE53A' }, '7': { fill: '#3AE53A' } } },
      }),
      // Body paragraph
      T('Provides a streamlined ecosystem where creators can manage brand partnerships, exclusive memberships, merchandise sales, and content licensing all in one place.', 110, 820, 800, 22, { fill: 'rgba(255,255,255,0.5)', lineHeight: 1.6 }),
      // Slide indicators
      R(110, 1140, 145, 4, '#FFFFFF', { rx: 2, ry: 2, stroke: null, strokeWidth: 0 }),
      R(265, 1142, 52, 2, 'rgba(255,255,255,0.25)', { rx: 1, ry: 1, stroke: null, strokeWidth: 0 }),
      R(327, 1142, 52, 2, 'rgba(255,255,255,0.25)', { rx: 1, ry: 1, stroke: null, strokeWidth: 0 }),
      R(825, 1140, 64, 4, 'rgba(255,255,255,0.25)', { rx: 2, ry: 2, stroke: null, strokeWidth: 0 }),
      R(899, 1140, 22, 4, 'rgba(255,255,255,0.25)', { rx: 2, ry: 2, stroke: null, strokeWidth: 0 }),
      R(931, 1140, 22, 4, 'rgba(255,255,255,0.25)', { rx: 2, ry: 2, stroke: null, strokeWidth: 0 }),
    ],
  };

  // ── 3. VS Comparison (Wishtree style, 1080×1080) ─────────────────────────
  const vs_comparison = {
    version: '5.3.0', background: '#39FF14',
    objects: [
      R(0, 0, 1080, 1080, '#39FF14'),
      // Black left trapezoid
      { type: 'path', path: [['M', 0, 0], ['L', 560, 0], ['L', 460, 1080], ['L', 0, 1080], ['Z']], fill: '#111111', stroke: null, strokeWidth: 0, strokeDashArray: null, strokeLineCap: 'butt', strokeDashOffset: 0, strokeLineJoin: 'miter', strokeUniform: false, strokeMiterLimit: 4, selectable: false, evented: false, originX: 'left', originY: 'top', scaleX: 1, scaleY: 1, angle: 0, opacity: 1, shadow: null, visible: true, flipX: false, flipY: false, skewX: 0, skewY: 0, left: 0, top: 0 },
      // Logo top-left
      T('W  wishtree', 40, 38, 280, 28, { fill: '#39FF14', fontWeight: 'bold' }),
      // URL top-right
      T('www.wishtreeinfosolution.com', 570, 40, 470, 18, { fill: '#111111', textAlign: 'right' }),
      // "SEO" tag (pill, rotated, neon green)
      R(490, 95, 110, 200, '#39FF14', { rx: 55, ry: 55, stroke: '#111111', strokeWidth: 3, strokeDashArray: null, angle: 0 }),
      T('SEO', 500, 148, 90, 30, { fill: '#111111', fontWeight: 'bold', textAlign: 'center' }),
      // "PPC" tag
      R(490, 735, 110, 200, '#111111', { rx: 55, ry: 55, stroke: '#39FF14', strokeWidth: 2, strokeDashArray: null, angle: 0 }),
      T('PPC', 500, 788, 90, 30, { fill: '#39FF14', fontWeight: 'bold', textAlign: 'center' }),
      // VS divider line
      R(534, 285, 2, 430, 'rgba(255,255,255,0.25)', { stroke: null, strokeWidth: 0 }),
      // VS text
      T('VS', 492, 458, 100, 38, { fill: '#FFFFFF', fontWeight: 'bold', textAlign: 'center' }),
      // Left SEO bullets
      T('• Organic Positions\n• Traffic Over Time\n• Long-Term Results\n• Ongoing Process\n• Improves Visibility\n• Free / Lower Cost', 36, 248, 430, 24, { fill: '#FFFFFF', lineHeight: 1.88 }),
      // Right PPC bullets
      T('• Paid Positions\n• Immediate Traffic\n• Immediate Results\n• One-Time Setup\n• Improves Sales\n• Only Paid', 580, 248, 460, 24, { fill: '#111111', lineHeight: 1.88 }),
      // Bottom left contact
      T('✉ info@wishtreeweb.com\n☎ +971 58 681 6054', 36, 940, 400, 18, { fill: 'rgba(255,255,255,0.55)', lineHeight: 1.7 }),
      // Bottom right social
      T('Follow us on #wishtree_dubai', 610, 982, 430, 17, { fill: '#111111', textAlign: 'right' }),
    ],
  };

  // ── 4. Feature Cards Dark (Service Points style) ──────────────────────────
  const feature_cards = {
    version: '5.3.0', background: '#0A1F18',
    objects: [
      R(0, 0, 1080, 1350, '#0A1F18'),
      // Soft arc background decoration
      PT([['M', -80, 820], ['C', 200, 620, 840, 1060, 1200, 740]], 'rgba(58,229,58,0.07)', 70, { strokeLineCap: 'round', strokeLineJoin: 'round' }),
      // Logo top-left
      C(76, 76, 26, { fill: '#3AE53A', stroke: null }),
      T('✦', 59, 59, 34, 20, { fill: '#0A1F18', fontWeight: 'bold', textAlign: 'center' }),
      T('ServicePoints', 116, 58, 280, 22, { fill: '#FFFFFF', fontWeight: 'bold' }),
      T('30 September 2024', 750, 60, 290, 17, { fill: 'rgba(255,255,255,0.35)', textAlign: 'right' }),
      // Headline
      T('What did we\nimplement?', 60, 190, 760, 92, { fill: '#FFFFFF', fontFamily: 'Arial Black', fontWeight: 'bold', lineHeight: 1.05, charSpacing: -15 }),
      // Card 1
      R(60, 500, 960, 162, 'rgba(58,229,58,0.07)', { rx: 20, ry: 20, stroke: 'rgba(58,229,58,0.18)', strokeWidth: 1, strokeDashArray: null }),
      C(120, 581, 28, { fill: '#3AE53A', stroke: null }),
      T('✓', 101, 562, 38, 24, { fill: '#0A1F18', fontWeight: 'bold', textAlign: 'center' }),
      T('Improve delivery time', 168, 544, 700, 26, { fill: '#FFFFFF', fontWeight: 'bold' }),
      T('We changed to another supplier for your underperforming product', 168, 576, 800, 21, { fill: 'rgba(255,255,255,0.45)', lineHeight: 1.4 }),
      // Card 2
      R(60, 682, 960, 162, 'rgba(58,229,58,0.07)', { rx: 20, ry: 20, stroke: 'rgba(58,229,58,0.18)', strokeWidth: 1, strokeDashArray: null }),
      C(120, 763, 28, { fill: '#3AE53A', stroke: null }),
      T('✓', 101, 744, 38, 24, { fill: '#0A1F18', fontWeight: 'bold', textAlign: 'center' }),
      T('Improve processing time', 168, 726, 700, 26, { fill: '#FFFFFF', fontWeight: 'bold' }),
      T('We changed to another supplier for your underperforming product', 168, 758, 800, 21, { fill: 'rgba(255,255,255,0.45)', lineHeight: 1.4 }),
      // Card 3
      R(60, 864, 960, 162, 'rgba(58,229,58,0.07)', { rx: 20, ry: 20, stroke: 'rgba(58,229,58,0.18)', strokeWidth: 1, strokeDashArray: null }),
      C(120, 945, 28, { fill: '#3AE53A', stroke: null }),
      T('✓', 101, 926, 38, 24, { fill: '#0A1F18', fontWeight: 'bold', textAlign: 'center' }),
      T('Improve price', 168, 908, 700, 26, { fill: '#FFFFFF', fontWeight: 'bold' }),
      T('We changed to another supplier for your underperforming product', 168, 940, 800, 21, { fill: 'rgba(255,255,255,0.45)', lineHeight: 1.4 }),
      // Mockup placeholder card (right decoration)
      R(680, 220, 360, 480, 'rgba(58,229,58,0.04)', { rx: 18, ry: 18, stroke: 'rgba(58,229,58,0.10)', strokeWidth: 1, strokeDashArray: null }),
      T('Report\nMockup', 760, 410, 200, 22, { fill: 'rgba(58,229,58,0.18)', textAlign: 'center', fontWeight: 'bold', lineHeight: 1.5 }),
      // Arrow circle button bottom-right
      C(990, 1285, 46, { fill: '', stroke: 'rgba(255,255,255,0.28)', strokeWidth: 2, strokeDashArray: null }),
      T('→', 968, 1265, 44, 30, { fill: '#FFFFFF', textAlign: 'center' }),
    ],
  };

  // ── 5. Agency Diagonal Tape (UpDraft style) ────────────────────────────────
  const agency_tape = {
    version: '5.3.0', background: '#0B1E15',
    objects: [
      R(0, 0, 1080, 1350, '#0B1E15'),
      // Tape 1
      R(-140, 318, 1440, 88, '#00E8A2', { angle: -15, rx: 0, ry: 0, stroke: null, strokeWidth: 0 }),
      T('UpDraft  ✦  Design & Product Agency  ✦  UpDraft  ✦  Design & Product Agency  ✦', -100, 342, 1380, 22, { fill: '#0B1E15', fontWeight: 'bold', charSpacing: 20, angle: -15 }),
      // Tape 2
      R(-140, 498, 1440, 88, '#00E8A2', { angle: -15, rx: 0, ry: 0, stroke: null, strokeWidth: 0 }),
      T('Open for Projects  ✦  Open for Projects  ✦  Open for Projects  ✦  Open for Projects  ✦', -100, 521, 1380, 22, { fill: '#0B1E15', fontWeight: 'bold', charSpacing: 20, angle: -15 }),
      // Tape 3
      R(-140, 678, 1440, 88, '#00E8A2', { angle: -15, rx: 0, ry: 0, stroke: null, strokeWidth: 0 }),
      T('UpDraft  ✦  Design & Product Agency  ✦  UpDraft  ✦  Design & Product Agency  ✦', -100, 701, 1380, 22, { fill: '#0B1E15', fontWeight: 'bold', charSpacing: 20, angle: -15 }),
      // Shield icon top-center
      T('⬡', 510, 108, 60, 54, { fill: '#FFFFFF', textAlign: 'center', fontWeight: 'bold' }),
      // Headline below tapes
      T('We Design\nWe Build\nWe Scale', 60, 810, 860, 112, { fill: '#FFFFFF', fontFamily: 'Arial Black', fontWeight: 'bold', lineHeight: 1.0, charSpacing: -15 }),
      // URL bottom-left
      T('updraft.agency', 60, 1276, 300, 22, { fill: 'rgba(255,255,255,0.45)' }),
      // Arrow bottom-right
      T('→', 978, 1268, 62, 38, { fill: '#00E8A2', fontWeight: 'bold', textAlign: 'center' }),
    ],
  };

  const socialTemplates = [
    { id: 'social-finance-hero-2026',      name: 'Finance — Green Hero',         desc: 'Dark forest green finance post. White content card, photo placeholder, gold check badge, CTA button. Fully editable.', data: wrapFab(finance_hero) },
    { id: 'social-creator-dark-2026',      name: 'Creator — Dark Card',          desc: 'Very dark green creator brand card with inner bordered panel. Mixed-colour headline, body text, slide indicators. Fully editable.', data: wrapFab(creator_dark) },
    { id: 'social-vs-comparison-2026',     name: 'Comparison — VS Split',        desc: '1080×1080 black + neon green diagonal split. Comparison-style with bullet lists and category label pills. Fully editable.', data: wrapFab(vs_comparison, 1080) },
    { id: 'social-feature-cards-2026',     name: 'Features — Dark Checklist',    desc: 'Dark green feature showcase. Bold headline, 3 rounded feature cards with green check circles, arrow button. Fully editable.', data: wrapFab(feature_cards) },
    { id: 'social-agency-tape-2026',       name: 'Agency — Diagonal Tape',       desc: 'Dark forest green agency poster. Three diagonal mint-green tape banners, bold 3-line headline, footer URL. Fully editable.', data: wrapFab(agency_tape) },
  ];

  for (const tmpl of socialTemplates) {
    await pool.query(
      `INSERT INTO card_templates (id, name, description, design_data, is_published, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET design_data=EXCLUDED.design_data, name=EXCLUDED.name, updated_at=EXCLUDED.updated_at`,
      [tmpl.id, tmpl.name, tmpl.desc, JSON.stringify(tmpl.data), true, now, now]
    );
  }
  logger.info('Social media card templates upserted (5 templates).');
} catch (e) {
  logger.warn('Social media template seed skipped:', e);
}
// ── end Social Media Templates seed ────────────────────────────────────────

// ── 10 Editable Card Templates ─────────────────────────────────────────────
try {
  const now = new Date().toISOString();
  const _r = (l:number,t:number,w:number,h:number,fill:string,ex:Record<string,unknown>={})=>({type:'rect',left:l,top:t,width:w,height:h,fill,stroke:null,strokeWidth:1,strokeDashArray:null,strokeLineCap:'butt',strokeDashOffset:0,strokeLineJoin:'miter',strokeUniform:false,strokeMiterLimit:4,selectable:false,evented:false,originX:'left',originY:'top',scaleX:1,scaleY:1,angle:0,opacity:1,shadow:null,visible:true,flipX:false,flipY:false,skewX:0,skewY:0,rx:0,ry:0,...ex});
  const _t = (text:string,l:number,t:number,w:number,sz:number,ex:Record<string,unknown>={})=>({type:'textbox',text,left:l,top:t,width:w,fontSize:sz,fontFamily:'Arial',fontWeight:'normal',fill:'#FFFFFF',textAlign:'left',selectable:false,evented:false,originX:'left',originY:'top',scaleX:1,scaleY:1,angle:0,opacity:1,shadow:null,visible:true,underline:false,overline:false,linethrough:false,charSpacing:0,lineHeight:1.2,splitByGrapheme:false,styles:{},strokeWidth:0,stroke:null,backgroundColor:'',textBackgroundColor:'',...ex});
  const _c = (cx:number,cy:number,r:number,ex:Record<string,unknown>={})=>({type:'circle',radius:r,left:cx-r,top:cy-r,fill:'#FFFFFF',stroke:null,strokeWidth:1,strokeDashArray:null,strokeLineCap:'butt',strokeDashOffset:0,strokeLineJoin:'miter',strokeUniform:false,strokeMiterLimit:4,selectable:false,evented:false,originX:'left',originY:'top',scaleX:1,scaleY:1,angle:0,opacity:1,shadow:null,visible:true,flipX:false,flipY:false,skewX:0,skewY:0,...ex});
  const _p = (path:unknown[][],stroke:string,sw:number,ex:Record<string,unknown>={})=>({type:'path',path,fill:'',stroke,strokeWidth:sw,strokeDashArray:null,strokeLineCap:'round',strokeDashOffset:0,strokeLineJoin:'round',strokeUniform:false,strokeMiterLimit:4,left:0,top:0,selectable:false,evented:false,originX:'left',originY:'top',scaleX:1,scaleY:1,angle:0,opacity:1,shadow:null,visible:true,flipX:false,flipY:false,skewX:0,skewY:0,...ex});
  const _w=(j:unknown,h=1350)=>({fabricVersion:true as const,canvasWidth:1080,canvasHeight:h,fabricJson:j});

  // ── T1: Finance — Dark Hero ───────────────────────────────────────────────
  const t01={version:'5.3.0',background:'#0D4A2C',objects:[
    _r(0,0,1080,1350,'#0D4A2C'),
    _r(560,120,480,700,'#0A3D22',{rx:20,ry:20}),
    _t('PHOTO AREA',650,430,280,18,{fill:'#1A6B3C',textAlign:'center',fontWeight:'bold',charSpacing:200}),
    _t('@yourbrand',60,52,260,15,{fill:'rgba(255,255,255,0.45)',charSpacing:80}),
    _t('financial consulting',720,52,300,15,{fill:'rgba(255,255,255,0.4)',textAlign:'right'}),
    _r(40,850,720,440,'#FFFFFF',{rx:24,ry:24,stroke:null,strokeWidth:0}),
    _t('Seu futuro\nfinanceiro\nmais perto!',80,892,640,52,{fill:'#0D2E1A',fontFamily:'Arial Black',fontWeight:'bold',lineHeight:1.05,charSpacing:-10}),
    _t('Com planejamento e estratégia, você conquista estabilidade e realiza seus sonhos.',80,1072,640,20,{fill:'#4A6B55',lineHeight:1.55}),
    _c(722,910,44,{fill:'#F5C518',stroke:'#FFFFFF',strokeWidth:4,strokeDashArray:null}),
    _t('✓',700,891,44,32,{fill:'#0D4A2C',fontWeight:'bold',textAlign:'center'}),
    _r(80,1150,250,54,'#0D4A2C',{rx:27,ry:27,stroke:null,strokeWidth:0}),
    _t('Saiba mais →',80,1164,250,17,{fill:'#FFFFFF',fontWeight:'bold',textAlign:'center'}),
    _t('▶  avante capital',80,1298,300,20,{fill:'#FFFFFF',fontWeight:'bold'}),
  ]};

  // ── T2: Finance — Financial Freedom (Light BG) ────────────────────────────
  const t02={version:'5.3.0',background:'#F5F0E8',objects:[
    _r(0,0,1080,1350,'#F5F0E8'),
    _p([['M',0,0],['L',1080,0],['L',1080,700],['L',0,900],['Z']],'',0,{fill:'#0D4A2C',stroke:null}),
    _t('@yourbrand',60,48,240,15,{fill:'rgba(255,255,255,0.6)',charSpacing:80}),
    _t('financial consulting',720,48,300,15,{fill:'rgba(255,255,255,0.55)',textAlign:'right'}),
    _r(60,180,180,36,'#F5C518',{rx:18,ry:18,stroke:null,strokeWidth:0}),
    _t('DESTAQUE',68,189,164,14,{fill:'#0D4A2C',fontWeight:'bold',textAlign:'center',charSpacing:150}),
    _t('Independência\nfinanceira\nao seu alcance!',60,250,820,96,{fill:'#FFFFFF',fontFamily:'Arial Black',fontWeight:'bold',lineHeight:1.0,charSpacing:-15}),
    _t('Comece agora a construir um patrimônio sólido\ne seguro para o futuro.',60,560,680,24,{fill:'rgba(255,255,255,0.75)',lineHeight:1.55}),
    _r(60,900,820,360,'#FFFFFF',{rx:24,ry:24,stroke:null,strokeWidth:0}),
    _t('Comece agora a construir um patrimônio sólido e seguro para o futuro. Nossa equipe está pronta para te ajudar.',100,940,740,22,{fill:'#0D2E1A',lineHeight:1.6}),
    _t('▶  avante capital',100,1180,280,22,{fill:'#0D4A2C',fontWeight:'bold'}),
    _t('consultoria financeira',100,1210,360,15,{fill:'#4A6B55'}),
  ]};

  // ── T3: Finance — Smart Money Bold ────────────────────────────────────────
  const t03={version:'5.3.0',background:'#0D4A2C',objects:[
    _r(0,0,1080,1350,'#0D4A2C'),
    _r(0,0,1080,1350,'rgba(0,50,20,0.4)',{angle:0}),
    _t('@yourbrand',60,52,260,15,{fill:'rgba(255,255,255,0.45)',charSpacing:80}),
    _t('financial consulting',720,52,300,15,{fill:'rgba(255,255,255,0.4)',textAlign:'right'}),
    _r(60,220,8,180,'#F5C518',{rx:4,ry:4,stroke:null,strokeWidth:0}),
    _t('Seu dinheiro\nmerece uma\ngestão\ninteligente!',90,220,820,96,{fill:'#FFFFFF',fontFamily:'Arial Black',fontWeight:'bold',lineHeight:1.0,charSpacing:-15,
      styles:{'1':{'0':{fill:'#F5C518'},'1':{fill:'#F5C518'},'2':{fill:'#F5C518'},'3':{fill:'#F5C518'},'4':{fill:'#F5C518'},'5':{fill:'#F5C518'}}}}),
    _r(60,660,960,3,'rgba(255,255,255,0.15)',{stroke:null,strokeWidth:0}),
    _r(60,700,820,200,'rgba(255,255,255,0.06)',{rx:20,ry:20,stroke:'rgba(255,255,255,0.1)',strokeWidth:1,strokeDashArray:null}),
    _t('Controle, organize e multiplique seus recursos com um planejamento eficiente. Nossa consultoria te guia em cada passo.',100,730,740,22,{fill:'rgba(255,255,255,0.75)',lineHeight:1.6}),
    _t('▶  avante capital',60,1300,300,20,{fill:'#F5C518',fontWeight:'bold'}),
  ]};

  // ── T4: Finance — Business Question Card ─────────────────────────────────
  const t04={version:'5.3.0',background:'#F0EDE4',objects:[
    _r(0,0,1080,1350,'#F0EDE4'),
    _r(0,0,1080,1350,'rgba(13,74,44,0.04)'),
    _t('@yourbrand',60,52,260,15,{fill:'rgba(13,46,26,0.4)',charSpacing:80}),
    _t('financial consulting',720,52,300,15,{fill:'rgba(13,46,26,0.35)',textAlign:'right'}),
    _r(60,160,960,880,'#FFFFFF',{rx:28,ry:28,stroke:'rgba(13,74,44,0.08)',strokeWidth:1,strokeDashArray:null}),
    _t('MEI, Simples\nNacional ou\nLucro\nPresumido?',100,220,760,76,{fill:'#0D2E1A',fontFamily:'Arial Black',fontWeight:'bold',lineHeight:1.05,charSpacing:-10}),
    _r(100,590,56,56,'#F5C518',{rx:28,ry:28,stroke:null,strokeWidth:0}),
    _t('▼',100,600,56,28,{fill:'#0D4A2C',fontWeight:'bold',textAlign:'center'}),
    _r(100,680,760,290,'rgba(13,74,44,0.04)',{rx:16,ry:16,stroke:'rgba(13,74,44,0.08)',strokeWidth:1,strokeDashArray:null}),
    _t('Escolher o regime tributário certo pode fazer toda a diferença nos seus ganhos. Fale com um especialista.',140,710,690,22,{fill:'#4A6B55',lineHeight:1.6}),
    _t('▶  avante capital',100,1090,280,22,{fill:'#0D4A2C',fontWeight:'bold'}),
    _t('consultoria financeira',100,1122,360,15,{fill:'rgba(13,46,26,0.4)'}),
  ]};

  // ── T5: Finance — CTA / Formalize ────────────────────────────────────────
  const t05={version:'5.3.0',background:'#0D4A2C',objects:[
    _r(0,0,1080,1350,'#0D4A2C'),
    _p([['M',600,0],['C',800,200,1100,100,1080,400],['L',1080,0],['Z']],'',0,{fill:'rgba(255,255,255,0.04)',stroke:null}),
    _t('@yourbrand',60,52,260,15,{fill:'rgba(255,255,255,0.45)',charSpacing:80}),
    _t('financial consulting',720,52,300,15,{fill:'rgba(255,255,255,0.4)',textAlign:'right'}),
    _r(60,200,60,60,'#F5C518',{rx:30,ry:30,stroke:null,strokeWidth:0}),
    _t('▶',60,213,60,30,{fill:'#0D4A2C',fontWeight:'bold',textAlign:'center'}),
    _t('Formalize seu\nnegócio com\nsegurança!',60,290,820,96,{fill:'#FFFFFF',fontFamily:'Arial Black',fontWeight:'bold',lineHeight:1.0,charSpacing:-15}),
    _t('A nossa consultoria cuida de toda a burocracia para você focar no crescimento da sua empresa.',60,610,760,24,{fill:'rgba(255,255,255,0.72)',lineHeight:1.55}),
    _r(60,720,320,3,'rgba(255,255,255,0.2)',{stroke:null,strokeWidth:0}),
    _r(60,760,280,62,'#F5C518',{rx:31,ry:31,stroke:null,strokeWidth:0}),
    _t('Saiba mais',60,776,280,20,{fill:'#0D4A2C',fontWeight:'bold',textAlign:'center'}),
    _t('▶  avante capital',60,1300,300,20,{fill:'#FFFFFF',fontWeight:'bold'}),
  ]};

  // ── T6: Creator — Inner Card Dark ─────────────────────────────────────────
  const t06={version:'5.3.0',background:'#0B1F18',objects:[
    _r(0,0,1080,1350,'#0B1F18'),
    _r(70,140,940,1060,'#0F2A1E',{rx:28,ry:28,stroke:'rgba(255,255,255,0.15)',strokeWidth:2,strokeDashArray:null}),
    _c(138,232,28,{fill:'#3AE53A',stroke:null}),
    _t('✦',121,215,34,20,{fill:'#0B1F18',fontWeight:'bold',textAlign:'center'}),
    _t('YourBrand',184,216,240,22,{fill:'#FFFFFF',fontWeight:'bold'}),
    _t('• • •',868,218,108,20,{fill:'rgba(255,255,255,0.4)',textAlign:'right',charSpacing:80}),
    _t('yourbrand.com',740,252,278,14,{fill:'rgba(255,255,255,0.28)',textAlign:'right'}),
    _t('Empowering\nCreators,\nMaximizing\nEarnings.',110,345,800,88,{fill:'#FFFFFF',fontFamily:'Arial Black',fontWeight:'bold',lineHeight:1.05,charSpacing:-15,
      styles:{'1':{'0':{fill:'#3AE53A'},'1':{fill:'#3AE53A'},'2':{fill:'#3AE53A'},'3':{fill:'#3AE53A'},'4':{fill:'#3AE53A'},'5':{fill:'#3AE53A'},'6':{fill:'#3AE53A'},'7':{fill:'#3AE53A'}}}}),
    _t('Provides a streamlined ecosystem where creators can manage brand partnerships, exclusive memberships, and content licensing — all in one place.',110,820,800,22,{fill:'rgba(255,255,255,0.48)',lineHeight:1.6}),
    _r(110,1138,148,4,'#FFFFFF',{rx:2,ry:2,stroke:null,strokeWidth:0}),
    _r(268,1140,54,2,'rgba(255,255,255,0.22)',{rx:1,ry:1,stroke:null,strokeWidth:0}),
    _r(332,1140,54,2,'rgba(255,255,255,0.22)',{rx:1,ry:1,stroke:null,strokeWidth:0}),
    _r(826,1138,66,4,'rgba(255,255,255,0.22)',{rx:2,ry:2,stroke:null,strokeWidth:0}),
    _r(902,1138,24,4,'rgba(255,255,255,0.22)',{rx:2,ry:2,stroke:null,strokeWidth:0}),
  ]};

  // ── T7: Stats Showcase — Big Number ──────────────────────────────────────
  const t07={version:'5.3.0',background:'#0A1A12',objects:[
    _r(0,0,1080,1350,'#0A1A12'),
    _p([['M',0,600],['C',300,400,780,800,1080,600]],'rgba(58,229,58,0.12)',80,{strokeLineCap:'round',strokeLineJoin:'round'}),
    _t('@yourbrand',60,52,260,15,{fill:'rgba(255,255,255,0.4)',charSpacing:80}),
    _t('brand.com',780,52,260,15,{fill:'rgba(255,255,255,0.35)',textAlign:'right'}),
    _t('DID YOU\nKNOW?',60,200,700,22,{fill:'#3AE53A',fontWeight:'bold',charSpacing:300,lineHeight:1.4}),
    _t('%70',60,320,800,260,{fill:'#FFFFFF',fontFamily:'Arial Black',fontWeight:'bold',charSpacing:-30,lineHeight:1.0}),
    _t('of businesses that invest in financial\nplanning grow 3× faster in 5 years.',60,620,760,28,{fill:'rgba(255,255,255,0.65)',lineHeight:1.5}),
    _r(60,730,960,2,'rgba(58,229,58,0.2)',{stroke:null,strokeWidth:0}),
    _r(60,770,280,100,'rgba(58,229,58,0.08)',{rx:16,ry:16,stroke:'rgba(58,229,58,0.2)',strokeWidth:1,strokeDashArray:null}),
    _t('3× Growth',80,800,240,22,{fill:'#3AE53A',fontWeight:'bold',textAlign:'center'}),
    _r(380,770,280,100,'rgba(58,229,58,0.08)',{rx:16,ry:16,stroke:'rgba(58,229,58,0.2)',strokeWidth:1,strokeDashArray:null}),
    _t('5 Year Plan',400,800,240,22,{fill:'#3AE53A',fontWeight:'bold',textAlign:'center'}),
    _r(700,770,280,100,'rgba(58,229,58,0.08)',{rx:16,ry:16,stroke:'rgba(58,229,58,0.2)',strokeWidth:1,strokeDashArray:null}),
    _t('Proven ROI',720,800,240,22,{fill:'#3AE53A',fontWeight:'bold',textAlign:'center'}),
    _t('Source: Global Business Finance Report 2024',60,1298,960,14,{fill:'rgba(255,255,255,0.3)',textAlign:'center'}),
  ]};

  // ── T8: VS Comparison Split (1080×1080) ───────────────────────────────────
  const t08={version:'5.3.0',background:'#39FF14',objects:[
    _r(0,0,1080,1080,'#39FF14'),
    {type:'path',path:[['M',0,0],['L',560,0],['L',460,1080],['L',0,1080],['Z']],fill:'#111111',stroke:null,strokeWidth:0,strokeDashArray:null,strokeLineCap:'butt',strokeDashOffset:0,strokeLineJoin:'miter',strokeUniform:false,strokeMiterLimit:4,selectable:false,evented:false,originX:'left',originY:'top',scaleX:1,scaleY:1,angle:0,opacity:1,shadow:null,visible:true,flipX:false,flipY:false,skewX:0,skewY:0,left:0,top:0},
    _t('W yourbrand',40,38,260,26,{fill:'#39FF14',fontWeight:'bold'}),
    _t('www.yourbrand.com',600,40,440,17,{fill:'#111111',textAlign:'right'}),
    _r(490,90,112,210,'#39FF14',{rx:56,ry:56,stroke:'#111111',strokeWidth:3,strokeDashArray:null}),
    _t('SEO',494,148,104,30,{fill:'#111111',fontWeight:'bold',textAlign:'center'}),
    _r(490,730,112,210,'#111111',{rx:56,ry:56,stroke:'#39FF14',strokeWidth:2,strokeDashArray:null}),
    _t('PPC',494,788,104,30,{fill:'#39FF14',fontWeight:'bold',textAlign:'center'}),
    _r(535,295,2,420,'rgba(255,255,255,0.2)',{stroke:null,strokeWidth:0}),
    _t('VS',490,450,102,38,{fill:'#FFFFFF',fontWeight:'bold',textAlign:'center'}),
    _t('• Organic Positions\n• Traffic Over Time\n• Long-Term Results\n• Ongoing Process\n• Improves Visibility\n• Free / Lower Cost',36,252,420,24,{fill:'#FFFFFF',lineHeight:1.88}),
    _t('• Paid Positions\n• Immediate Traffic\n• Immediate Results\n• One-Time Setup\n• Improves Sales\n• Only Paid',588,252,450,24,{fill:'#111111',lineHeight:1.88}),
    _t('✉ info@yourbrand.com\n☎ +971 00 000 0000',36,942,380,18,{fill:'rgba(255,255,255,0.5)',lineHeight:1.7}),
    _t('Follow us @yourbrand',610,982,430,17,{fill:'#111111',textAlign:'right'}),
  ]};

  // ── T9: Feature Checklist Dark ────────────────────────────────────────────
  const t09={version:'5.3.0',background:'#0A1F18',objects:[
    _r(0,0,1080,1350,'#0A1F18'),
    _p([['M',-80,820],['C',220,630,860,1060,1200,750]],'rgba(58,229,58,0.07)',70,{strokeLineCap:'round',strokeLineJoin:'round'}),
    _c(76,76,26,{fill:'#3AE53A',stroke:null}),
    _t('✦',59,59,34,20,{fill:'#0A1F18',fontWeight:'bold',textAlign:'center'}),
    _t('YourBrand',116,58,280,22,{fill:'#FFFFFF',fontWeight:'bold'}),
    _t('30 September 2024',750,60,290,17,{fill:'rgba(255,255,255,0.3)',textAlign:'right'}),
    _t('What did we\nimplement?',60,195,760,88,{fill:'#FFFFFF',fontFamily:'Arial Black',fontWeight:'bold',lineHeight:1.05,charSpacing:-15}),
    _r(60,500,960,158,'rgba(58,229,58,0.07)',{rx:20,ry:20,stroke:'rgba(58,229,58,0.16)',strokeWidth:1,strokeDashArray:null}),
    _c(120,579,28,{fill:'#3AE53A',stroke:null}),
    _t('✓',102,561,36,22,{fill:'#0A1F18',fontWeight:'bold',textAlign:'center'}),
    _t('Improve delivery time',168,542,660,26,{fill:'#FFFFFF',fontWeight:'bold'}),
    _t('We changed to another supplier for your underperforming product.',168,574,780,21,{fill:'rgba(255,255,255,0.44)',lineHeight:1.4}),
    _r(60,678,960,158,'rgba(58,229,58,0.07)',{rx:20,ry:20,stroke:'rgba(58,229,58,0.16)',strokeWidth:1,strokeDashArray:null}),
    _c(120,757,28,{fill:'#3AE53A',stroke:null}),
    _t('✓',102,739,36,22,{fill:'#0A1F18',fontWeight:'bold',textAlign:'center'}),
    _t('Improve processing time',168,720,660,26,{fill:'#FFFFFF',fontWeight:'bold'}),
    _t('We changed to another supplier for your underperforming product.',168,752,780,21,{fill:'rgba(255,255,255,0.44)',lineHeight:1.4}),
    _r(60,856,960,158,'rgba(58,229,58,0.07)',{rx:20,ry:20,stroke:'rgba(58,229,58,0.16)',strokeWidth:1,strokeDashArray:null}),
    _c(120,935,28,{fill:'#3AE53A',stroke:null}),
    _t('✓',102,917,36,22,{fill:'#0A1F18',fontWeight:'bold',textAlign:'center'}),
    _t('Improve price & margins',168,898,660,26,{fill:'#FFFFFF',fontWeight:'bold'}),
    _t('We changed to another supplier for your underperforming product.',168,930,780,21,{fill:'rgba(255,255,255,0.44)',lineHeight:1.4}),
    _c(990,1285,46,{fill:'',stroke:'rgba(255,255,255,0.25)',strokeWidth:2,strokeDashArray:null}),
    _t('→',968,1265,44,28,{fill:'#FFFFFF',textAlign:'center'}),
  ]};

  // ── T10: Agency — Diagonal Tape ───────────────────────────────────────────
  const t10={version:'5.3.0',background:'#0B1E15',objects:[
    _r(0,0,1080,1350,'#0B1E15'),
    _r(-140,320,1440,90,'#00E8A2',{angle:-15,rx:0,ry:0,stroke:null,strokeWidth:0}),
    _t('YourAgency  ✦  Design & Product Agency  ✦  YourAgency  ✦  Design & Products',-96,342,1380,22,{fill:'#0B1E15',fontWeight:'bold',charSpacing:18,angle:-15}),
    _r(-140,502,1440,90,'#00E8A2',{angle:-15,rx:0,ry:0,stroke:null,strokeWidth:0}),
    _t('Open for Projects  ✦  Open for Projects  ✦  Open for Projects  ✦  Open',-96,524,1380,22,{fill:'#0B1E15',fontWeight:'bold',charSpacing:18,angle:-15}),
    _r(-140,684,1440,90,'#00E8A2',{angle:-15,rx:0,ry:0,stroke:null,strokeWidth:0}),
    _t('YourAgency  ✦  Design & Product Agency  ✦  YourAgency  ✦  Design & Products',-96,706,1380,22,{fill:'#0B1E15',fontWeight:'bold',charSpacing:18,angle:-15}),
    _t('⬡',510,112,62,56,{fill:'#FFFFFF',textAlign:'center',fontWeight:'bold'}),
    _t('We Design\nWe Build\nWe Scale',60,810,880,112,{fill:'#FFFFFF',fontFamily:'Arial Black',fontWeight:'bold',lineHeight:1.0,charSpacing:-15}),
    _t('youragency.com',60,1278,300,22,{fill:'rgba(255,255,255,0.42)'}),
    _t('→',978,1270,62,38,{fill:'#00E8A2',fontWeight:'bold',textAlign:'center'}),
  ]};

  const ten = [
    {id:'tpl-finance-hero-v3',         name:'Finance — Dark Hero',            desc:'Dark forest green with white content card, photo area placeholder, gold badge, and CTA button.', data:_w(t01)},
    {id:'tpl-finance-freedom-v3',      name:'Finance — Financial Freedom',    desc:'Light cream background with dark green diagonal sweep, bold headline, and content panel.', data:_w(t02)},
    {id:'tpl-finance-smart-v3',        name:'Finance — Smart Money Bold',     desc:'Dark green with large mixed-colour bold headline, accent side bar, and body quote box.', data:_w(t03)},
    {id:'tpl-finance-question-v3',     name:'Finance — Business Question',    desc:'Light cream background with floating white card, bold question headline, and icon badge.', data:_w(t04)},
    {id:'tpl-finance-cta-v3',          name:'Finance — Formalize CTA',        desc:'Dark green with bold white headline, yellow arrow badge, CTA button, and brand footer.', data:_w(t05)},
    {id:'tpl-creator-inner-card-v3',   name:'Creator — Dark Inner Card',      desc:'Very dark green with inner bordered card panel, accent-colour headline word, slide indicators.', data:_w(t06)},
    {id:'tpl-stats-big-number-v3',     name:'Stats — Big Number Showcase',    desc:'Dark background with large %70 stat, three metric chips, and supporting body text.', data:_w(t07)},
    {id:'tpl-comparison-split-v3',     name:'Comparison — VS Split',          desc:'1080×1080 black + neon green diagonal split. SEO vs PPC comparison with bullet lists.', data:_w(t08,1080)},
    {id:'tpl-feature-checklist-v3',    name:'Features — Dark Checklist',      desc:'Dark green with bold headline, three rounded feature rows with green check circles.', data:_w(t09)},
    {id:'tpl-agency-tape-v3',          name:'Agency — Diagonal Tape',         desc:'Dark green with three diagonal mint tape banners, bold 3-line headline, footer URL.', data:_w(t10)},
  ];
  for(const tmpl of ten){
    await pool.query(
      `INSERT INTO card_templates(id,name,description,design_data,is_published,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(id) DO UPDATE SET design_data=EXCLUDED.design_data,name=EXCLUDED.name,updated_at=EXCLUDED.updated_at`,
      [tmpl.id,tmpl.name,tmpl.desc,JSON.stringify(tmpl.data),true,now,now]
    );
  }
  logger.info('10 editable card templates upserted.');
} catch(e){ logger.warn('10 templates seed skipped:',e); }
// ── end 10 Editable Card Templates ─────────────────────────────────────────

// ── UpDraft Agency Tape poster template ────────────────────────────────────
try {
  const now = new Date().toISOString();
  const UPDRAFT_ID = 'updraft-agency-tape-poster-2026';
  const imageUrl = 'https://d8j0ntlcm91z4.cloudfront.net/user_3DSPVF70hppaORlPqQfWVzMK0VX/hf_20260509_203119_2849b11d-891a-4b0e-9837-cb67927f4904.png';
  const fabricJson = {
    version: '5.3.0',
    background: '#07120E',
    width: 1080,
    height: 1350,
    objects: [
      // Full-bleed background image
      {
        type: 'image', version: '5.3.0',
        originX: 'left', originY: 'top',
        left: 0, top: 0,
        width: 928, height: 1152,
        scaleX: 1080 / 928, scaleY: 1350 / 1152,
        angle: 0, flipX: false, flipY: false, opacity: 1,
        fill: 'rgb(0,0,0)', stroke: null, strokeWidth: 0,
        strokeDashArray: null, strokeLineCap: 'butt', strokeDashOffset: 0,
        strokeLineJoin: 'miter', strokeUniform: false, strokeMiterLimit: 4,
        shadow: null, visible: true, backgroundColor: '',
        fillRule: 'nonzero', paintFirst: 'fill',
        globalCompositeOperation: 'source-over', skewX: 0, skewY: 0,
        cropX: 0, cropY: 0,
        src: imageUrl,
        crossOrigin: 'anonymous', filters: [],
      },
      // Editable headline overlay (users can change the three lines)
      {
        type: 'textbox', version: '5.3.0',
        originX: 'left', originY: 'top',
        left: 64, top: 490, width: 900,
        text: 'We Design\nWe Build\nWe Scale',
        fontSize: 120, fontFamily: 'Inter', fontWeight: '800', fontStyle: 'normal',
        fill: '#DFFFEC', stroke: null, strokeWidth: 0,
        strokeDashArray: null, strokeLineCap: 'butt', strokeDashOffset: 0,
        strokeLineJoin: 'miter', strokeUniform: false, strokeMiterLimit: 4,
        angle: 0, flipX: false, flipY: false, opacity: 0,
        shadow: null, visible: true, backgroundColor: '',
        fillRule: 'nonzero', paintFirst: 'fill',
        globalCompositeOperation: 'source-over', skewX: 0, skewY: 0,
        textAlign: 'left', lineHeight: 0.96, charSpacing: -20,
        styles: [], direction: 'ltr', pathStartOffset: 0,
        pathSide: 'left', pathAlign: 'baseline',
        overline: false, underline: false, linethrough: false,
        textBackgroundColor: '', splitByGrapheme: false,
      },
      // Brand name (editable)
      {
        type: 'textbox', version: '5.3.0',
        originX: 'left', originY: 'top',
        left: 64, top: 1290, width: 600,
        text: 'updraft.agency',
        fontSize: 28, fontFamily: 'Inter', fontWeight: '500', fontStyle: 'normal',
        fill: '#DFFFEC', stroke: null, strokeWidth: 0,
        strokeDashArray: null, strokeLineCap: 'butt', strokeDashOffset: 0,
        strokeLineJoin: 'miter', strokeUniform: false, strokeMiterLimit: 4,
        angle: 0, flipX: false, flipY: false, opacity: 0,
        shadow: null, visible: true, backgroundColor: '',
        fillRule: 'nonzero', paintFirst: 'fill',
        globalCompositeOperation: 'source-over', skewX: 0, skewY: 0,
        textAlign: 'left', lineHeight: 1.2, charSpacing: 0,
        styles: [], direction: 'ltr', pathStartOffset: 0,
        pathSide: 'left', pathAlign: 'baseline',
        overline: false, underline: false, linethrough: false,
        textBackgroundColor: '', splitByGrapheme: false,
      },
    ],
  };
  const designData = { fabricVersion: true as const, canvasWidth: 1080, canvasHeight: 1350, fabricJson };
  await pool.query(
    `INSERT INTO card_templates (id, name, description, design_data, cover_image_url, is_published, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO UPDATE SET design_data=EXCLUDED.design_data, cover_image_url=EXCLUDED.cover_image_url, updated_at=EXCLUDED.updated_at`,
    [
      UPDRAFT_ID,
      'UpDraft — Agency Tape Poster',
      'Brutalist vinyl-tape agency poster (1080×1350). Deep green palette with neon #2BE38B tape bands, bold headline, and editorial layout. Open in canvas to customise headline and brand name.',
      JSON.stringify(designData),
      imageUrl,
      true,
      now, now,
    ]
  );
  logger.info('UpDraft Agency Tape template upserted.');
} catch (e) { logger.warn('UpDraft template seed skipped:', e); }
// ── end UpDraft Agency Tape seed ────────────────────────────────────────────

// ── arcgraphix Before/After carousel cover template ───────────────────────
try {
  const now = new Date().toISOString();
  const ARCGRAPHIX_ID = 'arcgraphix-before-after-carousel-2026';
  const imageUrl = 'https://d8j0ntlcm91z4.cloudfront.net/user_3DSPVF70hppaORlPqQfWVzMK0VX/hf_20260509_203530_37c2b6b3-c838-4a5f-b57e-b0bd335ad9c7.png';
  const fabricJson = {
    version: '5.3.0',
    background: '#0B1B2A',
    width: 1080,
    height: 1350,
    objects: [
      // Full-bleed background image
      {
        type: 'image', version: '5.3.0',
        originX: 'left', originY: 'top',
        left: 0, top: 0,
        width: 928, height: 1152,
        scaleX: 1080 / 928, scaleY: 1350 / 1152,
        angle: 0, flipX: false, flipY: false, opacity: 1,
        fill: 'rgb(0,0,0)', stroke: null, strokeWidth: 0,
        strokeDashArray: null, strokeLineCap: 'butt', strokeDashOffset: 0,
        strokeLineJoin: 'miter', strokeUniform: false, strokeMiterLimit: 4,
        shadow: null, visible: true, backgroundColor: '',
        fillRule: 'nonzero', paintFirst: 'fill',
        globalCompositeOperation: 'source-over', skewX: 0, skewY: 0,
        cropX: 0, cropY: 0,
        src: imageUrl,
        crossOrigin: 'anonymous', filters: [],
      },
      // Editable headline
      {
        type: 'textbox', version: '5.3.0',
        originX: 'left', originY: 'top',
        left: 64, top: 340, width: 950,
        text: 'Before and\nAfter Brand\nTransformation',
        fontSize: 110, fontFamily: 'Inter', fontWeight: '800', fontStyle: 'normal',
        fill: '#ffffff', stroke: null, strokeWidth: 0,
        strokeDashArray: null, strokeLineCap: 'butt', strokeDashOffset: 0,
        strokeLineJoin: 'miter', strokeUniform: false, strokeMiterLimit: 4,
        angle: 0, flipX: false, flipY: false, opacity: 0,
        shadow: null, visible: true, backgroundColor: '',
        fillRule: 'nonzero', paintFirst: 'fill',
        globalCompositeOperation: 'source-over', skewX: 0, skewY: 0,
        textAlign: 'left', lineHeight: 1.0, charSpacing: -30,
        styles: [], direction: 'ltr', pathStartOffset: 0,
        pathSide: 'left', pathAlign: 'baseline',
        overline: false, underline: false, linethrough: false,
        textBackgroundColor: '', splitByGrapheme: false,
      },
      // Editable body copy
      {
        type: 'textbox', version: '5.3.0',
        originX: 'left', originY: 'top',
        left: 64, top: 910, width: 780,
        text: 'This is how I helped Venyls Feast transform their look from confusing & outdated to clean, professional, and consistent.',
        fontSize: 26, fontFamily: 'Inter', fontWeight: '400', fontStyle: 'normal',
        fill: '#B7C2CD', stroke: null, strokeWidth: 0,
        strokeDashArray: null, strokeLineCap: 'butt', strokeDashOffset: 0,
        strokeLineJoin: 'miter', strokeUniform: false, strokeMiterLimit: 4,
        angle: 0, flipX: false, flipY: false, opacity: 0,
        shadow: null, visible: true, backgroundColor: '',
        fillRule: 'nonzero', paintFirst: 'fill',
        globalCompositeOperation: 'source-over', skewX: 0, skewY: 0,
        textAlign: 'left', lineHeight: 1.45, charSpacing: 0,
        styles: [], direction: 'ltr', pathStartOffset: 0,
        pathSide: 'left', pathAlign: 'baseline',
        overline: false, underline: false, linethrough: false,
        textBackgroundColor: '', splitByGrapheme: false,
      },
      // Handle / footer
      {
        type: 'textbox', version: '5.3.0',
        originX: 'left', originY: 'top',
        left: 64, top: 1290, width: 400,
        text: '@arcgraphix',
        fontSize: 24, fontFamily: 'Inter', fontWeight: '500', fontStyle: 'normal',
        fill: '#B7C2CD', stroke: null, strokeWidth: 0,
        strokeDashArray: null, strokeLineCap: 'butt', strokeDashOffset: 0,
        strokeLineJoin: 'miter', strokeUniform: false, strokeMiterLimit: 4,
        angle: 0, flipX: false, flipY: false, opacity: 0,
        shadow: null, visible: true, backgroundColor: '',
        fillRule: 'nonzero', paintFirst: 'fill',
        globalCompositeOperation: 'source-over', skewX: 0, skewY: 0,
        textAlign: 'left', lineHeight: 1.2, charSpacing: 0,
        styles: [], direction: 'ltr', pathStartOffset: 0,
        pathSide: 'left', pathAlign: 'baseline',
        overline: false, underline: false, linethrough: false,
        textBackgroundColor: '', splitByGrapheme: false,
      },
    ],
  };
  const designData = { fabricVersion: true as const, canvasWidth: 1080, canvasHeight: 1350, fabricJson };
  await pool.query(
    `INSERT INTO card_templates (id, name, description, design_data, cover_image_url, is_published, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO UPDATE SET design_data=EXCLUDED.design_data, cover_image_url=EXCLUDED.cover_image_url, updated_at=EXCLUDED.updated_at`,
    [
      ARCGRAPHIX_ID,
      'arcgraphix — Before/After Carousel Cover',
      'Editorial dark-portfolio Instagram carousel cover (1080×1350). Deep navy #0B1B2A, neon-green #22E06B accent, concentric arc background. Framed headline, stamp badge, decorative squiggle. Open in canvas to customise headline and body copy.',
      JSON.stringify(designData),
      imageUrl,
      true,
      now, now,
    ]
  );
  logger.info('arcgraphix Before/After template upserted.');
} catch (e) { logger.warn('arcgraphix template seed skipped:', e); }
// ── end arcgraphix seed ─────────────────────────────────────────────────────

// ─── Mailing Module (additive only) ────────────────────────────────────────

await pool.query(`
  CREATE TABLE IF NOT EXISTS mailing_contacts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    source TEXT DEFAULT 'manual',
    subscribed BOOLEAN NOT NULL DEFAULT true,
    email_marketing_consent BOOLEAN NOT NULL DEFAULT false,
    unsubscribe_token TEXT,
    unsubscribed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, email)
  );
`).catch(() => undefined);
await pool.query(`ALTER TABLE mailing_contacts ADD COLUMN IF NOT EXISTS unsubscribe_token TEXT;`).catch(() => undefined);
await pool.query(`ALTER TABLE mailing_contacts ADD COLUMN IF NOT EXISTS phone TEXT;`).catch(() => undefined);
await pool.query(`ALTER TABLE mailing_contacts ADD COLUMN IF NOT EXISTS custom_data JSONB DEFAULT '{}';`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS mailing_contacts_user_idx ON mailing_contacts (user_id);`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS mailing_contacts_email_idx ON mailing_contacts (email);`).catch(() => undefined);
await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS mailing_contacts_unsubscribe_token_unique_idx ON mailing_contacts (unsubscribe_token) WHERE unsubscribe_token IS NOT NULL;`).catch(() => undefined);
await pool.query(`UPDATE mailing_contacts SET unsubscribe_token = gen_random_uuid()::text WHERE unsubscribe_token IS NULL;`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS mailing_contact_tags (
    id TEXT PRIMARY KEY,
    contact_id TEXT NOT NULL REFERENCES mailing_contacts(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(contact_id, tag)
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS mailing_contact_tags_contact_idx ON mailing_contact_tags (contact_id);`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS mailing_segments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    rules JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS mailing_segments_user_idx ON mailing_segments (user_id);`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS mailing_campaigns (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    subject TEXT NOT NULL,
    preview_text TEXT,
    content TEXT NOT NULL DEFAULT '',
    segment_id TEXT REFERENCES mailing_segments(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    scheduled_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    recipient_count INTEGER DEFAULT 0,
    sent_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`ALTER TABLE mailing_campaigns ADD COLUMN IF NOT EXISTS sent_count INTEGER DEFAULT 0;`).catch(() => undefined);
await pool.query(`ALTER TABLE mailing_campaigns ADD COLUMN IF NOT EXISTS failed_count INTEGER DEFAULT 0;`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS mailing_campaigns_user_idx ON mailing_campaigns (user_id);`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS mailing_automations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    trigger_type TEXT NOT NULL DEFAULT 'signup',
    conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
    actions JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS mailing_automations_user_idx ON mailing_automations (user_id);`).catch(() => undefined);
// Flow-builder format: ordered step list (see MarketingAutomations.tsx). Legacy rows use conditions/actions.
await pool.query(`ALTER TABLE mailing_automations ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';`).catch(() => undefined);
await pool.query(`ALTER TABLE mailing_automations ADD COLUMN IF NOT EXISTS steps JSONB NOT NULL DEFAULT '[]'::jsonb;`).catch(() => undefined);

// Per-call AI token usage — populated by recordAIUsage() in ai-helpers.ts.
// Powers GET /api/admin/ai-usage and (later) credit metering of AI features.
await pool.query(`
  CREATE TABLE IF NOT EXISTS ai_usage_log (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    feature TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS ai_usage_user_idx ON ai_usage_log (user_id, created_at);`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS ai_usage_created_idx ON ai_usage_log (created_at);`).catch(() => undefined);
// Real provider cost + retail credits charged per call (see ai-helpers.ts credit economics)
await pool.query(`ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0;`).catch(() => undefined);
await pool.query(`ALTER TABLE ai_usage_log ADD COLUMN IF NOT EXISTS credits_charged INTEGER NOT NULL DEFAULT 0;`).catch(() => undefined);

// Audit trail for every credit movement: AI charges, image/video generation,
// admin grants, monthly resets. delta is negative for spend.
await pool.query(`
  CREATE TABLE IF NOT EXISTS credit_ledger (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    delta INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    reason TEXT NOT NULL,
    meta JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS credit_ledger_user_idx ON credit_ledger (user_id, created_at);`).catch(() => undefined);

// Lead-capture forms (Marketing → Forms). Hosted at /f/:id and embeddable via
// iframe; submissions upsert mailing_contacts and fire automation triggers.
await pool.query(`
  CREATE TABLE IF NOT EXISTS lead_forms (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    fields JSONB NOT NULL DEFAULT '[]'::jsonb,
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'active',
    submissions_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS lead_forms_user_idx ON lead_forms (user_id);`).catch(() => undefined);

// Website page views reported by the tracking pixel (/px.gif via /t.js).
// contact_id is set when the visitor was correlated to a mailing contact
// (cf_cid propagated by short-link redirects); anonymous views keep it NULL.
await pool.query(`
  CREATE TABLE IF NOT EXISTS page_view_events (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact_id TEXT,
    url TEXT,
    referrer TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS page_view_events_user_idx ON page_view_events (user_id, created_at DESC);`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS page_view_events_contact_idx ON page_view_events (contact_id, created_at DESC);`).catch(() => undefined);

// Campaign audience membership: which mailing contacts belong to which
// multi-channel campaign. Written by the automation add_to_campaign step;
// read by the in_campaign if_else condition and campaign detail views.

// ── MCP server connections (Admin → MCP). Platform-level integrations that
// speak the Model Context Protocol; env/headers hold secrets and are stored
// encrypted. First adapter: MeiGen AI Design (gallery → mcp_media).
await pool.query(`
  CREATE TABLE IF NOT EXISTS mcp_servers (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    transport TEXT NOT NULL DEFAULT 'stdio' CHECK (transport IN ('stdio','http')),
    command TEXT,
    args JSONB NOT NULL DEFAULT '[]'::jsonb,
    url TEXT,
    env_encrypted TEXT,
    headers_encrypted TEXT,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    enabled BOOLEAN NOT NULL DEFAULT false,
    status TEXT NOT NULL DEFAULT 'unconfigured',
    status_message TEXT,
    last_checked_at TIMESTAMPTZ,
    last_synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`).catch(() => undefined);

// Media pulled from MCP servers (e.g. MeiGen discover gallery): image +
// prompt + model. Powers the AI Studio Discover feed, personalization liked
// images, and AI suggestions.
await pool.query(`
  CREATE TABLE IF NOT EXISTS mcp_media (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    title TEXT,
    prompt TEXT,
    model TEXT,
    category TEXT,
    image_url TEXT NOT NULL,
    thumb_url TEXT,
    likes_count INTEGER NOT NULL DEFAULT 0,
    featured BOOLEAN NOT NULL DEFAULT false,
    raw JSONB NOT NULL DEFAULT '{}'::jsonb,
    fetched_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (server_id, external_id)
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS mcp_media_model_idx ON mcp_media (model);`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS mcp_media_created_idx ON mcp_media (created_at DESC);`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS mcp_media_likes (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_id TEXT NOT NULL REFERENCES mcp_media(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, media_id)
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS mcp_media_likes_user_idx ON mcp_media_likes (user_id, created_at DESC);`).catch(() => undefined);

// ── Auto-content plans: "create promo content with a featured image N times a
// day until <date>". Processed in the background by contentPlanRoutes.ts;
// each run produces a draft blog post (+ generated featured image) and an
// in-app notification. content_plan_runs is the per-piece audit trail.
await pool.query(`
  CREATE TABLE IF NOT EXISTS content_plans (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    topic TEXT NOT NULL DEFAULT '',
    tone TEXT NOT NULL DEFAULT 'engaging',
    per_day INTEGER NOT NULL DEFAULT 3 CHECK (per_day BETWEEN 1 AND 6),
    ends_at TIMESTAMPTZ,
    use_liked_style BOOLEAN NOT NULL DEFAULT true,
    generate_image BOOLEAN NOT NULL DEFAULT true,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','completed')),
    runs_count INTEGER NOT NULL DEFAULT 0,
    last_run_at TIMESTAMPTZ,
    next_run_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS content_plans_due_idx ON content_plans (next_run_at) WHERE status='active';`).catch(() => undefined);
await pool.query(`ALTER TABLE content_plans ADD COLUMN IF NOT EXISTS custom_instructions TEXT NOT NULL DEFAULT '';`).catch(() => undefined);
await pool.query(`ALTER TABLE content_plans ADD COLUMN IF NOT EXISTS image_mode TEXT NOT NULL DEFAULT 'auto';`).catch(() => undefined);
await pool.query(`ALTER TABLE content_plans ADD COLUMN IF NOT EXISTS ai_recommended BOOLEAN NOT NULL DEFAULT false;`).catch(() => undefined);
await pool.query(`ALTER TABLE content_plans ADD COLUMN IF NOT EXISTS estimated_credits INTEGER NOT NULL DEFAULT 0;`).catch(() => undefined);
// v2 pricing flow: plans are born 'pricing' (Planner + Calculator agents work
// out the real cost in the background), become 'priced', and only start
// running when the user explicitly starts them with enough balance.
await pool.query(`ALTER TABLE content_plans DROP CONSTRAINT IF EXISTS content_plans_status_check;`).catch(() => undefined);
await pool.query(`ALTER TABLE content_plans ADD CONSTRAINT content_plans_status_check CHECK (status IN ('pricing','priced','active','paused','completed'));`).catch(() => undefined);
await pool.query(`ALTER TABLE content_plans ADD COLUMN IF NOT EXISTS plan_blueprint JSONB NOT NULL DEFAULT '{}'::jsonb;`).catch(() => undefined);
await pool.query(`ALTER TABLE content_plans ADD COLUMN IF NOT EXISTS pricing_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb;`).catch(() => undefined);
await pool.query(`ALTER TABLE content_plans ADD COLUMN IF NOT EXISTS duration_days INTEGER NOT NULL DEFAULT 30;`).catch(() => undefined);

// Test account: keep "User One" topped up at 1,000,000 credits (re-applied
// on deploy if the lazy monthly reset knocked it down). Opt-in only — see
// isTestUserCreditGrantEnabled.
if (isTestUserCreditGrantEnabled()) {
  await pool.query(`
    INSERT INTO user_credits (user_id, credits)
    SELECT id, 1000000 FROM users WHERE full_name='User One' OR username='User One' OR username='userone'
    ON CONFLICT (user_id) DO UPDATE SET credits=GREATEST(user_credits.credits, 1000000), updated_at=NOW();
  `).catch(() => undefined);
  await pool.query(`
    INSERT INTO credit_ledger (id, user_id, delta, balance_after, reason)
    SELECT gen_random_uuid()::text, id, 1000000, 1000000, 'test_user_grant_1m'
    FROM users WHERE (full_name='User One' OR username='User One' OR username='userone')
      AND NOT EXISTS (SELECT 1 FROM credit_ledger cl WHERE cl.reason='test_user_grant_1m');
  `).catch(() => undefined);
}

await pool.query(`
  CREATE TABLE IF NOT EXISTS content_plan_runs (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    plan_id TEXT NOT NULL REFERENCES content_plans(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blog_post_id TEXT,
    title TEXT,
    image_url TEXT,
    status TEXT NOT NULL DEFAULT 'done',
    error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS content_plan_runs_plan_idx ON content_plan_runs (plan_id, created_at DESC);`).catch(() => undefined);

// Public API keys (Settings → API Keys). Only the SHA-256 hash is stored;
// the full key is shown once at creation. Used by POST /api/v1/trigger.
await pool.query(`
  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    key_prefix TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS api_keys_user_idx ON api_keys (user_id);`).catch(() => undefined);

// Durable continuations for automation runs: a row is created when a run hits a
// delay (status=pending, run_at in the future) or a wait_trigger (status=waiting,
// resumed when that trigger later fires for the same contact).
await pool.query(`
  CREATE TABLE IF NOT EXISTS mailing_automation_jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    automation_id TEXT NOT NULL,
    contact_id TEXT,
    contact JSONB NOT NULL DEFAULT '{}'::jsonb,
    steps JSONB NOT NULL DEFAULT '[]'::jsonb,
    wait_trigger TEXT,
    run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS mailing_automation_jobs_due_idx ON mailing_automation_jobs (status, run_at);`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS mailing_automation_jobs_user_idx ON mailing_automation_jobs (user_id);`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS mailing_email_events (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    campaign_id TEXT REFERENCES mailing_campaigns(id) ON DELETE CASCADE,
    contact_id TEXT REFERENCES mailing_contacts(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS mailing_email_events_campaign_idx ON mailing_email_events (campaign_id);`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS mailing_email_events_contact_idx ON mailing_email_events (contact_id);`).catch(() => undefined);
// Older deployments created mailing_email_events without metadata — needed for resend_id correlation
await pool.query(`ALTER TABLE mailing_email_events ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS mailing_email_events_resend_idx ON mailing_email_events ((metadata->>'resend_id')) WHERE metadata->>'resend_id' IS NOT NULL;`).catch(() => undefined);

// ── End Mailing Module ──────────────────────────────────────────────────────

// ── Surveys Module Tables ────────────────────────────────────────────────────
await pool.query(`
  CREATE TABLE IF NOT EXISTS surveys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    thank_you_message TEXT DEFAULT 'Thank you for your response!',
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS surveys_user_idx ON surveys (user_id);`).catch(() => undefined);
await pool.query(`
  CREATE TABLE IF NOT EXISTS survey_questions (
    id TEXT PRIMARY KEY,
    survey_id TEXT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    question TEXT NOT NULL,
    options JSONB DEFAULT '[]',
    required BOOLEAN DEFAULT FALSE,
    order_idx INTEGER DEFAULT 0,
    settings JSONB DEFAULT '{}'
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS survey_questions_survey_idx ON survey_questions (survey_id);`).catch(() => undefined);
await pool.query(`
  CREATE TABLE IF NOT EXISTS survey_responses (
    id TEXT PRIMARY KEY,
    survey_id TEXT NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
    contact_id TEXT REFERENCES mailing_contacts(id) ON DELETE SET NULL,
    respondent_email TEXT,
    answers JSONB NOT NULL DEFAULT '[]',
    ip_address TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS survey_responses_survey_idx ON survey_responses (survey_id);`).catch(() => undefined);
// ── End Surveys Module ───────────────────────────────────────────────────────

// ── Leads Module Tables ──────────────────────────────────────────────────────
await pool.query(`
  CREATE TABLE IF NOT EXISTS lead_groups (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    fields TEXT[] DEFAULT '{}',
    lead_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`
  CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    group_id TEXT NOT NULL REFERENCES lead_groups(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    data JSONB NOT NULL DEFAULT '{}',
    sync_key TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS sync_key TEXT;`).catch(() => undefined);
await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS leads_group_idx ON leads (group_id);`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS leads_user_idx ON leads (user_id);`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS leads_sync_key_idx ON leads (group_id, sync_key);`).catch(() => undefined);
// Google Sheets integration columns
await pool.query(`ALTER TABLE lead_groups ADD COLUMN IF NOT EXISTS linked_sheet_id TEXT;`).catch(() => undefined);
await pool.query(`ALTER TABLE lead_groups ADD COLUMN IF NOT EXISTS linked_sheet_tab TEXT;`).catch(() => undefined);
await pool.query(`ALTER TABLE lead_groups ADD COLUMN IF NOT EXISTS linked_sheet_name TEXT;`).catch(() => undefined);
await pool.query(`ALTER TABLE lead_groups ADD COLUMN IF NOT EXISTS sheet_key_field TEXT;`).catch(() => undefined);
await pool.query(`ALTER TABLE lead_groups ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;`).catch(() => undefined);
await pool.query(`
  CREATE TABLE IF NOT EXISTS google_sheets_tokens (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    token_expiry TIMESTAMPTZ NOT NULL,
    google_email TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`).catch(() => undefined);
// ── End Leads Module ─────────────────────────────────────────────────────────

// ── Analytics & Insights Engine Tables ──────────────────────────────────────
await pool.query(`
  CREATE TABLE IF NOT EXISTS social_metrics (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    platform_post_id TEXT NOT NULL,
    post_id TEXT,
    social_account_id TEXT,
    likes INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    impressions INTEGER DEFAULT 0,
    reach INTEGER DEFAULT 0,
    engagement INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    saves INTEGER DEFAULT 0,
    raw_data JSONB DEFAULT '{}'::jsonb,
    posted_at TIMESTAMPTZ,
    fetched_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, platform, platform_post_id)
  );
`);
await pool.query(`CREATE INDEX IF NOT EXISTS social_metrics_user_idx ON social_metrics (user_id);`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS social_metrics_platform_idx ON social_metrics (user_id, platform);`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS social_metrics_posted_idx ON social_metrics (posted_at);`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS account_metrics (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    social_account_id TEXT NOT NULL DEFAULT '',
    date DATE NOT NULL,
    followers INTEGER DEFAULT 0,
    impressions INTEGER DEFAULT 0,
    reach INTEGER DEFAULT 0,
    profile_views INTEGER DEFAULT 0,
    raw_data JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, platform, social_account_id, date)
  );
`);
await pool.query(`CREATE INDEX IF NOT EXISTS account_metrics_user_idx ON account_metrics (user_id);`).catch(() => undefined);

// One row per connected social account — upserted on every Sync click.
// Stores the latest profile snapshot returned by the platform API.
await pool.query(`
  CREATE TABLE IF NOT EXISTS social_profile_stats (
    id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    social_account_id TEXT NOT NULL,
    platform          TEXT NOT NULL,
    followers         BIGINT  DEFAULT 0,
    following         BIGINT  DEFAULT 0,
    posts_count       BIGINT  DEFAULT 0,
    total_likes       BIGINT  DEFAULT 0,
    bio               TEXT,
    is_verified       BOOLEAN DEFAULT FALSE,
    raw_response      JSONB   DEFAULT '{}'::jsonb,
    synced_at         TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(social_account_id)
  );
`);
await pool.query(`CREATE INDEX IF NOT EXISTS sps_user_idx ON social_profile_stats (user_id);`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS tiktok_video_insights (
    id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    social_account_id TEXT NOT NULL,
    video_id          TEXT NOT NULL,
    title             TEXT,
    cover_url         TEXT,
    share_url         TEXT,
    likes             BIGINT DEFAULT 0,
    comments          BIGINT DEFAULT 0,
    shares            BIGINT DEFAULT 0,
    views             BIGINT DEFAULT 0,
    engagement        BIGINT DEFAULT 0,
    duration_seconds  INTEGER DEFAULT 0,
    posted_at         TIMESTAMPTZ,
    fetched_at        TIMESTAMPTZ DEFAULT NOW(),
    raw_data          JSONB DEFAULT '{}'::jsonb,
    UNIQUE(social_account_id, video_id)
  );
`);
await pool.query(`CREATE INDEX IF NOT EXISTS tvi_user_idx ON tiktok_video_insights (user_id);`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS tvi_account_idx ON tiktok_video_insights (social_account_id);`).catch(() => undefined);
// Migrate: add enriched fields from video/query API
await pool.query(`ALTER TABLE tiktok_video_insights ADD COLUMN IF NOT EXISTS video_description TEXT`).catch(() => undefined);
await pool.query(`ALTER TABLE tiktok_video_insights ADD COLUMN IF NOT EXISTS embed_html TEXT`).catch(() => undefined);
await pool.query(`ALTER TABLE tiktok_video_insights ADD COLUMN IF NOT EXISTS embed_link TEXT`).catch(() => undefined);
await pool.query(`ALTER TABLE tiktok_video_insights ADD COLUMN IF NOT EXISTS height INTEGER DEFAULT 0`).catch(() => undefined);
await pool.query(`ALTER TABLE tiktok_video_insights ADD COLUMN IF NOT EXISTS width INTEGER DEFAULT 0`).catch(() => undefined);

// Facebook Pages Analytics Tables
await pool.query(`
  CREATE TABLE IF NOT EXISTS facebook_page_stats (
    id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    social_account_id TEXT NOT NULL,
    platform          TEXT NOT NULL DEFAULT 'facebook',
    followers         BIGINT  DEFAULT 0,
    page_likes        BIGINT  DEFAULT 0,
    posts_count       BIGINT  DEFAULT 0,
    engagement_rate   FLOAT   DEFAULT 0.0,
    bio               TEXT,
    picture_url       TEXT,
    raw_response      JSONB   DEFAULT '{}'::jsonb,
    synced_at         TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(social_account_id)
  );
`);
await pool.query(`CREATE INDEX IF NOT EXISTS fps_user_idx ON facebook_page_stats (user_id);`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS fps_account_idx ON facebook_page_stats (social_account_id);`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS facebook_post_insights (
    id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    social_account_id TEXT NOT NULL,
    post_id           TEXT NOT NULL,
    message           TEXT,
    picture           TEXT,
    story             TEXT,
    type              TEXT,
    permalink_url     TEXT,
    shares            BIGINT DEFAULT 0,
    likes_count       BIGINT DEFAULT 0,
    comments_count    BIGINT DEFAULT 0,
    engagement        BIGINT DEFAULT 0,
    created_at        TIMESTAMPTZ,
    fetched_at        TIMESTAMPTZ DEFAULT NOW(),
    raw_data          JSONB DEFAULT '{}'::jsonb,
    UNIQUE(social_account_id, post_id)
  );
`);
await pool.query(`CREATE INDEX IF NOT EXISTS fpi_user_idx ON facebook_post_insights (user_id);`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS fpi_account_idx ON facebook_post_insights (social_account_id);`).catch(() => undefined);

// LinkedIn Analytics Tables
await pool.query(`
  CREATE TABLE IF NOT EXISTS linkedin_profile_stats (
    id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    social_account_id TEXT NOT NULL,
    platform          TEXT NOT NULL DEFAULT 'linkedin',
    first_name        TEXT,
    last_name         TEXT,
    headline          TEXT,
    connections_count BIGINT DEFAULT 0,
    profile_picture_url TEXT,
    raw_response      JSONB DEFAULT '{}'::jsonb,
    synced_at         TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(social_account_id)
  );
`);
await pool.query(`CREATE INDEX IF NOT EXISTS lps_user_idx ON linkedin_profile_stats (user_id);`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS lps_account_idx ON linkedin_profile_stats (social_account_id);`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS linkedin_post_metrics (
    id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    social_account_id TEXT NOT NULL,
    post_id           TEXT NOT NULL,
    text              TEXT,
    post_url          TEXT,
    media_type        TEXT,
    created_at        TIMESTAMPTZ,
    fetched_at        TIMESTAMPTZ DEFAULT NOW(),
    raw_data          JSONB DEFAULT '{}'::jsonb,
    UNIQUE(social_account_id, post_id)
  );
`);
await pool.query(`CREATE INDEX IF NOT EXISTS lpm_user_idx ON linkedin_post_metrics (user_id);`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS lpm_account_idx ON linkedin_post_metrics (social_account_id);`).catch(() => undefined);

// LinkedIn Company Page Analytics Tables
await pool.query(`
  CREATE TABLE IF NOT EXISTS linkedin_company_stats (
    id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    social_account_id TEXT NOT NULL,
    organization_id   TEXT NOT NULL,
    organization_name TEXT,
    follower_count    BIGINT DEFAULT 0,
    engagement_rate   FLOAT DEFAULT 0.0,
    posts_created     BIGINT DEFAULT 0,
    logo_url          TEXT,
    description       TEXT,
    raw_response      JSONB DEFAULT '{}'::jsonb,
    synced_at         TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(social_account_id, organization_id)
  );
`);
await pool.query(`CREATE INDEX IF NOT EXISTS lcs_user_idx ON linkedin_company_stats (user_id);`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS lcs_org_idx ON linkedin_company_stats (organization_id);`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS linkedin_company_posts (
    id                 TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    social_account_id  TEXT NOT NULL,
    post_id            TEXT NOT NULL,
    organization_id    TEXT NOT NULL,
    text               TEXT,
    media_type         TEXT,
    impressions        BIGINT DEFAULT 0,
    likes              BIGINT DEFAULT 0,
    comments           BIGINT DEFAULT 0,
    reposts            BIGINT DEFAULT 0,
    clicks             BIGINT DEFAULT 0,
    engagement_rate    FLOAT DEFAULT 0.0,
    created_at         TIMESTAMPTZ,
    fetched_at         TIMESTAMPTZ DEFAULT NOW(),
    raw_data           JSONB DEFAULT '{}'::jsonb,
    UNIQUE(social_account_id, post_id)
  );
`);
await pool.query(`CREATE INDEX IF NOT EXISTS lcp_user_idx ON linkedin_company_posts (user_id);`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS lcp_org_idx ON linkedin_company_posts (organization_id);`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS insights_cache (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cache_key TEXT NOT NULL,
    data JSONB NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, cache_key)
  );
`);
await pool.query(`CREATE INDEX IF NOT EXISTS insights_cache_user_idx ON insights_cache (user_id);`).catch(() => undefined);
// ── End Analytics Tables ─────────────────────────────────────────────────────

// ── Campaign & Funnel Builder Tables ─────────────────────────────────────────
await pool.query(`
  CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    goal TEXT NOT NULL DEFAULT 'awareness',
    status TEXT NOT NULL DEFAULT 'draft',
    start_date DATE,
    end_date DATE,
    budget NUMERIC(12,2),
    currency TEXT DEFAULT 'USD',
    target_url TEXT DEFAULT '',
    tags TEXT[] DEFAULT '{}',
    settings JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`);
await pool.query(`CREATE INDEX IF NOT EXISTS campaigns_user_idx ON campaigns (user_id);`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS campaigns_status_idx ON campaigns (user_id, status);`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS campaign_channels (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_type TEXT NOT NULL,
    social_account_id TEXT REFERENCES social_accounts(id) ON DELETE SET NULL,
    config JSONB DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`);
await pool.query(`CREATE INDEX IF NOT EXISTS campaign_channels_campaign_idx ON campaign_channels (campaign_id);`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS funnels (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`);
await pool.query(`CREATE INDEX IF NOT EXISTS funnels_campaign_idx ON funnels (campaign_id);`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS funnels_user_idx ON funnels (user_id);`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS funnel_steps (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    funnel_id TEXT NOT NULL REFERENCES funnels(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    step_order INTEGER NOT NULL DEFAULT 0,
    step_type TEXT NOT NULL DEFAULT 'page_view',
    target_url TEXT DEFAULT '',
    goal_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`);
await pool.query(`CREATE INDEX IF NOT EXISTS funnel_steps_funnel_idx ON funnel_steps (funnel_id, step_order);`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS funnel_events (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    funnel_id TEXT,
    funnel_step_id TEXT,
    campaign_id TEXT,
    owner_user_id TEXT,
    session_id TEXT,
    visitor_id TEXT,
    event_type TEXT NOT NULL,
    event_name TEXT,
    url TEXT,
    referrer TEXT,
    utm_source TEXT,
    utm_medium TEXT,
    utm_campaign TEXT,
    utm_term TEXT,
    utm_content TEXT,
    properties JSONB DEFAULT '{}'::jsonb,
    ip TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`);
await pool.query(`CREATE INDEX IF NOT EXISTS funnel_events_funnel_idx ON funnel_events (funnel_id);`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS funnel_events_campaign_idx ON funnel_events (campaign_id);`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS funnel_events_created_idx ON funnel_events (created_at);`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS funnel_events_utm_idx ON funnel_events (utm_campaign, utm_source);`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS utm_links (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    base_url TEXT NOT NULL,
    utm_source TEXT NOT NULL,
    utm_medium TEXT NOT NULL,
    utm_campaign TEXT NOT NULL,
    utm_term TEXT DEFAULT '',
    utm_content TEXT DEFAULT '',
    short_code TEXT,
    full_url TEXT NOT NULL,
    clicks INTEGER DEFAULT 0,
    conversions INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(short_code)
  );
`);
await pool.query(`CREATE INDEX IF NOT EXISTS utm_links_campaign_idx ON utm_links (campaign_id);`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS utm_links_user_idx ON utm_links (user_id);`).catch(() => undefined);
// ── Campaign Execution Tables ────────────────────────────────────────────────
await pool.query(`
  CREATE TABLE IF NOT EXISTS campaign_jobs (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    job_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    job_id TEXT,
    payload JSONB DEFAULT '{}'::jsonb,
    error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`);
await pool.query(`CREATE INDEX IF NOT EXISTS campaign_jobs_campaign_idx ON campaign_jobs (campaign_id);`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS campaign_jobs_status_idx ON campaign_jobs (user_id, status);`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS campaign_attribution (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    model TEXT NOT NULL DEFAULT 'last_touch',
    visitor_id TEXT,
    session_id TEXT,
    first_touch_source TEXT,
    first_touch_medium TEXT,
    first_touch_at TIMESTAMPTZ,
    last_touch_source TEXT,
    last_touch_medium TEXT,
    last_touch_at TIMESTAMPTZ,
    converted BOOLEAN DEFAULT FALSE,
    converted_at TIMESTAMPTZ,
    revenue NUMERIC(12,2),
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`);
await pool.query(`CREATE INDEX IF NOT EXISTS campaign_attribution_campaign_idx ON campaign_attribution (campaign_id);`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS campaign_attribution_visitor_idx ON campaign_attribution (campaign_id, visitor_id);`).catch(() => undefined);

await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS mailing_campaign_id TEXT;`).catch(() => undefined);
await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS attribution_model TEXT NOT NULL DEFAULT 'last_touch';`).catch(() => undefined);
await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS launched_at TIMESTAMPTZ;`).catch(() => undefined);
await pool.query(`ALTER TABLE mailing_campaigns ADD COLUMN IF NOT EXISTS campaign_id TEXT REFERENCES campaigns(id) ON DELETE SET NULL;`).catch(() => undefined);
// ── Campaign KPIs & Content ───────────────────────────────────────────────────
await pool.query(`
  CREATE TABLE IF NOT EXISTS campaign_kpis (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    metric_type TEXT NOT NULL DEFAULT 'number',
    target_value NUMERIC(12,2) NOT NULL DEFAULT 0,
    current_value NUMERIC(12,2) NOT NULL DEFAULT 0,
    unit TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'manual',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS campaign_kpis_campaign_idx ON campaign_kpis (campaign_id);`).catch(() => undefined);
await pool.query(`
  CREATE TABLE IF NOT EXISTS campaign_content (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content_type TEXT NOT NULL DEFAULT 'post',
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',
    channel TEXT NOT NULL DEFAULT '',
    external_id TEXT,
    metrics JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS campaign_content_campaign_idx ON campaign_content (campaign_id);`).catch(() => undefined);
// ── End Campaign Tables ───────────────────────────────────────────────────────

// ─── Billing / Subscriptions ─────────────────────────────────────────────────
// Extend pricing_plans with Stripe price IDs and feature limits
await pool.query(`ALTER TABLE pricing_plans ADD COLUMN IF NOT EXISTS stripe_price_id TEXT;`).catch(() => undefined);
await pool.query(`ALTER TABLE pricing_plans ADD COLUMN IF NOT EXISTS stripe_annual_price_id TEXT;`).catch(() => undefined);
await pool.query(`ALTER TABLE pricing_plans ADD COLUMN IF NOT EXISTS post_limit INT;`).catch(() => undefined);
await pool.query(`ALTER TABLE pricing_plans ADD COLUMN IF NOT EXISTS user_limit INT;`).catch(() => undefined);
await pool.query(`ALTER TABLE pricing_plans ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0;`).catch(() => undefined);

// Extend users with Stripe customer ID + current plan reference
await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;`).catch(() => undefined);
await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_id TEXT REFERENCES pricing_plans(id) ON DELETE SET NULL;`).catch(() => undefined);
await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_stripe_customer_id_idx ON users (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id TEXT REFERENCES pricing_plans(id) ON DELETE SET NULL,
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    stripe_price_id TEXT,
    status TEXT NOT NULL DEFAULT 'free',
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    cancel_at_period_end BOOLEAN DEFAULT FALSE,
    canceled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id)
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS subscriptions_user_idx ON subscriptions (user_id);`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS subscriptions_status_idx ON subscriptions (status);`).catch(() => undefined);
await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_stripe_sub_idx ON subscriptions (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS user_payment_methods (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stripe_payment_method_id TEXT UNIQUE,
    card_brand TEXT,
    card_last_four TEXT,
    card_exp_month INT,
    card_exp_year INT,
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS upm_user_idx ON user_payment_methods (user_id);`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS billing_invoices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subscription_id TEXT REFERENCES subscriptions(id) ON DELETE SET NULL,
    stripe_invoice_id TEXT UNIQUE,
    invoice_number TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    subtotal_cents INT NOT NULL DEFAULT 0,
    tax_cents INT NOT NULL DEFAULT 0,
    total_cents INT NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'usd',
    hosted_invoice_url TEXT,
    invoice_pdf TEXT,
    period_start TIMESTAMPTZ,
    period_end TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS billing_invoices_user_idx ON billing_invoices (user_id);`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS billing_invoices_status_idx ON billing_invoices (status);`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS billing_events (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    event_type TEXT NOT NULL,
    stripe_event_id TEXT,
    data JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS billing_events_stripe_evt_idx ON billing_events (stripe_event_id) WHERE stripe_event_id IS NOT NULL;`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS billing_events_user_idx ON billing_events (user_id);`).catch(() => undefined);
// ── End Billing Tables ────────────────────────────────────────────────────────

// ── Credits System ────────────────────────────────────────────────────────────
await pool.query(`
  CREATE TABLE IF NOT EXISTS user_credits (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    credits INTEGER NOT NULL DEFAULT 0,
    reset_date TIMESTAMPTZ NOT NULL DEFAULT (date_trunc('month', NOW()) + INTERVAL '1 month'),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS design_likes (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    design_id TEXT NOT NULL,
    design_type TEXT NOT NULL DEFAULT 'user',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, design_id)
  );
`).catch(() => undefined);

await pool.query(`ALTER TABLE card_templates ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0;`).catch(() => undefined);
await pool.query(`ALTER TABLE card_templates ADD COLUMN IF NOT EXISTS like_count INTEGER NOT NULL DEFAULT 0;`).catch(() => undefined);
await pool.query(`ALTER TABLE pricing_plans ADD COLUMN IF NOT EXISTS credits_per_month INTEGER NOT NULL DEFAULT 0;`).catch(() => undefined);

// Update existing plans with credits_per_month if not already set
await pool.query(`UPDATE pricing_plans SET credits_per_month = 100  WHERE name ILIKE '%Free%'    AND credits_per_month = 0;`).catch(() => undefined);
await pool.query(`UPDATE pricing_plans SET credits_per_month = 100  WHERE name ILIKE '%Starter%' AND credits_per_month = 0;`).catch(() => undefined);
await pool.query(`UPDATE pricing_plans SET credits_per_month = 2000 WHERE name ILIKE '%Pro%'     AND credits_per_month = 0;`).catch(() => undefined);
await pool.query(`UPDATE pricing_plans SET credits_per_month = 2000 WHERE name ILIKE '%Growth%'  AND credits_per_month = 0;`).catch(() => undefined);
await pool.query(`UPDATE pricing_plans SET credits_per_month = 6000 WHERE name ILIKE '%Agency%'  AND credits_per_month = 0;`).catch(() => undefined);
await pool.query(`UPDATE pricing_plans SET credits_per_month = 6000 WHERE name ILIKE '%Scale%'   AND credits_per_month = 0;`).catch(() => undefined);
// ── End Credits System ────────────────────────────────────────────────────────

// ── User Memory ───────────────────────────────────────────────────────────────
await pool.query(`
  CREATE TABLE IF NOT EXISTS user_memories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category    TEXT NOT NULL DEFAULT 'custom',
    title       TEXT NOT NULL,
    content     TEXT NOT NULL,
    source      TEXT NOT NULL DEFAULT 'manual',
    sort_order  INT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS user_memories_user_id_idx ON user_memories (user_id);`).catch(() => undefined);

// ── Notifications ─────────────────────────────────────────────────────────────
await pool.query(`
  CREATE TABLE IF NOT EXISTS notifications (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type        TEXT NOT NULL DEFAULT 'info',
    title       TEXT NOT NULL,
    message     TEXT NOT NULL DEFAULT '',
    data        JSONB NOT NULL DEFAULT '{}',
    is_read     BOOLEAN NOT NULL DEFAULT false,
    pinned      BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS notifications_user_id_idx ON notifications (user_id, created_at DESC);`).catch(() => undefined);
await pool.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT false;`).catch(() => undefined);
// ── End Notifications ─────────────────────────────────────────────────────────

// ── Apify ─────────────────────────────────────────────────────────────────────
await pool.query(`
  CREATE TABLE IF NOT EXISTS apify_actors (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id    TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    tag         TEXT NOT NULL DEFAULT 'Custom',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`
  CREATE TABLE IF NOT EXISTS apify_runs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_db_id   UUID REFERENCES apify_actors(id) ON DELETE SET NULL,
    actor_name    TEXT NOT NULL,
    apify_run_id  TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'READY',
    input         JSONB,
    dataset_id    TEXT,
    started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at   TIMESTAMPTZ
  );
`).catch(() => undefined);
// ── End Apify ─────────────────────────────────────────────────────────────────

// ── Higgsfield ────────────────────────────────────────────────────────────────
await pool.query(`
  CREATE TABLE IF NOT EXISTS higgsfield_generations (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type         TEXT NOT NULL DEFAULT 'image',
    model        TEXT NOT NULL DEFAULT '',
    prompt       TEXT NOT NULL DEFAULT '',
    params       JSONB,
    status       TEXT NOT NULL DEFAULT 'pending',
    result_url   TEXT,
    error        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`).catch(() => undefined);
// ── End Higgsfield ────────────────────────────────────────────────────────────

// ── Magnific AI ────────────────────────────────────────────────────────────────
await pool.query(`
  CREATE TABLE IF NOT EXISTS magnific_generations (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      TEXT REFERENCES users(id) ON DELETE CASCADE,
    type         TEXT NOT NULL DEFAULT 'image',
    model        TEXT NOT NULL DEFAULT '',
    prompt       TEXT NOT NULL DEFAULT '',
    params       JSONB DEFAULT '{}',
    task_id      TEXT,
    status       TEXT NOT NULL DEFAULT 'pending',
    result_url   TEXT,
    error        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
  );
`).catch(() => undefined);
// ── Discover Feed ─────────────────────────────────────────────────────────────
await pool.query(`
  CREATE TABLE IF NOT EXISTS discover_feed (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    generation_id UUID NOT NULL REFERENCES magnific_generations(id) ON DELETE CASCADE,
    pushed_by     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pushed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    visible       BOOLEAN NOT NULL DEFAULT true
  );
`).catch(() => undefined);
await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS discover_feed_gen_idx ON discover_feed (generation_id);`).catch(() => undefined);
// ── End Discover Feed ──────────────────────────────────────────────────────────

// ── End Magnific ────────────────────────────────────────────────────────────────

// ── Kling AI ──────────────────────────────────────────────────────────────────
await pool.query(`
  CREATE TABLE IF NOT EXISTS kling_generations (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      TEXT REFERENCES users(id) ON DELETE CASCADE,
    type         TEXT NOT NULL DEFAULT 'video',
    model        TEXT NOT NULL DEFAULT '',
    prompt       TEXT NOT NULL DEFAULT '',
    params       JSONB NOT NULL DEFAULT '{}',
    task_id      TEXT,
    status       TEXT NOT NULL DEFAULT 'pending',
    result_url   TEXT,
    error        TEXT,
    credits_used INTEGER NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
  );
`).catch(() => undefined);
// ── End Kling AI ──────────────────────────────────────────────────────────────

// ── Google AI ─────────────────────────────────────────────────────────────────
await pool.query(`
  CREATE TABLE IF NOT EXISTS google_generations (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       TEXT REFERENCES users(id) ON DELETE CASCADE,
    type          TEXT NOT NULL DEFAULT 'image',
    model         TEXT NOT NULL DEFAULT '',
    prompt        TEXT NOT NULL DEFAULT '',
    params        JSONB NOT NULL DEFAULT '{}',
    operation_name TEXT,
    status        TEXT NOT NULL DEFAULT 'pending',
    result_url    TEXT,
    error         TEXT,
    credits_used  INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at  TIMESTAMPTZ
  );
`).catch(() => undefined);
// ── End Google AI ─────────────────────────────────────────────────────────────

// ── OpenAI ────────────────────────────────────────────────────────────────────
await pool.query(`
  CREATE TABLE IF NOT EXISTS openai_generations (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       TEXT REFERENCES users(id) ON DELETE CASCADE,
    type          TEXT NOT NULL DEFAULT 'image',
    model         TEXT NOT NULL DEFAULT '',
    prompt        TEXT NOT NULL DEFAULT '',
    params        JSONB NOT NULL DEFAULT '{}',
    status        TEXT NOT NULL DEFAULT 'pending',
    result_url    TEXT,
    error         TEXT,
    credits_used  INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at  TIMESTAMPTZ
  );
`).catch(() => undefined);
// ── End OpenAI ────────────────────────────────────────────────────────────────

// ── Daky Learn ────────────────────────────────────────────────────────────────
await pool.query(`
  CREATE TABLE IF NOT EXISTS learned_items (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title       TEXT NOT NULL,
    url         TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'article',
    summary     TEXT NOT NULL DEFAULT '',
    key_points  TEXT[] NOT NULL DEFAULT '{}',
    category    TEXT NOT NULL DEFAULT 'General',
    labels      TEXT[] NOT NULL DEFAULT '{}',
    raw_content TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS learned_items_category_idx ON learned_items (category);`).catch(() => undefined);
await pool.query(`ALTER TABLE learned_items ADD COLUMN IF NOT EXISTS saas_application TEXT NOT NULL DEFAULT ''`).catch(() => undefined);
// ── End Daky Learn ────────────────────────────────────────────────────────────

// ── Agent System ──────────────────────────────────────────────────────────────
await pool.query(`
  CREATE TABLE IF NOT EXISTS agent_templates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_key       TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    role            TEXT NOT NULL,
    icon            TEXT NOT NULL DEFAULT '✦',
    color           TEXT NOT NULL DEFAULT '#5B6CF9',
    base_prompt     TEXT NOT NULL DEFAULT '',
    memory_keywords TEXT[] NOT NULL DEFAULT '{}',
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`
  CREATE TABLE IF NOT EXISTS user_agents (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- users.id is TEXT; a UUID column here made the FK (and the whole CREATE)
    -- fail silently on every boot, so this table never existed in production
    user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_key        TEXT NOT NULL,
    compiled_skill   TEXT NOT NULL DEFAULT '',
    last_compiled_at TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, agent_key)
  );
`).catch((err) => logger.error({ err }, 'migration_failed: user_agents'));
await pool.query(`
  CREATE TABLE IF NOT EXISTS agent_activity (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- users.id is TEXT — see user_agents above
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_key     TEXT NOT NULL,
    agent_name    TEXT NOT NULL DEFAULT '',
    activity_type TEXT NOT NULL DEFAULT 'report',
    title         TEXT NOT NULL,
    content       TEXT NOT NULL,
    is_read       BOOLEAN NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`).catch((err) => logger.error({ err }, 'migration_failed: agent_activity'));
await pool.query(`CREATE INDEX IF NOT EXISTS agent_activity_user_idx ON agent_activity (user_id, created_at DESC);`).catch(() => undefined);
// Seed default agent templates (skip if already exist)
await pool.query(`
  INSERT INTO agent_templates (agent_key, name, role, icon, color, base_prompt, memory_keywords) VALUES
  ('daky', 'Daky', 'Orchestrator & Strategist', '✦', '#5B6CF9',
   'You are Daky, the orchestrating AI strategist of the Dakyworld Hub marketing team. You have 55 years of expertise across all marketing disciplines. You synthesize insights from your specialist team into clear, actionable guidance. When given team analyses, weave them into a unified, decisive recommendation.',
   '{}'),
  ('nova', 'Nova', 'Creative Director', '◉', '#EC4899',
   'You are Nova, the Creative Director of the Dakyworld Hub marketing team. You specialize in brand voice, visual direction, content ideation, and audience engagement. You see every piece of content as an opportunity to reinforce identity and create emotional connection.',
   '{brand,voice,visual,content,product,audience}'),
  ('sage', 'Sage', 'Strategy Analyst', '◈', '#10B981',
   'You are Sage, the Strategy Analyst of the Dakyworld Hub marketing team. You specialize in market positioning, competitive analysis, campaign strategy, and goal-setting. You translate business goals into winning marketing strategies.',
   '{goal,competit,strategy,industry,market,target,campaign}'),
  ('aria', 'Aria', 'Analytics & Performance', '⊕', '#F59E0B',
   'You are Aria, the Analytics & Performance specialist of the Dakyworld Hub marketing team. You specialize in KPI tracking, performance insights, business metrics, and ROI analysis. Every recommendation you make is grounded in data.',
   '{analytic,performance,kpi,metric,business}'),
  ('flux', 'Flux', 'Automation & Workflows', '⟳', '#8B5CF6',
   'You are Flux, the Automation & Workflow specialist of the Dakyworld Hub marketing team. You specialize in platform integrations, scheduling automation, workflow optimization, and tool orchestration across social channels.',
   '{automat,workflow,platform,social,schedule}')
  ON CONFLICT (agent_key) DO NOTHING;
`).catch(() => undefined);
// Seed specialized marketing agents (Phase 11)
const _newAgents = [
  { key: 'trend_research',    name: 'Trend',   role: 'Trend Research',         icon: '◎', color: '#06B6D4',
    prompt: 'You are the Trend Research Agent for {brand.brand_name}. You detect emerging trends, viral topics, and timely content angles in the {brand.niche} space before competitors notice. Every trend you surface must have a clear relevance to the brand, an evidence signal (volume, growth, mentions), a suggested content angle, and a decay risk rating. You never invent metrics. If a metric cannot be verified, mark it "unverified".',
    keywords: '{trend,viral,topic,niche,platform,channel,tiktok,instagram}' },
  { key: 'audience_research', name: 'Persona', role: 'Audience Research',       icon: '◑', color: '#7C3AED',
    prompt: 'You are the Audience Research Agent for {brand.brand_name}. You deeply analyze the target audience: {brand.audience}. You extract their top pain points (with verbatim quotes when possible), desired outcomes, jobs-to-be-done, objections, the exact vocabulary they use, and what would make them buy or churn. You build 1–3 detailed persona profiles. You never fabricate quotes — if you cannot find a verbatim, mark the insight as "inferred, low confidence".',
    keywords: '{audience,persona,pain,buyer,customer,segment,icp}' },
  { key: 'seo_research',      name: 'SEO',     role: 'SEO Keyword Research',    icon: '⊗', color: '#059669',
    prompt: 'You are the SEO Keyword Research Agent for {brand.brand_name} in the {brand.niche} space. You find organic search opportunities — keywords with real buyer intent and achievable ranking difficulty. You cluster by intent (informational/commercial/transactional), map to funnel stage (TOFU/MOFU/BOFU), recommend content formats, and flag cannibalization risks. You never recommend black-hat tactics.',
    keywords: '{seo,keyword,search,organic,ranking,content,blog}' },
  { key: 'hook_writing',      name: 'Hook',    role: 'Hook Writing',            icon: '⚡', color: '#D97706',
    prompt: 'You are the Hook Writing Agent for {brand.brand_name}. Your sole job is to write the first 1–3 seconds of attention — scroll-stopping opening lines that make someone commit to reading or watching. You generate 8–12 hook variations across patterns: pattern interrupt, contrarian, stat-led, question, before/after, ICP callout, story cold-open, problem amplification. Every hook must be honest — it cannot promise a payoff the content cannot deliver. Tone: {brand.tone}.',
    keywords: '{hook,headline,opening,attention,scroll,viral,caption}' },
  { key: 'social_caption',    name: 'Caption', role: 'Social Caption',          icon: '✎', color: '#DB2777',
    prompt: 'You are the Social Caption Agent for {brand.brand_name}. You write platform-native captions for {brand.platforms} that respect each platform\'s culture, character limits, and engagement mechanics. You produce A/B variants. For LinkedIn: 1200–2000 chars, professional but human, 3–5 hashtags. For TikTok/Instagram: conversational, ≤150 chars, 3–5 hashtags. Always include one clear CTA aligned to the brand\'s conversion goal. Tone: {brand.tone}. Audience: {brand.audience}.',
    keywords: '{caption,social,post,instagram,linkedin,tiktok,hashtag}' },
  { key: 'video_script',      name: 'Script',  role: 'Video Script',            icon: '▶', color: '#DC2626',
    prompt: 'You are the Video Script Agent for {brand.brand_name}. You produce structured short-form (≤60s) and long-form (3–15 min) video scripts. Short-form structure: Hook → Problem amplification → Reveal/Proof → CTA (with second-by-second timing). Long-form: cold open → promise → 3–5 segments with retention beats every 60–90s → recap → CTA. You include on-screen text cues, b-roll/visual notes, voiceover lines, and timestamps. Brand voice: {brand.tone}.',
    keywords: '{video,script,reel,tiktok,youtube,voiceover,hook}' },
  { key: 'ad_copy',           name: 'Ads',     role: 'Ad Copy',                 icon: '◆', color: '#EA580C',
    prompt: 'You are the Ad Copy Agent for {brand.brand_name}. You write paid-traffic copy for Meta, Google, LinkedIn, and TikTok ads — optimized for CTR and post-click conversion. You produce 5–10 variations per placement, varied by angle: pain-led, outcome-led, social proof, contrarian, FOMO/urgency, identity, comparison. Each variation declares the hypothesis it tests. You never claim "guaranteed results" or fabricate testimonials. Audience: {brand.audience}. Tone: {brand.tone}.',
    keywords: '{ad,paid,meta,google,linkedin,ctr,copy,conversion}' },
  { key: 'thumbnail_design',  name: 'Thumb',   role: 'Thumbnail Design',        icon: '▣', color: '#9333EA',
    prompt: 'You are the Thumbnail Design Agent for {brand.brand_name}. You produce visual concept briefs for YouTube thumbnails, ad creatives, and social cards that maximize CTR. For each asset you produce 3 distinct concepts specifying: layout, focal element, dominant emotion, color palette (with hex codes), text overlay (≤4 words), background style, and what to avoid. You always provide A/B test pairs with a hypothesis. Principles: high contrast, single focal point, readable at thumbnail size.',
    keywords: '{thumbnail,visual,creative,design,youtube,banner,image}' },
  { key: 'meta_ads',          name: 'Meta',    role: 'Paid Social Manager',     icon: '⊛', color: '#1877F2',
    prompt: 'You are the Meta Ads Manager for {brand.brand_name}. You plan Facebook and Instagram paid campaign structures — objective → ad sets → audiences → creatives. You define decision rules: pause when CPA exceeds 1.5× target after 2× spend; scale when ROAS ≥ target for 2 consecutive days (≤20%/day increase); flag creative fatigue when frequency > 3 and CTR drops >30%. You produce daily performance reports with clear recommended actions. You never exceed pre-approved budget caps.',
    keywords: '{meta,facebook,instagram,ads,roas,cpa,budget,paid}' },
];
for (const a of _newAgents) {
  await pool.query(
    `INSERT INTO agent_templates (agent_key, name, role, icon, color, base_prompt, memory_keywords)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (agent_key) DO NOTHING`,
    [a.key, a.name, a.role, a.icon, a.color, a.prompt, `{${a.keywords.replace(/[{}]/g,'')}}`]
  ).catch(() => undefined);
}
// Update sage and aria with full-quality prompts (UPDATE overrides DO NOTHING)
await pool.query(
  `UPDATE agent_templates SET base_prompt=$1 WHERE agent_key='sage'`,
  [`You are Sage, the Campaign Strategy Analyst for {brand.brand_name}. You hold 20+ years of strategic marketing expertise. When asked to build a campaign brief, always output your response in the following structured format:\n\n## SITUATION\nWhat is the current business/market context? Describe the starting point: current position of {brand.brand_name}, competitive pressure, opportunity window, or problem to solve. Be specific — no generic filler.\n\n## GOAL\nState 1 primary goal in measurable terms (e.g., "Grow email list from 0 to 500 subscribers in 30 days") and up to 2 secondary goals. Tie directly to {brand.goals}.\n\n## TARGET AUDIENCE\nName the primary persona. Include: demographics, top pain point, desired outcome, what they're currently using/doing instead. Base on {brand.audience}.\n\n## KEY MESSAGE\nOne sentence: what is the single idea you want this audience to walk away with? Then the proof point or reason-to-believe.\n\n## CHANNELS\nRecommend 2–4 channels from {brand.platforms}. For each, state: role in funnel (awareness/consideration/conversion/retention), content format, cadence (posts per week), KPI to watch.\n\n## CONTENT CADENCE\nWeek-by-week content plan for the campaign duration. Each week: theme, key pieces of content (format + topic + channel), one "hero" piece.\n\n## SUCCESS METRICS\nDefine 3–5 KPIs with specific targets. For each: metric name, target value with unit, measurement frequency, data source.\n\n## RISKS & MITIGATIONS\n2–3 execution risks. For each: what could go wrong, impact level (low/medium/high), mitigation action.\n\nRules:\n- Be specific, not generic. Use numbers when possible.\n- If you don't have enough information, ask one targeted clarifying question before building the brief.\n- Brand voice throughout must match: {brand.tone}\n- Always close with: "Strategy locked. Passing to Nova for creative direction and Aria for KPI baseline."`]
).catch(() => undefined);
await pool.query(
  `UPDATE agent_templates SET base_prompt=$1 WHERE agent_key='aria'`,
  [`You are Aria, the Analytics & Performance Specialist for {brand.brand_name}. You turn raw numbers into decisions. When reviewing campaign performance, always structure your output as follows:\n\n## HEALTH CHECK\nScore the campaign out of 100 using this rubric:\n- Email open rate: <15% = 0pts, 15–25% = 10pts, 25–35% = 20pts, >35% = 30pts\n- Click rate: <1% = 0pts, 1–3% = 10pts, 3–5% = 15pts, >5% = 20pts\n- Conversion rate: <1% = 0pts, 1–3% = 10pts, 3–5% = 15pts, >5% = 20pts\n- Audience growth (week-over-week): <0% = 0pts, 0–2% = 5pts, >2% = 10pts\n- Engagement consistency: inconsistent = 0pts, consistent = 10pts\nTotal: 0–39 = Critical, 40–59 = Needs Work, 60–79 = On Track, 80–100 = Exceeding\n\n## BOTTLENECK\nIdentify the single biggest performance limiter this week. State it in one sentence. Cite the specific metric that reveals it.\n\n## CHANNEL RANKING\nRank all active channels from best to worst performing. For each: metric used to rank, score this period vs. last period, trend (↑↓→).\n\n## RECOMMENDATIONS\nExactly 3 actions, ordered by expected impact (highest first):\n1. [Action] — Expected impact: [metric change] — Effort: [low/medium/high] — Timeline: [days]\n2. [Action] — Expected impact: [metric change] — Effort: [low/medium/high] — Timeline: [days]\n3. [Action] — Expected impact: [metric change] — Effort: [low/medium/high] — Timeline: [days]\n\n## FORECAST\nBased on current trajectory, project end-of-campaign values for the top 3 KPIs. Show: current value, projected final value, % gap to target.\n\nBenchmarks to reference:\n- Email open rate: industry avg 20–25%, strong >35%\n- Email click rate: industry avg 2–3%, strong >5%\n- Social engagement rate: avg 1–3%, strong >5%\n- Landing page conversion: avg 2–5%, strong >10%\n- Ad CTR (Meta): avg 0.9–1.5%, strong >2.5%\n\nRules:\n- Always cite the specific data point behind each recommendation.\n- If data is insufficient, state: "Insufficient data — minimum X events needed for statistical significance."\n- Never recommend "post more content" without specifying what type, when, and why.\n- Close every analysis with the overall health score and one sentence summary.`]
).catch(() => undefined);
// Seed campaign_brief agent
await pool.query(
  `INSERT INTO agent_templates (agent_key, name, role, icon, color, base_prompt, memory_keywords)
   VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (agent_key) DO NOTHING`,
  [
    'campaign_brief', 'Brief', 'Campaign Brief Builder', '◫', '#0EA5E9',
    `You are the Campaign Brief Builder for {brand.brand_name}. You produce complete, ready-to-execute campaign briefs that every team member can act on immediately. When the user describes a campaign idea, goal, or event, you output a structured brief document.\n\nCAMPAIGN BRIEF FORMAT:\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nCAMPAIGN: [Campaign Name]\nBrand: {brand.brand_name}\nDate: [Start] → [End]  |  Duration: [X weeks]\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n## 1. CAMPAIGN OVERVIEW\nOne paragraph: what this campaign is, why now, what it achieves for {brand.brand_name}.\n\n## 2. OBJECTIVE\nPrimary objective (one sentence, measurable).\nSuccess definition: what does "win" look like?\n\n## 3. TARGET AUDIENCE\nPrimary persona: [Name it]. Pain point: [...]. Trigger: what makes them act right now?\n\n## 4. CORE MESSAGE\nSingle headline: [...] (≤10 words)\nSupporting proof: [reason to believe]\nCTA: [specific action verb + outcome]\n\n## 5. CHANNEL PLAN\n| Channel | Role | Content Format | Frequency | Owner |\n|---------|------|----------------|-----------|-------|\n| [ch]    | [...] | [...]         | [...]     | [...]  |\n\n## 6. CONTENT CALENDAR\nWeek 1 — Theme: [...]\n- [Day]: [Platform] — [Content type] — [Topic/angle]\n(repeat for each week)\n\n## 7. EMAIL SEQUENCE\nEmail 1 — Subject: [...] — Send: Day [X] — Goal: [...]\nEmail 2 — Subject: [...] — Send: Day [X] — Goal: [...]\n\n## 8. UTM PARAMETERS\nCampaign slug: [brand-campaignname-YYYY-MM]\n| Channel | utm_source | utm_medium | utm_campaign |\n|---------|-----------|------------|--------------|\n\n## 9. KPIs\n| Metric | Baseline | Target | Measurement |\n|--------|----------|--------|-------------|\n\n## 10. DEPENDENCIES & RISKS\nRisk: [...] — Mitigation: [...]\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nRules:\n- Fill every section. If data is missing, write [TBD: what you need].\n- Never leave a section blank.\n- Suggest specific post angles, email subjects, and CTAs — not generic placeholders.\n- All messaging tone must match: {brand.tone}. Audience: {brand.audience}.\n- After the brief, add: "Brief ready. Sage can refine strategy. Nova can develop creative. Aria will track KPIs."`,
    '{campaign,brief,launch,strategy,plan,timeline,kpi,channel}'
  ]
).catch(() => undefined);
// ── End Agent System ──────────────────────────────────────────────────────────

// ── Admin Platform Agents ──────────────────────────────────────────────────────
await pool.query(`
  CREATE TABLE IF NOT EXISTS admin_agents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key             TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    role            TEXT NOT NULL,
    tier            TEXT NOT NULL DEFAULT 'strategic',
    model           TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
    icon            TEXT NOT NULL DEFAULT '◆',
    color           TEXT NOT NULL DEFAULT '#5B6CF9',
    system_prompt   TEXT NOT NULL DEFAULT '',
    autonomy_config JSONB NOT NULL DEFAULT '{}',
    status          TEXT NOT NULL DEFAULT 'idle',
    last_run_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`
  CREATE TABLE IF NOT EXISTS admin_agent_runs (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_key      TEXT NOT NULL,
    trigger        TEXT NOT NULL DEFAULT 'scheduled',
    summary        TEXT NOT NULL DEFAULT '',
    decisions_made INTEGER NOT NULL DEFAULT 0,
    status         TEXT NOT NULL DEFAULT 'completed',
    metadata       JSONB NOT NULL DEFAULT '{}',
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`
  CREATE TABLE IF NOT EXISTS admin_agent_tasks (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_key    TEXT NOT NULL,
    action_type  TEXT NOT NULL,
    payload      JSONB NOT NULL DEFAULT '{}',
    status       TEXT NOT NULL DEFAULT 'pending',
    reasoning    TEXT NOT NULL DEFAULT '',
    severity     TEXT NOT NULL DEFAULT 'low',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    executed_at  TIMESTAMPTZ
  );
`).catch(() => undefined);
await pool.query(`
  CREATE TABLE IF NOT EXISTS admin_notifications (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_key  TEXT NOT NULL,
    title      TEXT NOT NULL,
    body       TEXT NOT NULL DEFAULT '',
    severity   TEXT NOT NULL DEFAULT 'info',
    is_read    BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`).catch(() => undefined);
// Seed default admin platform agents
await pool.query(`
  INSERT INTO admin_agents (key, name, role, tier, model, icon, color, system_prompt, autonomy_config) VALUES
  ('ceo', 'APEX', 'Chief Executive Officer', 'strategic', 'claude-opus-4-7', '◆', '#0f172a',
   'You are APEX, the AI Chief Executive Officer of Dakyworld Hub. You have full authority over platform strategy, revenue optimization, pricing decisions, and executive coordination. Your decisions are data-driven and focused on sustainable growth. You analyze platform metrics, user behavior, and market conditions to make autonomous executive decisions that maximize platform health and revenue.',
   '{"can_change_pricing": true, "pricing_range_pct": 15, "can_manage_users": true, "can_allocate_budget": true, "budget_limit_usd": 500, "requires_approval": false}'),
  ('coo', 'NEXUS', 'Chief Operations Officer', 'strategic', 'claude-sonnet-4-6', '⬡', '#1e3a5f',
   'You are NEXUS, the AI Chief Operations Officer of Dakyworld Hub. You oversee day-to-day platform operations, user experience quality, operational workflows, and inter-department coordination. You ensure seamless platform operation and resolve escalations from the operational tier autonomously.',
   '{"can_manage_users": true, "can_suspend_accounts": true, "can_process_refunds": true, "refund_limit_usd": 30, "requires_approval": false}'),
  ('cco', 'VERA', 'Chief Content Officer', 'operational', 'claude-sonnet-4-6', '◈', '#4c1d95',
   'You are VERA, the AI Chief Content Officer of Dakyworld Hub. You manage all content strategy, template quality standards, AI-generated content guidelines, and the platform content ecosystem. You ensure content quality meets brand standards and drives user engagement metrics.',
   '{"can_manage_templates": true, "can_feature_content": true, "can_moderate_content": true, "requires_approval": false}'),
  ('cto', 'FORGE', 'Chief Technology Officer', 'operational', 'claude-sonnet-4-6', '⟁', '#064e3b',
   'You are FORGE, the AI Chief Technology Officer of Dakyworld Hub. You monitor platform performance, API health, integration stability, and technical infrastructure. You identify bottlenecks, flag issues autonomously, and escalate critical technical decisions to APEX.',
   '{"can_flag_issues": true, "can_disable_integrations": true, "can_escalate_to_ceo": true, "requires_approval": false}'),
  ('cro', 'PULSE', 'Chief Revenue Officer', 'operational', 'claude-sonnet-4-6', '◎', '#7f1d1d',
   'You are PULSE, the AI Chief Revenue Officer of Dakyworld Hub. You optimize revenue streams, analyze conversion funnels, manage subscription retention, and identify growth opportunities. You make data-driven autonomous decisions to maximize ARR and reduce churn.',
   '{"can_offer_discounts": true, "discount_limit_pct": 20, "can_trigger_campaigns": true, "can_change_pricing": true, "pricing_range_pct": 10, "requires_approval": false}')
  ON CONFLICT (key) DO NOTHING;
`).catch(() => undefined);
// ── End Admin Platform Agents ─────────────────────────────────────────────────

// ── Agent Workflow & Tools ────────────────────────────────────────────────────
await pool.query(`
  CREATE TABLE IF NOT EXISTS agent_tools (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key         TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    type        TEXT NOT NULL DEFAULT 'builtin',
    config      JSONB NOT NULL DEFAULT '{}',
    enabled     BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`
  CREATE TABLE IF NOT EXISTS agent_workflows (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_key   TEXT NOT NULL,
    name        TEXT NOT NULL DEFAULT 'Default Workflow',
    description TEXT NOT NULL DEFAULT '',
    steps       JSONB NOT NULL DEFAULT '[]',
    is_active   BOOLEAN NOT NULL DEFAULT true,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(agent_key, name)
  );
`).catch(() => undefined);
// Migrations: add name/description columns and move from per-agent UNIQUE to per-(agent_key, name) UNIQUE
await pool.query(`ALTER TABLE agent_workflows ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT 'Default Workflow'`).catch(() => undefined);
await pool.query(`ALTER TABLE agent_workflows ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT ''`).catch(() => undefined);
// Drop any single-column unique constraint on agent_key (old schema), then add the composite one
await pool.query(`
  DO $$
  DECLARE c TEXT;
  BEGIN
    FOR c IN
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'agent_workflows'::regclass
        AND contype = 'u'
        AND conname != 'agent_workflows_agent_key_name_key'
        AND conname NOT LIKE '%pkey%'
    LOOP
      EXECUTE 'ALTER TABLE agent_workflows DROP CONSTRAINT IF EXISTS ' || quote_ident(c);
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_workflows_agent_key_name_key') THEN
      ALTER TABLE agent_workflows ADD CONSTRAINT agent_workflows_agent_key_name_key UNIQUE (agent_key, name);
    END IF;
  END $$
`).catch(() => undefined);
await pool.query(`
  INSERT INTO agent_tools (key, name, description, type, config) VALUES
  ('meigen_search',           'MeiGen AI Search',                           'Search MeiGen AI for design templates and extract generation prompts',                                      'mcp',     '{"mcp_server":"meigen","tool":"search_designs"}'),
  ('pinterest_search',        'Pinterest Search',                           'Search Pinterest for visual design inspiration by keyword',                                                'api',     '{"endpoint":"pinterest"}'),
  ('claude_synthesize',       'Claude Synthesize',                          'Use Claude AI to craft a tailored prompt from designs and brand memory',                                   'builtin', '{"model":"claude-haiku-4-5-20251001"}'),
  ('draft_content',           'Draft Content',                              'Draft marketing copy, captions, or strategic content using Claude AI',                                     'builtin', '{"model":"claude-haiku-4-5-20251001"}'),
  ('summarize_content',       'Claude Summarize',                           'Summarize and analyze text, data, or reports using Claude AI',                                            'builtin', '{"model":"claude-haiku-4-5-20251001"}'),
  ('magnific_one_generate',   'Magnific One (4K & Contact Sheets)',         'Flagship art-directed image generation with draft 8/16-tile contact sheets, 10 refs, and 4K quality mode', 'builtin', '{"provider":"magnific","endpoint":"/v1/ai/magnific-one","fallback_model":"magnific-one"}'),
  ('generate_image',          'Generate Image (Magnific)',                  'Generate an image using Magnific AI (Magnific One, Mystic, Flux Kontext Pro, Seedream)',                   'builtin', '{"fallback_model":"magnific-one"}'),
  ('magnific_edit_image',     'Magnific Edit / Upscale / Relight / Expand', 'Upscale (Creative/Precision), Relight, Style Transfer, Remove Background, or Outpaint (Image Expand)',     'builtin', '{"provider":"magnific","operations":["upscale","upscale-precision","relight","style-transfer","remove-background","image-expand","seedream-edit"]}'),
  ('freepik_generate_image',  'Generate Image (Magnific / Freepik)',        'Generate a high-quality image via Magnific One / Mystic — uses credits per generation',                    'api',     '{"provider":"magnific","fallback_model":"magnific-one","credits":5}'),
  ('generate_video',          'Generate Video (Magnific Kling / LTX / WAN)','Generate cinematic video via Magnific AI (Kling 2.6 Pro with audio, LTX 2 Pro 4K, WAN 2.6, Hailuo 2.3)',  'builtin', '{"fallback_model":"kling-v2-6-pro"}'),
  ('magnific_lip_sync',       'Magnific Lip Sync (OmniHuman 1.5)',          'Generate a talking avatar video from a portrait image and speech audio or script via OmniHuman 1.5',        'builtin', '{"provider":"magnific","model":"omni-human-1-5"}'),
  ('magnific_generate_audio', 'Magnific Audio (Music / SFX / SAM / TTS)',   'Generate royalty-free music, sound effects, TTS voiceovers, or SAM Audio stem isolation via Magnific',     'builtin', '{"provider":"magnific","audio_types":["music","sfx","isolation","tts"]}'),
  ('magnific_space_flow',     'Magnific Space & Flow Pipeline',             'Create, simulate, and run multi-node Magnific Spaces or reusable Flows via Magnific MCP & Engine',         'mcp',     '{"mcp_server":"magnific","url":"https://mcp.magnific.com"}'),
  ('save_design',             'Save to Designs',                            'Save the generated asset to the user designs collection',                                                 'builtin', '{}')
  ON CONFLICT (key) DO UPDATE SET
    name        = EXCLUDED.name,
    description = EXCLUDED.description,
    type        = EXCLUDED.type,
    config      = EXCLUDED.config;
`).catch(() => undefined);
// ── Seed default named workflows for all 5 agents (UNIQUE agent_key+name = idempotent) ─
{
  const _seeds: { agent_key: string; name: string; description: string; steps: any[] }[] = [
    // ── Nova — Creative Director ───────────────────────────────────────────
    {
      agent_key: 'nova', name: 'Brand Identity Visual',
      description: 'Search design concepts, tailor to brand memory, then generate an art-directed image via Magnific One.',
      steps: [
        { id: 'step_search',   name: 'Search Designs',            tool: 'meigen_search',          description: 'Find design templates matching the request', prompt_template: 'Search for designs matching: {input}. Style niche: {brand.niche}', params: { top_n: 5 } },
        { id: 'step_extract',  name: 'Extract Style Prompts',     tool: 'claude_synthesize',      description: 'Extract visual elements and generation prompts', prompt_template: 'From these design concepts, extract 3–5 key visual styles with image generation prompts.\n\nDesigns: {step_search.result}', params: {} },
        { id: 'step_tailor',   name: 'Tailor to Brand',           tool: 'claude_synthesize',      description: 'Blend design inspiration with brand memory', prompt_template: 'Create one optimized Magnific One image prompt combining design concepts with this brand:\nNiche: {brand.niche}\nTone: {brand.tone}\nAudience: {brand.audience}\n\nDesigns: {step_extract.result}\n\nReturn ONLY JSON (no markdown): { "prompt": "...", "model": "magnific-one", "mode": "quality", "resolution": "2k", "style_notes": "..." }', params: {} },
        { id: 'step_generate', name: 'Generate via Magnific One', tool: 'magnific_one_generate',  description: 'Generate the final brand image using Magnific One', prompt_template: '{step_tailor.prompt}', params: { mode: 'quality', resolution: '2k', auto_if_memory: true } },
        { id: 'step_save',     name: 'Save Design',               tool: 'save_design',            description: 'Save generated image to designs collection', prompt_template: '', params: {} },
      ],
    },
    {
      agent_key: 'nova', name: 'Social Media Post Image',
      description: 'Generate a platform-optimized social media image tailored to brand tone and audience via Magnific One.',
      steps: [
        { id: 'step_brief',    name: 'Draft Visual Brief',        tool: 'claude_synthesize',      description: 'Write a detailed visual brief for the social post', prompt_template: 'Write a detailed Magnific One image generation brief for a {input} social media post.\nBrand niche: {brand.niche}\nBrand tone: {brand.tone}\nAudience: {brand.audience}\n\nInclude: visual style, color scheme, composition, mood.\nReturn ONLY JSON: { "prompt": "...", "model": "magnific-one", "platform": "..." }', params: {} },
        { id: 'step_generate', name: 'Generate via Magnific One', tool: 'magnific_one_generate',  description: 'Generate social media image via Magnific One', prompt_template: '{step_brief.prompt}', params: { mode: 'quality', resolution: '2k' } },
        { id: 'step_save',     name: 'Save Design',               tool: 'save_design',            description: 'Save to designs collection', prompt_template: '', params: {} },
      ],
    },
    {
      agent_key: 'nova', name: 'Product Promo Banner',
      description: 'Create a promotional banner image for a product or service using brand memory and Magnific One.',
      steps: [
        { id: 'step_concept',  name: 'Build Promo Concept',       tool: 'claude_synthesize',      description: 'Generate a promo banner concept', prompt_template: 'Create a promotional banner concept for: {input}\nBrand niche: {brand.niche}\nTone: {brand.tone}\nAudience: {brand.audience}\n\nSpecify: layout, headline text, visual elements, brand colors.\nReturn ONLY JSON: { "prompt": "...", "model": "magnific-one", "headline": "...", "cta": "..." }', params: {} },
        { id: 'step_generate', name: 'Generate via Magnific One', tool: 'magnific_one_generate',  description: 'Generate promo banner via Magnific One', prompt_template: '{step_concept.prompt}', params: { mode: 'quality', resolution: '2k', aspect_ratio: '16:9' } },
        { id: 'step_save',     name: 'Save Design',               tool: 'save_design',            description: 'Save banner to designs collection', prompt_template: '', params: {} },
      ],
    },
    {
      agent_key: 'nova', name: 'AI Brand Video',
      description: 'Generate a cinematic branded video clip with synchronized audio using Magnific Kling 2.6 Pro / LTX 2 Pro.',
      steps: [
        { id: 'step_script',   name: 'Write Video Brief',         tool: 'claude_synthesize',      description: 'Draft a video concept brief', prompt_template: 'Write a cinematic video generation prompt for: {input}\nBrand niche: {brand.niche}\nTone: {brand.tone}\nAudience: {brand.audience}\n\nDescribe: scene, camera motion, lighting, style, colors, mood, and audio atmosphere (max 120 words).\nReturn ONLY JSON: { "prompt": "...", "model": "kling-v2-6-pro", "generate_audio": true }', params: {} },
        { id: 'step_generate', name: 'Generate Video (Magnific)', tool: 'generate_video',         description: 'Generate branded video via Magnific Kling 2.6 Pro', prompt_template: '{step_script.prompt}', params: { model: 'kling-v2-6-pro', generate_audio: true } },
      ],
    },
    {
      agent_key: 'nova', name: 'Content Mood Board (Magnific One 16-Tile Sheet)',
      description: 'Explore 16 visual variations in a single Magnific One draft contact sheet before rendering the hero asset.',
      steps: [
        { id: 'step_concepts', name: 'Draft Contact Sheet Brief', tool: 'claude_synthesize',      description: 'Create a rich art-directed prompt for a 16-tile Magnific One contact sheet', prompt_template: 'Write an art-directed Magnific One contact sheet prompt for: {input}\nBrand: {brand.niche}, tone: {brand.tone}, audience: {brand.audience}\n\nReturn ONLY JSON: { "prompt": "...", "mode": "draft", "tiles": 16, "aspect_ratio": "1:1" }', params: {} },
        { id: 'step_generate', name: 'Generate 16-Tile Sheet',    tool: 'magnific_one_generate',  description: 'Generate a 16-tile contact sheet via Magnific One draft mode', prompt_template: '{step_concepts.prompt}', params: { mode: 'draft', tiles: 16, aspect_ratio: '1:1' } },
        { id: 'step_save',     name: 'Save Contact Sheet',        tool: 'save_design',            description: 'Save mood board contact sheet to designs', prompt_template: '', params: {} },
      ],
    },
    {
      agent_key: 'nova', name: 'Magnific Multimodal Space (Image + Video + Audio)',
      description: 'Execute a multi-node Magnific Space pipeline producing a 4K hero image, animated Kling 2.6 Pro video, and custom soundtrack.',
      steps: [
        { id: 'step_plan',     name: 'Design Multimodal Space',   tool: 'claude_synthesize',      description: 'Plan the Magnific Space nodes (image, video, music)', prompt_template: 'Design a 3-node Magnific Space for: {input}\nBrand: {brand.niche}, tone: {brand.tone}, audience: {brand.audience}\n\nReturn ONLY JSON: { "prompt": "...", "video_prompt": "...", "music_prompt": "..." }', params: {} },
        { id: 'step_space',    name: 'Execute Magnific Space',    tool: 'magnific_space_flow',    description: 'Run the multi-node Magnific Space pipeline', prompt_template: '{step_plan.prompt}', params: { action: 'run_space', nodes: [{ id: 'hero', type: 'magnific-one', params: { mode: 'quality', resolution: '2k' } }, { id: 'motion', type: 'video', dependsOn: 'hero', params: { model: 'kling-v2-6-pro', duration: 5, generate_audio: true } }] } },
        { id: 'step_save',     name: 'Save Hero Asset',           tool: 'save_design',            description: 'Save primary generated asset to designs', prompt_template: '', params: {} },
      ],
    },
    // ── Sage — Strategy Analyst ────────────────────────────────────────────
    {
      agent_key: 'sage', name: 'Competitor Analysis',
      description: 'Analyze competitors in your niche and summarize their strengths, weaknesses, and market gaps.',
      steps: [
        { id: 'step_research', name: 'Research Competitors',  tool: 'claude_synthesize',       description: 'Generate competitor landscape analysis', prompt_template: 'Perform a competitor analysis for a business in: {brand.niche}\nUser request: {input}\nAudience: {brand.audience}\n\nAnalyze: top 3–5 competitors, their positioning, content strategy, strengths/weaknesses, and market gaps. Format as a structured report with actionable insights.', params: {} },
        { id: 'step_summary',  name: 'Strategic Summary',    tool: 'claude_synthesize',        description: 'Distill into strategic recommendations', prompt_template: 'Based on this competitor analysis:\n{step_research.result}\n\nWrite a concise strategic recommendation covering:\n1. Key differentiation opportunities\n2. Content gaps to exploit\n3. Positioning angle for {brand.niche}\n4. Top 3 immediate action items', params: {} },
      ],
    },
    {
      agent_key: 'sage', name: 'Content Strategy Plan',
      description: 'Build a comprehensive 30-day content strategy aligned to brand goals and audience.',
      steps: [
        { id: 'step_audit',    name: 'Audit Brand Positioning', tool: 'claude_synthesize',     description: 'Assess current brand positioning and content gaps', prompt_template: 'Audit the content positioning for a {brand.niche} brand.\nTone: {brand.tone}\nAudience: {brand.audience}\nRequest: {input}\n\nAssess: content gaps, audience pain points, content pillars to establish, platforms to prioritize.', params: {} },
        { id: 'step_plan',     name: 'Build 30-Day Plan',     tool: 'claude_synthesize',       description: 'Create a detailed monthly content plan', prompt_template: 'Using this positioning audit:\n{step_audit.result}\n\nBuild a 30-day content strategy for {brand.niche}:\n- 4 weekly themes\n- Daily post types (educational, promotional, engagement, behind-scenes)\n- Platform mix\n- KPIs to track\n\nFormat as a structured calendar plan.', params: {} },
      ],
    },
    {
      agent_key: 'sage', name: 'Audience Persona Builder',
      description: 'Create detailed target audience personas based on brand niche and market insights.',
      steps: [
        { id: 'step_research', name: 'Research Audience',    tool: 'claude_synthesize',        description: 'Research target audience characteristics', prompt_template: 'Research the ideal target audience for: {brand.niche}\nCurrent audience info: {brand.audience}\nUser request: {input}\n\nIdentify: demographics, psychographics, pain points, goals, preferred platforms, content habits, purchasing triggers.', params: {} },
        { id: 'step_personas', name: 'Build 3 Personas',    tool: 'claude_synthesize',         description: 'Create detailed persona profiles', prompt_template: 'Based on this audience research:\n{step_research.result}\n\nCreate 3 detailed audience personas for {brand.niche}. Each persona: name, age/role, goals, pain points, preferred content types, platforms used, and how this brand helps them.', params: {} },
      ],
    },
    {
      agent_key: 'sage', name: 'Campaign Brief Writer',
      description: 'Write a complete marketing campaign brief from objectives to execution details.',
      steps: [
        { id: 'step_objectives', name: 'Define Objectives',  tool: 'claude_synthesize',        description: 'Clarify campaign goals and success metrics', prompt_template: 'Define campaign objectives for: {input}\nBrand: {brand.niche}\nTone: {brand.tone}\nAudience: {brand.audience}\n\nSpecify: primary goal, secondary goals, target segment, KPIs, timeline, and budget framework.', params: {} },
        { id: 'step_brief',      name: 'Write Full Brief',   tool: 'claude_synthesize',        description: 'Write the comprehensive campaign brief', prompt_template: 'Write a complete marketing campaign brief from these objectives:\n{step_objectives.result}\n\nInclude: campaign concept, messaging framework, content mix, channel strategy, creative direction, timeline milestones, and success criteria.', params: {} },
      ],
    },
    {
      agent_key: 'sage', name: 'Brand Positioning Statement',
      description: 'Craft a clear and compelling brand positioning statement that differentiates in the market.',
      steps: [
        { id: 'step_analysis',  name: 'Positioning Analysis', tool: 'claude_synthesize',       description: 'Analyze brand differentiators and unique value', prompt_template: 'Analyze positioning potential for {brand.niche}.\nTone: {brand.tone}\nAudience: {brand.audience}\nInput: {input}\n\nIdentify: unique value propositions, key differentiators, emotional benefits, functional benefits, and competitive positioning gaps.', params: {} },
        { id: 'step_statement', name: 'Write Positioning',    tool: 'claude_synthesize',       description: 'Draft 3 positioning statement options with taglines', prompt_template: 'Based on this analysis:\n{step_analysis.result}\n\nWrite 3 alternative brand positioning statements for {brand.niche}. Each should be clear, compelling, and differentiated. Include a one-sentence brand tagline for each option.', params: {} },
      ],
    },
    // ── Aria — Analytics & Performance ────────────────────────────────────
    {
      agent_key: 'aria', name: 'Performance Summary',
      description: 'Analyze platform KPIs and surface actionable performance insights for your brand.',
      steps: [
        { id: 'step_kpis',     name: 'Define Key Metrics',   tool: 'claude_synthesize',        description: 'Identify and explain the most important KPIs', prompt_template: 'For a {brand.niche} brand, identify and explain the 5 most critical performance KPIs.\nRequest: {input}\nAudience: {brand.audience}\n\nFor each KPI: what it measures, why it matters, benchmark targets, and how to improve it.', params: {} },
        { id: 'step_insights', name: 'Synthesize Insights',  tool: 'claude_synthesize',        description: 'Distill into actionable performance insights', prompt_template: 'Based on these KPIs:\n{step_kpis.result}\n\nWrite a performance summary for {brand.niche}: overall health score (1–10), top performing areas, underperforming areas, and 3 immediate optimization recommendations.', params: {} },
      ],
    },
    {
      agent_key: 'aria', name: 'Engagement Analysis',
      description: 'Break down content engagement patterns to identify what resonates with your audience.',
      steps: [
        { id: 'step_patterns', name: 'Analyze Patterns',    tool: 'claude_synthesize',         description: 'Identify engagement patterns and trends', prompt_template: 'Analyze content engagement patterns for a {brand.niche} brand targeting {brand.audience}.\nRequest: {input}\n\nBreak down: best performing content types, optimal posting times, engagement rate benchmarks by platform, and content format performance.', params: {} },
        { id: 'step_recs',     name: 'Engagement Playbook', tool: 'claude_synthesize',         description: 'Create engagement optimization recommendations', prompt_template: 'Based on these patterns:\n{step_patterns.result}\n\nCreate an engagement optimization playbook for {brand.niche}:\n1. Top 3 content formats to prioritize\n2. Posting schedule recommendations\n3. Caption and CTA strategies\n4. Community interaction tactics\n5. A/B test ideas to run this month', params: {} },
      ],
    },
    {
      agent_key: 'aria', name: 'Growth Opportunity Report',
      description: 'Identify the highest-impact growth opportunities based on brand data and market analysis.',
      steps: [
        { id: 'step_gaps',    name: 'Find Growth Gaps',      tool: 'claude_synthesize',        description: 'Identify underexplored growth channels and tactics', prompt_template: 'Identify growth opportunities for a {brand.niche} brand.\nAudience: {brand.audience}\nTone: {brand.tone}\nRequest: {input}\n\nAnalyze: untapped content formats, underutilized platforms, audience segments to target, SEO/hashtag gaps, partnership opportunities.', params: {} },
        { id: 'step_report',  name: 'Prioritize & Plan',     tool: 'claude_synthesize',        description: 'Prioritize opportunities by impact and effort', prompt_template: 'Based on these growth opportunities:\n{step_gaps.result}\n\nCreate a prioritized growth plan for {brand.niche}:\n- Quick wins (this week)\n- Medium-term plays (this month)\n- Long-term investments (this quarter)\n\nFor each: opportunity, expected impact, effort required, first action step.', params: {} },
      ],
    },
    {
      agent_key: 'aria', name: 'Monthly Insights Report',
      description: 'Compile a comprehensive monthly performance report with insights and next-month recommendations.',
      steps: [
        { id: 'step_review',  name: 'Monthly Review',        tool: 'claude_synthesize',        description: 'Review the month across all performance metrics', prompt_template: 'Write a monthly performance review for a {brand.niche} brand.\nRequest: {input}\nAudience: {brand.audience}\n\nCover: content volume, engagement trends, audience growth, top performing content, biggest misses, revenue/lead impact.', params: {} },
        { id: 'step_forward', name: 'Next Month Strategy',   tool: 'claude_synthesize',        description: 'Draft next month strategic recommendations', prompt_template: 'Based on this monthly review:\n{step_review.result}\n\nWrite a next-month strategy for {brand.niche}:\n1. Double down: what to do more of\n2. Stop/fix: what to change\n3. Test: new experiments to run\n4. Focus KPIs\n5. Content themes and campaign ideas', params: {} },
      ],
    },
    // ── Flux — Automation & Workflows ─────────────────────────────────────
    {
      agent_key: 'flux', name: 'Content Repurposer',
      description: 'Adapt a single piece of content into multiple formats optimized for different platforms.',
      steps: [
        { id: 'step_analyze',   name: 'Analyze Source Content',    tool: 'claude_synthesize',  description: 'Understand content intent and extract key messages', prompt_template: 'Analyze this content for repurposing: {input}\nBrand: {brand.niche}\nTone: {brand.tone}\nAudience: {brand.audience}\n\nExtract: core message, key quotes, supporting points, target emotion, and content type.', params: {} },
        { id: 'step_repurpose', name: 'Generate Platform Variants', tool: 'draft_content',     description: 'Create platform-specific content variations', prompt_template: 'Based on this content analysis:\n{step_analyze.result}\n\nRepurpose for these platforms:\n1. Instagram caption (150 chars + hashtags)\n2. LinkedIn post (professional, 200 words)\n3. Twitter/X thread (3–5 tweets)\n4. TikTok script (30-second hook + body)\n5. Email newsletter intro (100 words)\n\nMaintain brand tone: {brand.tone}', params: {} },
      ],
    },
    {
      agent_key: 'flux', name: 'Caption & Hashtag Generator',
      description: 'Write engaging captions and build a tiered hashtag strategy for any post topic.',
      steps: [
        { id: 'step_caption',   name: 'Write Caption Options', tool: 'draft_content',          description: 'Generate 3 caption variations', prompt_template: 'Write 3 caption variations for: {input}\nBrand niche: {brand.niche}\nTone: {brand.tone}\nAudience: {brand.audience}\n\nVariation 1: Hook-driven (question or bold statement)\nVariation 2: Storytelling (personal or relatable)\nVariation 3: Value-first (educational or tip-based)\n\nEach 80–150 characters. Include a CTA.', params: {} },
        { id: 'step_hashtags',  name: 'Hashtag Strategy',      tool: 'draft_content',          description: 'Research and categorize hashtags by reach', prompt_template: 'Generate a hashtag strategy for: {input}\nNiche: {brand.niche}\n\nProvide 30 hashtags across 3 tiers:\n- 10 High-reach (1M+ posts) — broad awareness\n- 10 Mid-reach (100K–1M posts) — discoverability\n- 10 Niche (10K–100K posts) — targeted engagement\n\nAlso suggest 5 brand-specific hashtags.', params: {} },
      ],
    },
    {
      agent_key: 'flux', name: 'Weekly Content Plan',
      description: 'Plan a complete 7-day posting schedule with content types, themes, and captions.',
      steps: [
        { id: 'step_themes',   name: 'Define Weekly Themes',    tool: 'draft_content',          description: 'Establish 7-day content themes and pillars', prompt_template: 'Define a content theme framework for the week for {brand.niche}.\nTone: {brand.tone}\nAudience: {brand.audience}\nGoal: {input}\n\nCreate 7 daily themes using content pillars: educational, entertaining, promotional, engagement, behind-the-scenes, user stories, trending.', params: {} },
        { id: 'step_schedule', name: 'Build Posting Schedule',  tool: 'draft_content',          description: 'Create the full 7-day posting schedule', prompt_template: 'Using these weekly themes:\n{step_themes.result}\n\nBuild a complete 7-day posting plan for {brand.niche}:\n- Day 1–7: time to post, platform, content type, caption idea, visual direction\n- Include 2 reels/videos, 3 static posts, 1 carousel, 1 story series\n- Optimize for {brand.audience} behavior patterns', params: {} },
      ],
    },
    {
      agent_key: 'flux', name: 'Post Batch Generator',
      description: 'Generate 10 ready-to-use post ideas with captions and visual direction for bulk scheduling.',
      steps: [
        { id: 'step_ideas',    name: 'Generate Post Ideas',  tool: 'draft_content',             description: 'Brainstorm 10 high-quality post concepts', prompt_template: 'Generate 10 post ideas for {brand.niche}.\nTone: {brand.tone}\nAudience: {brand.audience}\nCampaign/topic: {input}\n\nFor each post: title, format (reel/image/carousel/story), hook, main message, platform recommendation, and content angle.', params: {} },
        { id: 'step_captions', name: 'Write All Captions',   tool: 'draft_content',             description: 'Write full captions for each post', prompt_template: 'Write full captions for all 10 posts:\n{step_ideas.result}\n\nFor each: complete caption (100–200 chars), 3 relevant emojis, CTA, and 5–10 hashtags. Maintain {brand.tone} tone throughout.', params: {} },
      ],
    },
    // ── Daky — Orchestrator & Strategist ──────────────────────────────────
    {
      agent_key: 'daky', name: 'Full Campaign Launch',
      description: 'Orchestrate a complete marketing campaign — strategy, content plan, creative brief, and launch checklist.',
      steps: [
        { id: 'step_strategy', name: 'Campaign Strategy',    tool: 'claude_synthesize',         description: 'Define strategy and objectives', prompt_template: 'Build a full campaign strategy for: {input}\nBrand: {brand.niche}\nTone: {brand.tone}\nAudience: {brand.audience}\n\nDefine: campaign name, objective, key message, target segment, channels, timeline, content mix, and success metrics.', params: {} },
        { id: 'step_content',  name: 'Content Framework',    tool: 'draft_content',             description: 'Create the content execution plan for the campaign', prompt_template: 'Based on this campaign strategy:\n{step_strategy.result}\n\nCreate a content execution framework for {brand.niche}:\n- Launch week content plan (7 posts)\n- Visual direction brief for Nova\n- Copy tone guide for Flux\n- KPIs for Aria to track\n- Automation setup notes for Flux', params: {} },
        { id: 'step_brief',    name: 'Master Campaign Brief', tool: 'claude_synthesize',        description: 'Compile the master brief for all agents', prompt_template: 'Compile a master campaign brief from:\nStrategy: {step_strategy.result}\nContent plan: {step_content.result}\n\nFormat as an actionable brief each team member (creative, content, analytics) can execute independently. Include: campaign overview, role briefs, timeline, dependencies, and launch checklist.', params: {} },
      ],
    },
    {
      agent_key: 'daky', name: 'Brand Onboarding',
      description: 'Guide a new user through setting up their brand identity and preparing all agents for first use.',
      steps: [
        { id: 'step_collect', name: 'Brand Discovery',       tool: 'claude_synthesize',         description: 'Extract and organize core brand information', prompt_template: 'You are onboarding a new brand to Dakyworld Hub.\nInput: {input}\n\nExtract and organize:\n1. Business name and industry\n2. Target audience\n3. Brand tone and personality\n4. Products/services\n5. Competitors\n6. Main marketing goals\n7. Current social media presence\n\nFormat as a structured brand profile.', params: {} },
        { id: 'step_memory',  name: 'Memory Setup Guide',    tool: 'claude_synthesize',         description: 'Create a memory setup guide for the user', prompt_template: 'Based on this brand profile:\n{step_collect.result}\n\nWrite a memory setup guide explaining:\n1. What to save in Brand Memory\n2. Suggested brand keywords (niche, tone, audience, products)\n3. Which agent handles which task (Nova/Sage/Aria/Flux)\n4. Recommended first workflows to run\n5. Quick-start action plan (first 7 days)', params: {} },
      ],
    },
    {
      agent_key: 'daky', name: 'Weekly Marketing Review',
      description: 'Compile a weekly cross-team review covering performance, content output, and next-week priorities.',
      steps: [
        { id: 'step_review',  name: 'Weekly Review',         tool: 'claude_synthesize',         description: 'Analyze the week across all marketing dimensions', prompt_template: 'Write a comprehensive weekly marketing review for {brand.niche}.\nContext: {input}\nAudience: {brand.audience}\n\nCover: content performance highlights, engagement trends, top and bottom posts, audience growth, campaign progress, what worked and what did not.', params: {} },
        { id: 'step_plan',    name: 'Next Week Action Plan', tool: 'claude_synthesize',          description: 'Draft next week priorities for each agent', prompt_template: 'Based on this weekly review:\n{step_review.result}\n\nCreate next week\'s action plan for {brand.niche}:\n- Nova: visual content to create\n- Sage: strategy adjustment needed\n- Flux: automation and scheduling tasks\n- Aria: metrics to focus on\n- Key decisions to make and team tasks', params: {} },
      ],
    },
    // ── Trend Research ────────────────────────────────────────────────────────
    {
      agent_key: 'trend_research', name: 'Niche Trend Scan',
      description: 'Scan for emerging trends in your niche, cluster signals by relevance and decay risk, and surface 3–5 content angles your brand can act on now.',
      steps: [
        { id: 'step_scan',    name: 'Scan Trend Signals',    tool: 'claude_synthesize', description: 'Surface trending topics and signals in the niche', prompt_template: 'You are the Trend Research Agent. Scan for emerging trends relevant to a {brand.niche} brand targeting {brand.audience}.\n\nInput context: {input}\n\nIdentify 5–7 trend candidates. For each: trend name, why it is relevant to this brand, suggested content angle, channel fit (Instagram/TikTok/LinkedIn/YouTube), and decay risk (low/medium/high).', params: {} },
        { id: 'step_rank',    name: 'Rank & Filter',         tool: 'claude_synthesize', description: 'Rank trends by opportunity score and brand fit', prompt_template: 'From these trend candidates:\n{step_scan.result}\n\nRank them by opportunity score (relevance × volume × brand fit ÷ decay risk). Select the top 3. For each, write: opportunity summary (2 sentences), recommended content format, and the single most important angle to lead with. Audience: {brand.audience}. Tone: {brand.tone}.', params: {} },
        { id: 'step_brief',   name: 'Create Content Angles', tool: 'draft_content',     description: 'Turn top trends into actionable content angle proposals', prompt_template: 'Turn these top trend opportunities into 3 ready-to-brief content angles for {brand.brand_name}:\n{step_rank.result}\n\nFor each angle: working title, format (reel/post/carousel/thread), platform, hook idea, and key message. Tone: {brand.tone}.', params: {} },
      ],
    },
    {
      agent_key: 'trend_research', name: 'Viral Content Autopsy',
      description: 'Analyze what is going viral in your space, reverse-engineer the formula, and extract repeatable patterns for your brand.',
      steps: [
        { id: 'step_autopsy', name: 'Viral Pattern Analysis', tool: 'claude_synthesize', description: 'Reverse-engineer viral content patterns', prompt_template: 'Analyze viral content patterns in the {brand.niche} space.\nAudience: {brand.audience}\nContext/example: {input}\n\nIdentify: the hook formula used, emotional driver (curiosity/fear/status/relief), format type, posting time pattern, engagement mechanic (debate/save/share trigger), and what made it spread.', params: {} },
        { id: 'step_adapt',   name: 'Brand-Fit Adaptation',   tool: 'draft_content',     description: 'Adapt viral formula to brand voice', prompt_template: 'Using these viral patterns:\n{step_autopsy.result}\n\nCreate 2 content ideas adapted to {brand.brand_name} (niche: {brand.niche}, tone: {brand.tone}, audience: {brand.audience}) that use the same formula but fit the brand authentically. Include: format, hook, key message, CTA.', params: {} },
      ],
    },
    // ── Audience Research ─────────────────────────────────────────────────────
    {
      agent_key: 'audience_research', name: 'Audience Persona Builder',
      description: 'Build 2–3 detailed audience personas from real pain points, vocabulary, buying triggers, and objections — ready to hand to every other agent.',
      steps: [
        { id: 'step_pains',   name: 'Extract Pain Points',   tool: 'claude_synthesize', description: 'Surface top pains, desires, and vocabulary', prompt_template: 'You are the Audience Research Agent for {brand.brand_name} ({brand.niche}).\nTarget audience: {brand.audience}\nAdditional context: {input}\n\nExtract the top 5 pain points (with plausible verbatim quotes), top 5 desired outcomes, 3 main objections to buying, and the exact vocabulary this audience uses (jargon, phrases, metaphors they favour). Cite the type of source each insight likely comes from (reviews/forums/support).', params: {} },
        { id: 'step_persona', name: 'Build Personas',        tool: 'claude_synthesize', description: 'Create 2 detailed buyer personas', prompt_template: 'Using this audience intelligence:\n{step_pains.result}\n\nBuild 2 distinct buyer personas for {brand.brand_name}. For each: name, role/demographic, daily friction, success metric, where they spend time online, what would make them switch to this brand, what would make them churn, and their decision-making style.', params: {} },
        { id: 'step_hooks',   name: 'Messaging Hooks',       tool: 'draft_content',     description: 'Generate messaging hooks from persona insights', prompt_template: 'From these personas:\n{step_persona.result}\n\nCreate 5 messaging hooks for {brand.brand_name} that speak directly to this audience\'s vocabulary and pain. Each hook should be ≤12 words. Tone: {brand.tone}.', params: {} },
      ],
    },
    // ── SEO Research ──────────────────────────────────────────────────────────
    {
      agent_key: 'seo_research', name: 'Keyword Cluster Report',
      description: 'Generate keyword clusters by search intent and funnel stage, with content format recommendations and quick-win opportunities.',
      steps: [
        { id: 'step_seeds',   name: 'Generate Seed Keywords', tool: 'claude_synthesize', description: 'Generate seed and long-tail keywords', prompt_template: 'You are the SEO Keyword Research Agent for {brand.brand_name} ({brand.niche}).\nAudience: {brand.audience}\nSeed topic: {input}\n\nGenerate 20–30 keyword ideas across: head terms (high volume, high competition), mid-tail (specific, moderate), and long-tail (low competition, high intent). Group by search intent: informational | commercial | transactional.', params: {} },
        { id: 'step_cluster', name: 'Cluster & Prioritise',   tool: 'claude_synthesize', description: 'Cluster keywords and prioritize by opportunity', prompt_template: 'From these keywords:\n{step_seeds.result}\n\nCluster them into 5–8 topic clusters. For each cluster: cluster name, primary keyword, estimated intent (TOFU/MOFU/BOFU), competition level (low/medium/high), recommended content format (blog/landing page/comparison/tool), and why this cluster matters for {brand.niche}. Flag the top 3 quick-win clusters (low competition + commercial intent).', params: {} },
        { id: 'step_briefs',  name: 'Content Briefs',         tool: 'draft_content',     description: 'Create content briefs for top clusters', prompt_template: 'For the top 3 quick-win keyword clusters:\n{step_cluster.result}\n\nWrite a content brief for each: target keyword, title, audience ({brand.audience}), 5 key sections to cover, 3 competitor angles to beat, and the CTA. Tone: {brand.tone}.', params: {} },
      ],
    },
    // ── Hook Writing ──────────────────────────────────────────────────────────
    {
      agent_key: 'hook_writing', name: 'Hook Generator',
      description: 'Generate 10 scroll-stopping hooks for a topic across 5 distinct patterns — ready for captions, scripts, and ad copy.',
      steps: [
        { id: 'step_hooks',   name: 'Generate Hook Variants', tool: 'claude_synthesize', description: 'Generate 10 hook variations', prompt_template: 'You are the Hook Writing Agent for {brand.brand_name} ({brand.niche}).\nAudience: {brand.audience}\nTone: {brand.tone}\nTopic/angle: {input}\n\nGenerate 10 hook variations (each ≤12 words for video, ≤80 chars for text) across these patterns:\n1. Pattern interrupt\n2. Contrarian\n3. Stat-led\n4. Direct question\n5. Before/after\n6. ICP callout\n7. Story cold open\n8. Problem amplification\n9. FOMO/urgency\n10. Bold claim\n\nFor each: the hook text, pattern type, emotional driver (curiosity/status/fear/relief), and best channel fit.', params: {} },
        { id: 'step_top3',    name: 'Select & Justify Top 3', tool: 'draft_content',     description: 'Select the 3 strongest hooks with reasoning', prompt_template: 'From these hooks:\n{step_hooks.result}\n\nSelect the 3 strongest for {brand.brand_name} targeting {brand.audience}. For each: the hook, why it works for this audience, which platform it fits best, and a suggested follow-up sentence to build on it.', params: {} },
      ],
    },
    // ── Social Caption ────────────────────────────────────────────────────────
    {
      agent_key: 'social_caption', name: 'Multi-Platform Captions',
      description: 'Write A/B caption variants for your top 3 platforms — platform-native tone, right hashtags, one clear CTA each.',
      steps: [
        { id: 'step_draft',   name: 'Draft Captions',         tool: 'claude_synthesize', description: 'Write platform-native captions', prompt_template: 'You are the Social Caption Agent for {brand.brand_name}.\nTone: {brand.tone}\nAudience: {brand.audience}\nPlatforms: {brand.platforms}\nContent topic/hook: {input}\n\nWrite 2 caption variants (A and B) for each of the top 3 platforms in the list. Platform rules:\n- LinkedIn: 800–1500 chars, professional-human, 3–5 hashtags, no hashtag spam\n- Instagram: 150–400 chars, emojis if tone permits, 5–8 hashtags\n- TikTok: ≤150 chars, conversational, 2–4 hashtags\n- Twitter/X: ≤280 chars, punchy, no hashtags unless campaign-tagged\n\nEach caption must end with one clear CTA.', params: {} },
        { id: 'step_refine',  name: 'Refine & Schedule Hint', tool: 'draft_content',     description: 'Add scheduling hints and finalize', prompt_template: 'Review these captions for {brand.brand_name}:\n{step_draft.result}\n\nFor each platform pair: select the stronger variant with justification, add a posting-time recommendation (best window for each platform), and note any hashtags to refine. Produce final ready-to-post captions.', params: {} },
      ],
    },
    // ── Video Script ──────────────────────────────────────────────────────────
    {
      agent_key: 'video_script', name: 'Short-Form Script (≤60s)',
      description: 'Write a timed short-form video script with hook, on-screen text, b-roll notes, voiceover, and CTA placement.',
      steps: [
        { id: 'step_outline', name: 'Script Outline',          tool: 'claude_synthesize', description: 'Create structure and timing outline', prompt_template: 'You are the Video Script Agent for {brand.brand_name} ({brand.niche}).\nAudience: {brand.audience}\nTone: {brand.tone}\nTopic/brief: {input}\n\nCreate a short-form video outline (≤60 seconds):\n- 0:00–0:03: Hook (from Hook Writing Agent if available)\n- 0:03–0:15: Problem amplification\n- 0:15–0:45: Reveal / proof / key message\n- 0:45–0:60: CTA\n\nFor each segment: timing, voiceover script, on-screen text, b-roll/visual direction.', params: {} },
        { id: 'step_script',  name: 'Full Script',              tool: 'draft_content',     description: 'Write the complete timestamped script', prompt_template: 'Expand this outline into a complete short-form video script for {brand.brand_name}:\n{step_outline.result}\n\nDeliver: final VO lines (natural speech rhythm, {brand.tone} tone), on-screen text overlays (≤5 words each), b-roll descriptions, and a thumbnail concept (1 sentence visual direction).', params: {} },
      ],
    },
    {
      agent_key: 'video_script', name: 'Long-Form Script (5–10 min)',
      description: 'Write a structured long-form video script with retention beats every 90 seconds, timestamps, and a dual CTA.',
      steps: [
        { id: 'step_frame',   name: 'Framework & Segments',    tool: 'claude_synthesize', description: 'Define segments, retention beats, and CTA placements', prompt_template: 'You are the Video Script Agent for {brand.brand_name} ({brand.niche}).\nAudience: {brand.audience}\nTone: {brand.tone}\nTopic: {input}\n\nDesign a long-form video framework (5–10 min):\n- Cold open (0:00–0:30): hook + promise\n- 3–5 main segments with re-engagement beats every 60–90s\n- Recap (last 60s)\n- CTA: mid-point + end\n\nFor each segment: title, key message, duration, retention hook.', params: {} },
        { id: 'step_full',    name: 'Full Script Draft',        tool: 'draft_content',     description: 'Write complete long-form script', prompt_template: 'Write the complete long-form script for {brand.brand_name} based on this framework:\n{step_frame.result}\n\nInclude: VO lines, on-screen text, b-roll notes, timestamps, chapter titles for YouTube chapters, and thumbnail concept.', params: {} },
      ],
    },
    // ── Ad Copy ───────────────────────────────────────────────────────────────
    {
      agent_key: 'ad_copy', name: 'Meta Ad Copy Pack',
      description: 'Generate 8 Meta ad copy variations across 4 angles — pain-led, outcome-led, social proof, and FOMO — with A/B hypothesis for each.',
      steps: [
        { id: 'step_angles',  name: 'Define Angles & Strategy', tool: 'claude_synthesize', description: 'Plan ad angles and messaging strategy', prompt_template: 'You are the Ad Copy Agent for {brand.brand_name} ({brand.niche}).\nAudience: {brand.audience}\nOffer/campaign: {input}\nConversion goal: sign-up or purchase\n\nDefine 4 distinct ad angles:\n1. Pain-led (amplify the problem)\n2. Outcome-led (paint the result)\n3. Social proof (credibility-first)\n4. FOMO/urgency (scarcity or time)\n\nFor each angle: headline direction (≤40 chars), primary text direction (≤125 chars), hypothesis to test.', params: {} },
        { id: 'step_copy',    name: 'Write All Variations',     tool: 'claude_synthesize', description: 'Write complete ad copy for all angles', prompt_template: 'Write 2 complete Meta ad copy variants per angle for {brand.brand_name}:\n{step_angles.result}\n\nFor each variant:\n- Primary text (125 chars ideal)\n- Headline (40 chars max)\n- Description (30 chars)\n- CTA button label\n- Hypothesis being tested\n\nTone: {brand.tone}. Audience: {brand.audience}. Never fabricate testimonials.', params: {} },
        { id: 'step_google',  name: 'Google Search Ads',        tool: 'draft_content',     description: 'Write Google Search ad headlines and descriptions', prompt_template: 'Using the ad strategy:\n{step_angles.result}\n\nWrite Google Search ad assets for {brand.brand_name}:\n- 10 headlines (30 chars each, varied by angle)\n- 4 descriptions (90 chars each)\n- 3 sitelink text options\n\nFocus on search intent keywords for {brand.niche}.', params: {} },
      ],
    },
    // ── Thumbnail Design ──────────────────────────────────────────────────────
    {
      agent_key: 'thumbnail_design', name: 'YouTube Thumbnail Pack',
      description: 'Design 3 CTR-optimized YouTube thumbnail concepts with layout, focal element, palette, overlay text, and A/B test hypothesis.',
      steps: [
        { id: 'step_concepts', name: 'Generate 3 Concepts',    tool: 'claude_synthesize', description: 'Create 3 distinct thumbnail visual concepts', prompt_template: 'You are the Thumbnail Design Agent for {brand.brand_name} ({brand.niche}).\nVideo title/hook: {input}\nBrand tone: {brand.tone}\n\nCreate 3 distinct thumbnail concepts. For each:\n- Layout (describe where focal element and text sit)\n- Focal element (face emotion / product / graphic)\n- Dominant emotion to convey\n- Color palette (2–3 hex codes, high contrast)\n- Overlay text (≤4 words, must be readable at 200px wide)\n- What NOT to include\n- CTR hypothesis (why this will outperform average)', params: {} },
        { id: 'step_ab',       name: 'A/B Test Brief',          tool: 'draft_content',     description: 'Define the A/B test pair and rationale', prompt_template: 'From these 3 thumbnail concepts for {brand.brand_name}:\n{step_concepts.result}\n\nSelect the 2 strongest as the A/B test pair. Write the test brief:\n- Concept A (full spec)\n- Concept B (full spec)\n- What variable is being tested\n- Success metric (CTR target)\n- Recommended design tools (Canva/Figma) and how to execute each concept.', params: {} },
      ],
    },
    {
      agent_key: 'thumbnail_design', name: 'Social Ad Creative Brief',
      description: 'Write a visual creative brief for Meta/LinkedIn/TikTok ad creatives — single image and carousel formats.',
      steps: [
        { id: 'step_brief',    name: 'Creative Brief',          tool: 'claude_synthesize', description: 'Write full creative brief for ad visuals', prompt_template: 'You are the Thumbnail Design Agent for {brand.brand_name} ({brand.niche}).\nCampaign/offer: {input}\nAudience: {brand.audience}\nTone: {brand.tone}\n\nWrite a visual creative brief for social ad creatives covering:\n1. Single image ad: layout, focal element, copy placement, palette, emotion\n2. Carousel (3 frames): frame 1 hook visual, frame 2 proof/feature, frame 3 CTA\n3. Video cover frame: 1-sentence visual direction\n\nFor each: what to avoid, design notes, and the brand rule that must be maintained.', params: {} },
        { id: 'step_deliver',  name: 'Production Checklist',    tool: 'draft_content',     description: 'Produce a delivery-ready creative checklist', prompt_template: 'From this creative brief for {brand.brand_name}:\n{step_brief.result}\n\nCreate a production-ready checklist:\n- Asset dimensions for each format (Meta: 1080×1080, 1200×628, etc.)\n- File format requirements\n- Text safe zones\n- Brand elements required (logo placement, color, font)\n- QA checklist (text legibility, contrast ratio, CTA visibility)', params: {} },
      ],
    },
    // ── Meta Ads ──────────────────────────────────────────────────────────────
    {
      agent_key: 'meta_ads', name: 'Campaign Structure Plan',
      description: 'Design a complete Meta campaign structure — objective, ad sets, audiences, budget allocation, and decision rules for scaling.',
      steps: [
        { id: 'step_structure', name: 'Campaign Architecture',  tool: 'claude_synthesize', description: 'Design the full campaign structure', prompt_template: 'You are the Meta Ads Manager for {brand.brand_name} ({brand.niche}).\nAudience: {brand.audience}\nCampaign goal: {input}\n\nDesign a Meta campaign structure:\n1. Campaign objective (awareness/traffic/leads/sales)\n2. 3 ad set audience types: cold (broad/LAL), warm (retargeting), hot (CRM/custom)\n3. Budget allocation % across cold/warm/hot\n4. Placement recommendation (Reels/Feed/Stories)\n5. Conversion event to optimise for\n6. Exclusion audiences', params: {} },
        { id: 'step_rules',     name: 'Decision Rules & KPIs',  tool: 'claude_synthesize', description: 'Define performance thresholds and scaling rules', prompt_template: 'For this campaign structure:\n{step_structure.result}\n\nDefine operational rules for {brand.brand_name}:\n- Target CPA: set based on average LTV assumption\n- Target ROAS: set based on margin assumption\n- Pause rule: CPA > 1.5× target after 2× spend, OR CTR < 0.8% after 24h\n- Scale rule: ROAS ≥ target 2 consecutive days → increase budget ≤20%/day\n- Creative fatigue rule: frequency > 3 + CTR drop >30% → request new creative\n- Frequency cap recommendation', params: {} },
        { id: 'step_launch',    name: 'Launch Checklist',       tool: 'draft_content',     description: 'Create a pre-launch QA checklist', prompt_template: 'Create a complete Meta ads launch checklist for {brand.brand_name}:\n{step_rules.result}\n\nCover: pixel verification, conversion event test, audience sizes, creative specs, UTM parameters, brand safety exclusions, budget approval, and post-launch monitoring schedule (24h, 72h, 7d checkpoints).', params: {} },
      ],
    },
    {
      agent_key: 'meta_ads', name: 'Daily Performance Report',
      description: 'Generate a structured daily performance report with spend summary, KPI status, decisions made, and next recommended actions.',
      steps: [
        { id: 'step_report',    name: 'Performance Summary',    tool: 'claude_synthesize', description: 'Write a structured daily performance report', prompt_template: 'You are the Meta Ads Manager for {brand.brand_name} ({brand.niche}).\nPerformance data or context: {input}\n\nWrite a structured daily Meta ads report:\n- Spend summary\n- CPA vs target (green/amber/red)\n- ROAS vs target\n- Top performing ad set and creative\n- Decisions made today (paused/scaled/iterated)\n- Requests to other agents (new creative needed?)\n- Tomorrow\'s focus', params: {} },
        { id: 'step_actions',   name: 'Action Items',           tool: 'draft_content',     description: 'List specific actions for each team member', prompt_template: 'From this performance report for {brand.brand_name}:\n{step_report.result}\n\nList specific action items:\n- Ad Copy Agent: any new variations needed\n- Thumbnail Design Agent: any creative refreshes\n- Analytics Agent: what to monitor\n- Campaign Manager: any budget decisions needed\n\nPrioritize by urgency (do today / do this week / monitor).', params: {} },
      ],
    },
  ];
  for (const wf of _seeds) {
    await pool.query(
      `INSERT INTO agent_workflows (agent_key, name, description, steps) VALUES ($1, $2, $3, $4) ON CONFLICT (agent_key, name) DO NOTHING`,
      [wf.agent_key, wf.name, wf.description, JSON.stringify(wf.steps)]
    ).catch(() => undefined);
  }
}
// ── End Agent Workflow & Tools ────────────────────────────────────────────────

// ── User Agent Foundation (Phase 4) ──────────────────────────────────────────
await pool.query(`
  CREATE TABLE IF NOT EXISTS brand_profiles (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    brand_name  TEXT NOT NULL DEFAULT '',
    niche       TEXT NOT NULL DEFAULT '',
    tone        TEXT NOT NULL DEFAULT 'professional',
    audience    TEXT NOT NULL DEFAULT '',
    goals       TEXT[] NOT NULL DEFAULT '{}',
    platforms   TEXT[] NOT NULL DEFAULT '{}',
    website     TEXT NOT NULL DEFAULT '',
    extra_notes TEXT NOT NULL DEFAULT '',
    setup_done  BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`
  CREATE TABLE IF NOT EXISTS user_agent_memory (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_key  TEXT NOT NULL DEFAULT 'global',
    mem_type   TEXT NOT NULL DEFAULT 'general',
    key        TEXT NOT NULL,
    value      TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, agent_key, key)
  );
`).catch(() => undefined);
await pool.query(`
  CREATE TABLE IF NOT EXISTS user_agent_tasks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_key   TEXT NOT NULL,
    task_type   TEXT NOT NULL DEFAULT 'proposal',
    title       TEXT NOT NULL,
    body        TEXT NOT NULL DEFAULT '',
    payload     JSONB NOT NULL DEFAULT '{}',
    status      TEXT NOT NULL DEFAULT 'pending',
    expires_at  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '48 hours',
    decided_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`).catch(() => undefined);
// Phase 9 — agent_drafts: executed proposals (blog drafts + other content artifacts)
await pool.query(`
  CREATE TABLE IF NOT EXISTS agent_drafts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_key    TEXT NOT NULL,
    task_id      UUID REFERENCES user_agent_tasks(id) ON DELETE SET NULL,
    task_type    TEXT NOT NULL DEFAULT 'content_post',
    title        TEXT NOT NULL,
    content      TEXT NOT NULL DEFAULT '',
    payload      JSONB NOT NULL DEFAULT '{}',
    blog_post_id TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS agent_drafts_user_idx ON agent_drafts (user_id, created_at DESC);`).catch(() => undefined);

// Phase 10 — scheduled auto-runs per user per agent
await pool.query(`
  CREATE TABLE IF NOT EXISTS user_agent_schedules (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_key            TEXT NOT NULL,
    frequency            TEXT NOT NULL DEFAULT 'off',
    run_hour             INT  NOT NULL DEFAULT 9,
    run_day              INT  NOT NULL DEFAULT 1,
    enabled              BOOLEAN NOT NULL DEFAULT false,
    last_scheduled_run_at TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, agent_key)
  );
`).catch(() => undefined);
// ── End User Agent Foundation ─────────────────────────────────────────────────

// ── End User Memory ───────────────────────────────────────────────────────────

// ─── Workspace & Organizations ────────────────────────────────────────────────
await pool.query(`
  CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    logo_url TEXT,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS organizations_slug_unique_idx ON organizations (LOWER(slug));`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS organizations_owner_idx ON organizations (owner_id);`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS organization_memberships (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'viewer',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, user_id)
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS org_memberships_user_idx ON organization_memberships (user_id);`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS org_memberships_org_idx ON organization_memberships (org_id);`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS organization_invitations (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'editor',
    token TEXT NOT NULL,
    invited_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    accepted_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS org_invitations_token_idx ON organization_invitations (token);`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS org_invitations_org_idx ON organization_invitations (org_id);`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '#5b6cf9',
    created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS projects_org_idx ON projects (org_id);`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS organization_audit_logs (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS org_audit_logs_org_idx ON organization_audit_logs (org_id, created_at DESC);`).catch(() => undefined);

// ── Task Management ───────────────────────────────────────────────────────────
await pool.query(`
  CREATE TABLE IF NOT EXISTS tasks (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'todo',
    priority      TEXT NOT NULL DEFAULT 'medium',
    position      INT  NOT NULL DEFAULT 0,
    due_date      DATE,
    supervisor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_by    TEXT NOT NULL REFERENCES users(id),
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS tasks_project_status_idx ON tasks (project_id, status, position);`).catch(() => undefined);
// Migrate due_date from DATE to TIMESTAMPTZ to support time-of-day
await pool.query(`ALTER TABLE tasks ALTER COLUMN due_date TYPE TIMESTAMPTZ USING due_date::TIMESTAMPTZ;`).catch(() => undefined);
// Task type, reminder, and CRM company linkage
await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_type TEXT NOT NULL DEFAULT 'todo';`).catch(() => undefined);
await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reminder_at TIMESTAMPTZ;`).catch(() => undefined);
await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS crm_company_id UUID REFERENCES crm_companies(id) ON DELETE SET NULL;`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS task_assignees (
    task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (task_id, user_id)
  );
`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS task_labels (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    color      TEXT NOT NULL DEFAULT '#6366f1',
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS task_label_assignments (
    task_id  UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    label_id UUID NOT NULL REFERENCES task_labels(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, label_id)
  );
`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS subtasks (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id    UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    completed  BOOLEAN NOT NULL DEFAULT FALSE,
    position   INT NOT NULL DEFAULT 0,
    created_by TEXT REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS subtasks_task_idx ON subtasks (task_id, position);`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS task_attachments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    url         TEXT NOT NULL,
    size        INT,
    mime_type   TEXT,
    uploaded_by TEXT REFERENCES users(id),
    created_at  TIMESTAMPTZ DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS task_attachments_task_idx ON task_attachments (task_id);`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS task_comments (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id    UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content    TEXT NOT NULL,
    parent_id  UUID REFERENCES task_comments(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS task_comments_task_idx ON task_comments (task_id, created_at);`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS task_comment_reactions (
    comment_id UUID NOT NULL REFERENCES task_comments(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji      TEXT NOT NULL,
    PRIMARY KEY (comment_id, user_id, emoji)
  );
`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS task_activity (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id    UUID REFERENCES tasks(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id    TEXT REFERENCES users(id),
    action     TEXT NOT NULL,
    metadata   JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS task_activity_project_idx ON task_activity (project_id, created_at DESC);`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS task_activity_task_idx ON task_activity (task_id, created_at DESC);`).catch(() => undefined);
await pool.query(`
  CREATE TABLE IF NOT EXISTS task_actions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id       UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    action_type   TEXT NOT NULL,
    label         TEXT NOT NULL,
    target_count  INT NOT NULL DEFAULT 1,
    current_count INT NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS task_actions_task_idx ON task_actions (task_id);`).catch(() => undefined);
// ── End Task Management ───────────────────────────────────────────────────────

// ── End Workspace Tables ──────────────────────────────────────────────────────

// ── Workflows ─────────────────────────────────────────────────────────────────
await pool.query(`
  CREATE TABLE IF NOT EXISTS workflows (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    org_id      TEXT REFERENCES organizations(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT,
    status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','inactive')),
    nodes       JSONB NOT NULL DEFAULT '[]',
    edges       JSONB NOT NULL DEFAULT '[]',
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS workflows_user_idx ON workflows (user_id, created_at DESC);`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS workflow_runs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id  UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status       TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed','cancelled')),
    trigger_data JSONB DEFAULT '{}',
    logs         JSONB DEFAULT '[]',
    started_at   TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS workflow_runs_workflow_idx ON workflow_runs (workflow_id, started_at DESC);`).catch(() => undefined);
// ── End Workflows ─────────────────────────────────────────────────────────────

// ── CRM ───────────────────────────────────────────────────────────────────────
await pool.query(`
  CREATE TABLE IF NOT EXISTS crm_companies (
    id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    domain      TEXT,
    industry    TEXT,
    size        TEXT,
    website     TEXT,
    phone       TEXT,
    email       TEXT,
    address     TEXT,
    city        TEXT,
    country     TEXT,
    description TEXT,
    logo_url    TEXT,
    custom_data JSONB DEFAULT '{}',
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS crm_companies_user_idx ON crm_companies (user_id, created_at DESC);`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS crm_companies_domain_idx ON crm_companies (user_id, domain);`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS crm_contact_companies (
    contact_id  TEXT NOT NULL REFERENCES mailing_contacts(id) ON DELETE CASCADE,
    company_id  TEXT NOT NULL REFERENCES crm_companies(id) ON DELETE CASCADE,
    role        TEXT,
    is_primary  BOOLEAN DEFAULT false,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (contact_id, company_id)
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS crm_contact_companies_company_idx ON crm_contact_companies (company_id);`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS crm_pipeline_stages (
    id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    color      TEXT NOT NULL DEFAULT '#6366f1',
    position   INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS crm_pipeline_stages_user_idx ON crm_pipeline_stages (user_id, position);`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS crm_deals (
    id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    value        NUMERIC DEFAULT 0,
    currency     TEXT DEFAULT 'USD',
    stage_id     TEXT REFERENCES crm_pipeline_stages(id) ON DELETE SET NULL,
    contact_id   TEXT REFERENCES mailing_contacts(id) ON DELETE SET NULL,
    company_id   TEXT REFERENCES crm_companies(id) ON DELETE SET NULL,
    close_date   DATE,
    priority     TEXT DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
    status       TEXT DEFAULT 'open' CHECK (status IN ('open','won','lost')),
    probability  INT DEFAULT 0 CHECK (probability >= 0 AND probability <= 100),
    description  TEXT,
    custom_data  JSONB DEFAULT '{}',
    position     INT DEFAULT 0,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS crm_deals_user_idx ON crm_deals (user_id, created_at DESC);`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS crm_deals_stage_idx ON crm_deals (stage_id, position);`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS crm_deals_contact_idx ON crm_deals (contact_id);`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS crm_deals_company_idx ON crm_deals (company_id);`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS crm_activities (
    id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    contact_id  TEXT REFERENCES mailing_contacts(id) ON DELETE CASCADE,
    company_id  TEXT REFERENCES crm_companies(id) ON DELETE CASCADE,
    deal_id     TEXT REFERENCES crm_deals(id) ON DELETE CASCADE,
    type        TEXT NOT NULL CHECK (type IN ('note','call','email','meeting','task','whatsapp','sms')),
    title       TEXT,
    body        TEXT,
    outcome     TEXT,
    duration    INT,
    scheduled_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS crm_activities_contact_idx ON crm_activities (contact_id, created_at DESC);`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS crm_activities_deal_idx ON crm_activities (deal_id, created_at DESC);`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS crm_activities_user_idx ON crm_activities (user_id, created_at DESC);`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS crm_lead_scoring_rules (
    id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    condition  JSONB NOT NULL,
    points     INT NOT NULL DEFAULT 0,
    active     BOOLEAN DEFAULT true,
    position   INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS crm_lead_scoring_rules_user_idx ON crm_lead_scoring_rules (user_id, position);`).catch(() => undefined);
// ── End CRM ───────────────────────────────────────────────────────────────────

// ── Connector Abstraction Layer ───────────────────────────────────────────────

// 1. Capability domains — the 6 provider categories
await pool.query(`
  CREATE TABLE IF NOT EXISTS connector_domains (
    id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    slug        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    description TEXT,
    icon        TEXT,
    color       TEXT NOT NULL DEFAULT '#6366f1',
    position    INT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS connector_domains_slug_idx ON connector_domains (slug);`).catch(() => undefined);

// 2. Provider catalog — available providers per domain
await pool.query(`
  CREATE TABLE IF NOT EXISTS connector_provider_catalog (
    id                        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    domain_slug               TEXT NOT NULL REFERENCES connector_domains(slug) ON DELETE CASCADE,
    slug                      TEXT NOT NULL,
    name                      TEXT NOT NULL,
    description               TEXT,
    logo_url                  TEXT,
    requires_integration_slug TEXT,
    capabilities              JSONB NOT NULL DEFAULT '[]',
    config_schema             JSONB NOT NULL DEFAULT '{}',
    is_native                 BOOLEAN NOT NULL DEFAULT false,
    available                 BOOLEAN NOT NULL DEFAULT true,
    position                  INT NOT NULL DEFAULT 0,
    created_at                TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(domain_slug, slug)
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS connector_provider_catalog_domain_idx ON connector_provider_catalog (domain_slug, position);`).catch(() => undefined);

// 3. User provider preferences — per-user, per-domain active provider
await pool.query(`
  CREATE TABLE IF NOT EXISTS connector_user_prefs (
    id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    domain_slug  TEXT NOT NULL REFERENCES connector_domains(slug) ON DELETE CASCADE,
    provider_slug TEXT NOT NULL DEFAULT 'native',
    config       JSONB NOT NULL DEFAULT '{}',
    enabled      BOOLEAN NOT NULL DEFAULT true,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, domain_slug)
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS connector_user_prefs_user_idx ON connector_user_prefs (user_id, domain_slug);`).catch(() => undefined);

// 4. Sync jobs — scheduled sync configuration per user+provider
await pool.query(`
  CREATE TABLE IF NOT EXISTS connector_sync_jobs (
    id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    domain_slug    TEXT NOT NULL REFERENCES connector_domains(slug) ON DELETE CASCADE,
    provider_slug  TEXT NOT NULL,
    name           TEXT NOT NULL,
    sync_type      TEXT NOT NULL,
    direction      TEXT NOT NULL DEFAULT 'inbound' CHECK (direction IN ('inbound','outbound','bidirectional')),
    frequency      TEXT NOT NULL DEFAULT 'manual' CHECK (frequency IN ('manual','hourly','6h','daily','weekly')),
    filter_config  JSONB NOT NULL DEFAULT '{}',
    active         BOOLEAN NOT NULL DEFAULT true,
    last_run_at    TIMESTAMPTZ,
    next_run_at    TIMESTAMPTZ,
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    updated_at     TIMESTAMPTZ DEFAULT NOW()
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS connector_sync_jobs_user_idx ON connector_sync_jobs (user_id, domain_slug);`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS connector_sync_jobs_next_run_idx ON connector_sync_jobs (next_run_at) WHERE active=true;`).catch(() => undefined);

// 5. Sync runs — individual execution records
await pool.query(`
  CREATE TABLE IF NOT EXISTS connector_sync_runs (
    id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    job_id           TEXT REFERENCES connector_sync_jobs(id) ON DELETE CASCADE,
    user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    domain_slug      TEXT NOT NULL,
    provider_slug    TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed','cancelled')),
    records_pulled   INT NOT NULL DEFAULT 0,
    records_created  INT NOT NULL DEFAULT 0,
    records_updated  INT NOT NULL DEFAULT 0,
    records_skipped  INT NOT NULL DEFAULT 0,
    records_failed   INT NOT NULL DEFAULT 0,
    error_message    TEXT,
    details          JSONB NOT NULL DEFAULT '{}',
    started_at       TIMESTAMPTZ DEFAULT NOW(),
    completed_at     TIMESTAMPTZ
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS connector_sync_runs_job_idx ON connector_sync_runs (job_id, started_at DESC);`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS connector_sync_runs_user_idx ON connector_sync_runs (user_id, started_at DESC);`).catch(() => undefined);

// 6. Field maps — external ↔ native field mapping per user+provider
await pool.query(`
  CREATE TABLE IF NOT EXISTS connector_field_maps (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    domain_slug     TEXT NOT NULL REFERENCES connector_domains(slug) ON DELETE CASCADE,
    provider_slug   TEXT NOT NULL,
    external_field  TEXT NOT NULL,
    native_field    TEXT NOT NULL,
    transform       TEXT,
    direction       TEXT NOT NULL DEFAULT 'inbound' CHECK (direction IN ('inbound','outbound','both')),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, domain_slug, provider_slug, external_field, direction)
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS connector_field_maps_user_idx ON connector_field_maps (user_id, domain_slug, provider_slug);`).catch(() => undefined);

// ── Seed connector domains ────────────────────────────────────────────────────
const DOMAINS = [
  { slug: 'email',     name: 'Email',             description: 'Send campaigns, transactional emails, and automations',        icon: 'Mail',         color: '#6366f1', position: 0 },
  { slug: 'crm',       name: 'CRM',               description: 'Contacts, deals, pipelines, and relationship tracking',        icon: 'Users',        color: '#8b5cf6', position: 1 },
  { slug: 'social',    name: 'Social Scheduling',  description: 'Schedule and publish content across social platforms',         icon: 'Share2',       color: '#ec4899', position: 2 },
  { slug: 'messaging', name: 'Team Messaging',     description: 'Notifications, alerts, and team communication channels',      icon: 'MessageSquare', color: '#f59e0b', position: 3 },
  { slug: 'analytics', name: 'Analytics & Data',   description: 'Website traffic, campaign ROI, and audience insights',        icon: 'BarChart2',    color: '#10b981', position: 4 },
  { slug: 'calendar',  name: 'Calendar',           description: 'Events, reminders, and scheduling across calendar providers', icon: 'Calendar',     color: '#ef4444', position: 5 },
  { slug: 'video',     name: 'Video Conferencing', description: 'Create and manage video meetings and webinars',                icon: 'Video',        color: '#0ea5e9', position: 6 },
];
for (const d of DOMAINS) {
  await pool.query(
    `INSERT INTO connector_domains (slug,name,description,icon,color,position)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (slug) DO UPDATE SET name=$2,description=$3,icon=$4,color=$5,position=$6`,
    [d.slug, d.name, d.description, d.icon, d.color, d.position]
  ).catch(() => undefined);
}

// ── Seed provider catalog ─────────────────────────────────────────────────────
const PROVIDERS: { domain: string; slug: string; name: string; description: string; requiresSlug: string | null; caps: string[]; isNative: boolean; pos: number }[] = [
  // EMAIL
  { domain: 'email', slug: 'native',    name: 'Native Email',  description: 'Built-in email engine — works out of the box',             requiresSlug: null,         caps: ['send_email','send_campaign','track_opens','track_clicks','manage_contacts'], isNative: true,  pos: 0 },
  { domain: 'email', slug: 'mailchimp', name: 'Mailchimp',     description: 'Route campaigns through your Mailchimp account',           requiresSlug: 'mailchimp',  caps: ['send_campaign','track_opens','track_clicks','manage_contacts','manage_lists'], isNative: false, pos: 1 },
  { domain: 'email', slug: 'hubspot',   name: 'HubSpot Email', description: 'Send email via HubSpot marketing tools',                   requiresSlug: 'hubspot',    caps: ['send_email','send_campaign','track_opens','track_clicks'], isNative: false, pos: 2 },
  { domain: 'email', slug: 'gmail',     name: 'Gmail',         description: 'Send from your own Gmail or Google Workspace address',     requiresSlug: 'gmail',     caps: ['send_email'], isNative: false, pos: 3 },
  // CRM
  { domain: 'crm',   slug: 'native',     name: 'Native CRM',    description: 'Built-in CRM — contacts, deals, pipeline, activities',     requiresSlug: null,         caps: ['create_contact','update_contact','create_deal','update_deal','log_activity','get_pipeline'], isNative: true,  pos: 0 },
  { domain: 'crm',   slug: 'hubspot',    name: 'HubSpot CRM',   description: 'Read and write contacts and deals from HubSpot',           requiresSlug: 'hubspot',    caps: ['create_contact','update_contact','create_deal','update_deal','log_activity','get_pipeline','sync_contacts','sync_deals'], isNative: false, pos: 1 },
  { domain: 'crm',   slug: 'salesforce', name: 'Salesforce',    description: 'Sync leads and opportunities with Salesforce',             requiresSlug: 'salesforce', caps: ['create_contact','update_contact','create_deal','update_deal','sync_contacts','sync_deals'], isNative: false, pos: 2 },
  // SOCIAL
  { domain: 'social', slug: 'native', name: 'Native Scheduler', description: 'Built-in scheduler across 7 social platforms',             requiresSlug: null,     caps: ['schedule_post','publish_now','get_analytics','manage_accounts'], isNative: true,  pos: 0 },
  { domain: 'social', slug: 'buffer', name: 'Buffer',           description: 'Push scheduled content into your Buffer queue',            requiresSlug: 'buffer', caps: ['schedule_post','get_analytics'], isNative: false, pos: 1 },
  // MESSAGING
  { domain: 'messaging', slug: 'native',   name: 'In-App Notifications', description: 'Built-in notification centre and alerts',         requiresSlug: null,        caps: ['send_alert','send_notification'], isNative: true,  pos: 0 },
  { domain: 'messaging', slug: 'slack',    name: 'Slack',                description: 'Send agent alerts and workflow updates to Slack',  requiresSlug: 'slack',     caps: ['send_message','send_alert','create_channel'], isNative: false, pos: 1 },
  { domain: 'messaging', slug: 'whatsapp', name: 'WhatsApp Business',    description: 'Reach contacts via WhatsApp Business API',        requiresSlug: 'whatsapp',  caps: ['send_message'], isNative: false, pos: 2 },
  { domain: 'messaging', slug: 'sms',      name: 'SMS (Hubtel)',          description: 'Send SMS notifications via Hubtel gateway',       requiresSlug: 'hubtel',    caps: ['send_message'], isNative: false, pos: 3 },
  // ANALYTICS
  { domain: 'analytics', slug: 'native',           name: 'Native Analytics',   description: 'Built-in social and campaign analytics',                 requiresSlug: null,              caps: ['get_social_analytics','get_campaign_analytics','get_post_analytics'], isNative: true,  pos: 0 },
  { domain: 'analytics', slug: 'google_analytics',  name: 'Google Analytics 4', description: 'Pull website traffic and conversion data from GA4',     requiresSlug: 'google',          caps: ['get_website_traffic','get_conversion_data','get_audience_insights'], isNative: false, pos: 1 },
  { domain: 'analytics', slug: 'hubspot_analytics', name: 'HubSpot Analytics',  description: 'Campaign ROI and contact attribution from HubSpot',    requiresSlug: 'hubspot',         caps: ['get_campaign_analytics','get_contact_attribution'], isNative: false, pos: 2 },
  // CALENDAR
  { domain: 'calendar', slug: 'native',          name: 'Native Calendar',    description: 'Built-in task scheduling and reminders',                  requiresSlug: null,     caps: ['create_event','get_events','update_event'], isNative: true,  pos: 0 },
  { domain: 'calendar', slug: 'google_calendar', name: 'Google Calendar',    description: 'Create events and find availability in Google Calendar',  requiresSlug: 'google', caps: ['create_event','get_events','find_free_slot','update_event'], isNative: false, pos: 1 },
  { domain: 'calendar', slug: 'outlook',         name: 'Outlook / Microsoft 365', description: 'Sync with Outlook calendar for enterprise teams',   requiresSlug: 'outlook', caps: ['create_event','get_events','update_event'], isNative: false, pos: 2 },
  // VIDEO
  { domain: 'video',    slug: 'native',          name: 'Native Video',       description: 'Basic meeting links and scheduling',                      requiresSlug: null,     caps: ['create_meeting','get_meetings'], isNative: true,  pos: 0 },
  { domain: 'video',    slug: 'zoom',            name: 'Zoom',               description: 'Create Zoom meetings and manage your video sessions',     requiresSlug: 'zoom',   caps: ['create_meeting','get_meetings','update_meeting','delete_meeting'], isNative: false, pos: 1 },
];
for (const p of PROVIDERS) {
  await pool.query(
    `INSERT INTO connector_provider_catalog (domain_slug,slug,name,description,requires_integration_slug,capabilities,is_native,position)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (domain_slug,slug) DO UPDATE SET name=$3,description=$4,requires_integration_slug=$5,capabilities=$6,is_native=$7,position=$8`,
    [p.domain, p.slug, p.name, p.description, p.requiresSlug, JSON.stringify(p.caps), p.isNative, p.pos]
  ).catch(() => undefined);
}
// ── End Connector Abstraction Layer ───────────────────────────────────────────

// ── Gmail Inbox ───────────────────────────────────────────────────────────────
// One-time fix: drop old broken versions only if user_id column is INTEGER (type mismatch)
await pool.query(`
  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name='gmail_messages' AND column_name='user_id' AND data_type='integer'
    ) THEN
      DROP TABLE IF EXISTS gmail_messages CASCADE;
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name='gmail_sync_state' AND column_name='user_id' AND data_type='integer'
    ) THEN
      DROP TABLE IF EXISTS gmail_sync_state CASCADE;
    END IF;
  END $$;
`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS gmail_messages (
    id                BIGSERIAL PRIMARY KEY,
    user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    gmail_message_id  TEXT NOT NULL,
    gmail_thread_id   TEXT NOT NULL DEFAULT '',
    subject           TEXT NOT NULL DEFAULT '',
    snippet           TEXT NOT NULL DEFAULT '',
    from_email        TEXT NOT NULL DEFAULT '',
    from_name         TEXT NOT NULL DEFAULT '',
    to_email          TEXT NOT NULL DEFAULT '',
    date              TIMESTAMPTZ,
    is_read           BOOLEAN NOT NULL DEFAULT false,
    is_sent           BOOLEAN NOT NULL DEFAULT false,
    body_text         TEXT,
    synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, gmail_message_id)
  )
`);

await pool.query(`CREATE INDEX IF NOT EXISTS idx_gmail_messages_user_from ON gmail_messages(user_id, from_email)`);
await pool.query(`CREATE INDEX IF NOT EXISTS idx_gmail_messages_user_date ON gmail_messages(user_id, date DESC NULLS LAST)`);

await pool.query(`
  CREATE TABLE IF NOT EXISTS gmail_sync_state (
    user_id         TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'idle',
    total_fetched   INTEGER NOT NULL DEFAULT 0,
    last_synced_at  TIMESTAMPTZ,
    error_message   TEXT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`);
// ── End Gmail Inbox ───────────────────────────────────────────────────────────

// ── CRM: track gmail source on activities ─────────────────────────────────────
await pool.query(`ALTER TABLE crm_activities ADD COLUMN IF NOT EXISTS gmail_message_id TEXT`).catch(() => undefined);
await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS crm_activities_gmail_msg_idx ON crm_activities(gmail_message_id) WHERE gmail_message_id IS NOT NULL`).catch(() => undefined);

// ── CRM: pipelines (multi-pipeline support) ───────────────────────────────────
await pool.query(`
  CREATE TABLE IF NOT EXISTS crm_pipelines (
    id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS crm_pipelines_user_idx ON crm_pipelines (user_id)`).catch(() => undefined);
await pool.query(`ALTER TABLE crm_pipeline_stages ADD COLUMN IF NOT EXISTS pipeline_id TEXT REFERENCES crm_pipelines(id) ON DELETE CASCADE`).catch(() => undefined);
await pool.query(`ALTER TABLE crm_deals ADD COLUMN IF NOT EXISTS close_reason TEXT`).catch(() => undefined);
// Migrate existing stages: one default pipeline per user
await pool.query(`
  INSERT INTO crm_pipelines (id, user_id, name)
  SELECT gen_random_uuid()::text, user_id, 'Sales Pipeline'
  FROM (SELECT DISTINCT user_id FROM crm_pipeline_stages WHERE pipeline_id IS NULL) u
`).catch(() => undefined);
await pool.query(`
  UPDATE crm_pipeline_stages s
  SET pipeline_id = (SELECT id FROM crm_pipelines p WHERE p.user_id = s.user_id ORDER BY created_at LIMIT 1)
  WHERE s.pipeline_id IS NULL
`).catch(() => undefined);

// ── CRM: note comments ────────────────────────────────────────────────────────
await pool.query(`
  CREATE TABLE IF NOT EXISTS crm_note_comments (
    id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    note_id     TEXT NOT NULL REFERENCES crm_activities(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body        TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
  )
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS crm_note_comments_note_idx ON crm_note_comments (note_id, created_at ASC)`).catch(() => undefined);

// ── Platform settings (key-value store for admin-controlled config) ────────────
await pool.query(`
  CREATE TABLE IF NOT EXISTS platform_settings (
    key         TEXT PRIMARY KEY,
    value       JSONB NOT NULL DEFAULT '{}',
    updated_at  TIMESTAMPTZ DEFAULT NOW()
  )
`).catch(() => undefined);

// ── Hubtel messaging: SMS delivery log + OTP verification requests ─────────────
await pool.query(`
  CREATE TABLE IF NOT EXISTS sms_logs (
    id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id             TEXT REFERENCES users(id) ON DELETE SET NULL,
    recipient           TEXT NOT NULL,
    sender_id           TEXT,
    content             TEXT NOT NULL,
    context             TEXT NOT NULL DEFAULT 'manual',
    status              TEXT NOT NULL DEFAULT 'sent',
    provider            TEXT NOT NULL DEFAULT 'hubtel',
    provider_message_id TEXT,
    provider_response   JSONB,
    created_at          TIMESTAMPTZ DEFAULT NOW()
  )
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS sms_logs_created_idx ON sms_logs (created_at DESC)`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS otp_requests (
    id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
    phone       TEXT NOT NULL,
    request_id  TEXT NOT NULL,
    prefix      TEXT,
    status      TEXT NOT NULL DEFAULT 'sent',
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    verified_at TIMESTAMPTZ
  )
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS otp_requests_user_idx ON otp_requests (user_id, created_at DESC)`).catch(() => undefined);
await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT FALSE`).catch(() => undefined);

// ── CRM: meeting-specific columns on activities ────────────────────────────────
await pool.query(`ALTER TABLE crm_activities ADD COLUMN IF NOT EXISTS end_time TIMESTAMPTZ`).catch(() => undefined);
await pool.query(`ALTER TABLE crm_activities ADD COLUMN IF NOT EXISTS recurrence TEXT`).catch(() => undefined);
await pool.query(`ALTER TABLE crm_activities ADD COLUMN IF NOT EXISTS attendees JSONB`).catch(() => undefined);
await pool.query(`ALTER TABLE crm_activities ADD COLUMN IF NOT EXISTS reminder_minutes INTEGER[]`).catch(() => undefined);
await pool.query(`ALTER TABLE crm_activities ADD COLUMN IF NOT EXISTS google_event_id TEXT`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS crm_activities_company_idx ON crm_activities (company_id, created_at DESC)`).catch(() => undefined);

await pool.query(`
  CREATE TABLE IF NOT EXISTS campaign_members (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    contact_id TEXT NOT NULL REFERENCES mailing_contacts(id) ON DELETE CASCADE,
    label TEXT,
    source TEXT DEFAULT 'automation',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (campaign_id, contact_id)
  );
`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS campaign_members_user_idx ON campaign_members (user_id, campaign_id);`).catch(() => undefined);
await pool.query(`CREATE INDEX IF NOT EXISTS campaign_members_contact_idx ON campaign_members (contact_id);`).catch(() => undefined);

await createLeadgenTables(pool);
await createSalesTables(pool);
  await runIncrementalUpgradeMigrations(pool);

}

// ── AI Sales OS ───────────────────────────────────────────────────────────────
//
// A multi-agent sales layer built ON the existing CRM rather than beside it:
// mailing_contacts stays the one person record, sales_lead_profiles hangs
// sales-only state off it, and every conversation also writes a crm_activities
// row so the Companies/Pipeline pages light up without a sync job.
//
// Two conventions here are load-bearing:
//
//  - Analytical dimensions (objection, intent, sentiment, stage, outcome) are
//    CHECK-constrained codes PLUS a raw-text field. Free text cannot be grouped,
//    and "too expensive" / "budget is tight" / "price is high" must land in one
//    bar on the dashboard. The same enums are pinned into the Analyst agent's
//    JSON schema so the model cannot invent a twelfth objection code.
//
//  - sales_call_attempts doubles as the durable dial queue (status='queued' +
//    run_at), claimed with FOR UPDATE SKIP LOCKED exactly like
//    mailing_automation_jobs. One table means no queue/history drift.
//
// Keep the CHECK lists in sync with packages/api/src/server/sales/types.ts.
async function createSalesTables(pool: Pool): Promise<void> {
  // Sales leads are routinely phone-only (scraped lists, referrals, Sheets
  // imports), but mailing_contacts was built email-first: NOT NULL + a table
  // level UNIQUE(user_id, email). Relax to partial unique indexes — Postgres
  // treats NULL as distinct, so email dedupe is preserved for the rows that
  // have one while phone-only rows become insertable. Every read that assumed
  // a non-null email must tolerate NULL (see mailing/campaign send paths).
  await pool.query(`ALTER TABLE mailing_contacts ALTER COLUMN email DROP NOT NULL`).catch(() => undefined);
  await pool.query(`ALTER TABLE mailing_contacts DROP CONSTRAINT IF EXISTS mailing_contacts_user_id_email_key`).catch(() => undefined);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS mailing_contacts_user_email_uidx
    ON mailing_contacts (user_id, email) WHERE email IS NOT NULL`).catch(() => undefined);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS mailing_contacts_user_phone_uidx
    ON mailing_contacts (user_id, phone) WHERE phone IS NOT NULL AND email IS NULL`).catch(() => undefined);

  // Sales-only state, 1:1 with the CRM contact. Nothing here duplicates a
  // mailing_contacts or crm_deals column.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales_lead_profiles (
      id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      contact_id            TEXT NOT NULL UNIQUE REFERENCES mailing_contacts(id) ON DELETE CASCADE,
      stage                 TEXT NOT NULL DEFAULT 'new' CHECK (stage IN ('new','contacted','qualified','interested','proposal','negotiation','won','lost','unreachable')),
      do_not_call           BOOLEAN NOT NULL DEFAULT false,
      do_not_call_reason    TEXT,
      do_not_call_at        TIMESTAMPTZ,
      consent_source        TEXT,
      consent_at            TIMESTAMPTZ,
      timezone              TEXT,
      is_decision_maker     BOOLEAN,
      role_title            TEXT,
      owner_user_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
      human_handling        BOOLEAN NOT NULL DEFAULT false,
      last_contacted_at     TIMESTAMPTZ,
      next_action           TEXT,
      next_action_at        TIMESTAMPTZ,
      attempt_count         INT NOT NULL DEFAULT 0,
      consecutive_no_answer INT NOT NULL DEFAULT 0,
      summary               TEXT,
      custom_data           JSONB DEFAULT '{}',
      created_at            TIMESTAMPTZ DEFAULT NOW(),
      updated_at            TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch((err) => logger.error({ err }, 'migration_failed: sales_lead_profiles'));
  await pool.query(`CREATE INDEX IF NOT EXISTS sales_lead_profiles_user_stage_idx ON sales_lead_profiles (user_id, stage)`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS sales_lead_profiles_next_action_idx ON sales_lead_profiles (user_id, next_action_at)`).catch(() => undefined);

  // One row per user. The compliance gate reads nothing else. Defaults are
  // deliberately conservative: a fresh account cannot autodial anyone until a
  // human flips enabled and consent is on the record.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales_call_policies (
      id                             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id                        TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      enabled                        BOOLEAN NOT NULL DEFAULT false,
      require_consent                BOOLEAN NOT NULL DEFAULT true,
      allowed_days                   SMALLINT[] NOT NULL DEFAULT '{1,2,3,4,5}',
      window_start                   TEXT NOT NULL DEFAULT '09:00',
      window_end                     TEXT NOT NULL DEFAULT '17:00',
      default_timezone               TEXT NOT NULL DEFAULT 'Africa/Accra',
      max_attempts_per_lead_per_week INT NOT NULL DEFAULT 2,
      max_consecutive_no_answer      INT NOT NULL DEFAULT 4,
      min_hours_between_attempts     INT NOT NULL DEFAULT 24,
      daily_call_cap                 INT NOT NULL DEFAULT 50,
      ai_disclosure_required         BOOLEAN NOT NULL DEFAULT true,
      ai_disclosure_text             TEXT,
      recording_disclosure_required  BOOLEAN NOT NULL DEFAULT true,
      blackout_dates                 TEXT[] NOT NULL DEFAULT '{}',
      require_approval_for           JSONB NOT NULL DEFAULT '["set_do_not_call","link_deal"]',
      provider                       TEXT NOT NULL DEFAULT 'simulator',
      from_number                    TEXT,
      voice_id                       TEXT,
      max_call_duration_sec          INT NOT NULL DEFAULT 420,
      created_at                     TIMESTAMPTZ DEFAULT NOW(),
      updated_at                     TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch((err) => logger.error({ err }, 'migration_failed: sales_call_policies'));

  // Every dial, answered or not — and simultaneously the durable dial queue.
  // local_weekday/local_hour are denormalized at dial time in the LEAD's
  // timezone: deriving them later would re-read a timezone that may have
  // changed, and it turns the stats rollup into a plain GROUP BY.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales_call_attempts (
      id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      contact_id       TEXT REFERENCES mailing_contacts(id) ON DELETE CASCADE,
      lead_profile_id  TEXT REFERENCES sales_lead_profiles(id) ON DELETE CASCADE,
      followup_id      TEXT,
      provider         TEXT NOT NULL DEFAULT 'manual',
      external_id      TEXT,
      from_number      TEXT,
      to_number        TEXT,
      objective        TEXT,
      brief            TEXT,
      status           TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','dialing','in_progress','completed','cancelled','blocked','failed')),
      outcome          TEXT CHECK (outcome IS NULL OR outcome IN ('answered','no_answer','busy','voicemail','rejected','invalid_number','failed','blocked')),
      run_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      started_at       TIMESTAMPTZ,
      ended_at         TIMESTAMPTZ,
      duration_sec     INT,
      local_weekday    SMALLINT,
      local_hour       SMALLINT,
      block_reason     TEXT,
      attempts         INT NOT NULL DEFAULT 0,
      last_error       TEXT,
      recording_url    TEXT,
      provider_payload JSONB DEFAULT '{}',
      conversation_id  TEXT,
      created_at       TIMESTAMPTZ DEFAULT NOW(),
      updated_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch((err) => logger.error({ err }, 'migration_failed: sales_call_attempts'));
  await pool.query(`CREATE INDEX IF NOT EXISTS sales_call_attempts_due_idx ON sales_call_attempts (status, run_at)`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS sales_call_attempts_user_idx ON sales_call_attempts (user_id, created_at DESC)`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS sales_call_attempts_contact_idx ON sales_call_attempts (contact_id, created_at DESC)`).catch(() => undefined);
  // Makes webhook delivery idempotent — Vapi retries end-of-call reports.
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS sales_call_attempts_external_uidx
    ON sales_call_attempts (provider, external_id) WHERE external_id IS NOT NULL`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS sales_call_attempts_bucket_idx
    ON sales_call_attempts (user_id, local_weekday, local_hour) WHERE outcome IS NOT NULL`).catch(() => undefined);

  // The Conversation Record — the source of truth every other agent reads.
  // analysis_status exists because analysis is an async LLM call that can fail,
  // and a failed analysis must be visibly retryable rather than a silently
  // lost call.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales_conversations (
      id                 TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      contact_id         TEXT REFERENCES mailing_contacts(id) ON DELETE CASCADE,
      lead_profile_id    TEXT REFERENCES sales_lead_profiles(id) ON DELETE CASCADE,
      attempt_id         TEXT,
      channel            TEXT NOT NULL DEFAULT 'phone' CHECK (channel IN ('phone','sms','email','whatsapp','meeting')),
      direction          TEXT NOT NULL DEFAULT 'outbound' CHECK (direction IN ('outbound','inbound')),
      started_at         TIMESTAMPTZ DEFAULT NOW(),
      ended_at           TIMESTAMPTZ,
      duration_sec       INT,
      recording_url      TEXT,
      transcript         TEXT,
      summary            TEXT,
      sentiment          TEXT CHECK (sentiment IS NULL OR sentiment IN ('positive','neutral','negative')),
      intent             TEXT CHECK (intent IS NULL OR intent IN ('interested','needs_info','callback_requested','meeting_booked','undecided','not_interested','wrong_number','do_not_call')),
      lead_stage_before  TEXT,
      lead_stage_after   TEXT,
      commitments        JSONB NOT NULL DEFAULT '[]',
      promises           JSONB NOT NULL DEFAULT '[]',
      questions          JSONB NOT NULL DEFAULT '[]',
      buying_signals     JSONB NOT NULL DEFAULT '[]',
      recommended_action TEXT,
      analyst_confidence NUMERIC,
      analysis_status    TEXT NOT NULL DEFAULT 'pending' CHECK (analysis_status IN ('pending','analyzing','done','failed','skipped')),
      analysis_error     TEXT,
      analysis_attempts  INT NOT NULL DEFAULT 0,
      crm_activity_id    TEXT REFERENCES crm_activities(id) ON DELETE SET NULL,
      created_by         TEXT NOT NULL DEFAULT 'human' CHECK (created_by IN ('human','agent','import')),
      created_at         TIMESTAMPTZ DEFAULT NOW(),
      updated_at         TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch((err) => logger.error({ err }, 'migration_failed: sales_conversations'));
  await pool.query(`CREATE INDEX IF NOT EXISTS sales_conversations_user_idx ON sales_conversations (user_id, started_at DESC)`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS sales_conversations_contact_idx ON sales_conversations (contact_id, started_at DESC)`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS sales_conversations_analysis_idx ON sales_conversations (analysis_status, created_at)`).catch(() => undefined);

  // A child table rather than a JSONB array on the conversation, precisely so
  // GROUP BY objection_code powers the dashboard.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales_conversation_objections (
      id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversation_id     TEXT NOT NULL REFERENCES sales_conversations(id) ON DELETE CASCADE,
      contact_id          TEXT REFERENCES mailing_contacts(id) ON DELETE CASCADE,
      objection_code      TEXT NOT NULL CHECK (objection_code IN ('price','budget','timing','no_authority','existing_provider','no_need','trust','missing_feature','contract_lock_in','bad_experience','other')),
      raw_text            TEXT,
      resolved            BOOLEAN NOT NULL DEFAULT false,
      resolved_by_response TEXT,
      created_at          TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch((err) => logger.error({ err }, 'migration_failed: sales_conversation_objections'));
  await pool.query(`CREATE INDEX IF NOT EXISTS sales_objections_user_code_idx ON sales_conversation_objections (user_id, objection_code, created_at DESC)`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS sales_objections_contact_idx ON sales_conversation_objections (contact_id) WHERE resolved = false`).catch(() => undefined);

  // A first-class obligation, never a note. exact_time_requested means the lead
  // named a time — the scheduler must never override that with a statistically
  // better window.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales_followups (
      id                        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id                   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      contact_id                TEXT REFERENCES mailing_contacts(id) ON DELETE CASCADE,
      lead_profile_id           TEXT REFERENCES sales_lead_profiles(id) ON DELETE CASCADE,
      type                      TEXT NOT NULL DEFAULT 'phone_call' CHECK (type IN ('phone_call','email','sms','task')),
      requested_by              TEXT NOT NULL DEFAULT 'agent' CHECK (requested_by IN ('lead','agent','human','automation')),
      scheduled_for             TIMESTAMPTZ NOT NULL,
      exact_time_requested      BOOLEAN NOT NULL DEFAULT false,
      reason                    TEXT,
      objective                 TEXT,
      status                    TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','due','in_progress','completed','cancelled','missed')),
      source_conversation_id    TEXT REFERENCES sales_conversations(id) ON DELETE SET NULL,
      completed_conversation_id TEXT,
      attempts                  INT NOT NULL DEFAULT 0,
      last_error                TEXT,
      created_at                TIMESTAMPTZ DEFAULT NOW(),
      updated_at                TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch((err) => logger.error({ err }, 'migration_failed: sales_followups'));
  await pool.query(`CREATE INDEX IF NOT EXISTS sales_followups_due_idx ON sales_followups (status, scheduled_for)`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS sales_followups_user_idx ON sales_followups (user_id, scheduled_for)`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS sales_followups_contact_idx ON sales_followups (contact_id, status)`).catch(() => undefined);

  // Sales knowledge (memory type C): what actually works. Business knowledge
  // (services, pricing, case studies) is NOT duplicated here — it already lives
  // in user_memories from the onboarding wizard and is read through
  // buildSharedAgentContext().
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales_playbooks (
      id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind            TEXT NOT NULL DEFAULT 'objection_response' CHECK (kind IN ('objection_response','pitch','question','faq','disqualifier')),
      objection_code  TEXT,
      title           TEXT,
      content         TEXT NOT NULL,
      source          TEXT NOT NULL DEFAULT 'human' CHECK (source IN ('human','ai_proposed','ai_accepted')),
      active          BOOLEAN NOT NULL DEFAULT true,
      times_used      INT NOT NULL DEFAULT 0,
      times_succeeded INT NOT NULL DEFAULT 0,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch((err) => logger.error({ err }, 'migration_failed: sales_playbooks'));
  await pool.query(`CREATE INDEX IF NOT EXISTS sales_playbooks_user_idx ON sales_playbooks (user_id, kind, active)`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS sales_playbooks_objection_idx ON sales_playbooks (user_id, objection_code) WHERE active = true`).catch(() => undefined);

  // Insight Agent proposals. Nothing here is ever applied automatically —
  // status starts 'new' and a human accepts or rejects.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales_insights (
      id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind            TEXT NOT NULL CHECK (kind IN ('objection_pattern','timing','script','segment','risk')),
      title           TEXT NOT NULL,
      body            TEXT,
      evidence        JSONB NOT NULL DEFAULT '{}',
      confidence      NUMERIC,
      sample_size     INT NOT NULL DEFAULT 0,
      proposed_change JSONB,
      status          TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','accepted','rejected','applied')),
      reviewed_by     TEXT,
      reviewed_at     TIMESTAMPTZ,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch((err) => logger.error({ err }, 'migration_failed: sales_insights'));
  await pool.query(`CREATE INDEX IF NOT EXISTS sales_insights_user_idx ON sales_insights (user_id, status, created_at DESC)`).catch(() => undefined);

  // Audit trail. Without this, "AI interprets, the app executes" is an
  // unverifiable claim — every proposal, every applied op, and every rejected
  // op with its reason is recorded here.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales_agent_runs (
      id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      agent         TEXT NOT NULL,
      subject_type  TEXT,
      subject_id    TEXT,
      model         TEXT,
      input_tokens  INT NOT NULL DEFAULT 0,
      output_tokens INT NOT NULL DEFAULT 0,
      proposed      JSONB,
      applied       JSONB,
      rejected      JSONB,
      error         TEXT,
      duration_ms   INT,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch((err) => logger.error({ err }, 'migration_failed: sales_agent_runs'));
  await pool.query(`CREATE INDEX IF NOT EXISTS sales_agent_runs_user_idx ON sales_agent_runs (user_id, created_at DESC)`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS sales_agent_runs_subject_idx ON sales_agent_runs (subject_type, subject_id)`).catch(() => undefined);

  // Developer test calls. A test has no lead behind it, so contact_id stays
  // NULL and no conversation record is produced — the transcript lands on the
  // attempt itself, which is the only thing there is to look at.
  await pool.query(`ALTER TABLE sales_call_attempts ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false`).catch(() => undefined);
  await pool.query(`ALTER TABLE sales_call_attempts ADD COLUMN IF NOT EXISTS transcript TEXT`).catch(() => undefined);
  await pool.query(`ALTER TABLE sales_call_attempts ADD COLUMN IF NOT EXISTS ended_reason TEXT`).catch(() => undefined);
  await pool.query(`CREATE INDEX IF NOT EXISTS sales_call_attempts_test_idx
    ON sales_call_attempts (user_id, created_at DESC) WHERE is_test = true`).catch(() => undefined);

  // Rolled-up user-level answer rates — the PRIOR that per-lead timing shrinks
  // toward. 168 rows per user, recomputed periodically, never on the read path.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sales_call_stats (
      id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      weekday    SMALLINT NOT NULL,
      hour       SMALLINT NOT NULL,
      attempts   INT NOT NULL DEFAULT 0,
      answered   INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (user_id, weekday, hour)
    )
  `).catch((err) => logger.error({ err }, 'migration_failed: sales_call_stats'));
}

// ── Marketing → Lead Generation ───────────────────────────────────────────────
//
// Tables for the vendored leads module (src/server/leads). Unlike everything
// above, these are read and written by Prisma, not the pg pool — so the column
// names are the module's camelCase and the DDL has to match
// prisma/schema.prisma exactly. Regenerate it after any schema change with:
//
//   npx prisma migrate diff --from-empty \
//     --to-schema-datamodel prisma/schema.prisma --script
//
// and re-apply the idempotency guards, which that output does not include.
// They are created here rather than by `prisma migrate` so the project keeps
// one migration path and one thing that runs at boot.
//
// The `leadgen_` prefix keeps them clear of the older `leads` / `lead_groups`
// tables, which belong to the Contacts feature and are unrelated.
async function createLeadgenTables(pool: Pool): Promise<void> {
  const enums: [string, string[]][] = [
    ['LeadSource', ['REFERRAL', 'LINKEDIN', 'COLD_EMAIL', 'OUTREACH', 'CONTENT', 'WARM_NETWORK', 'GOOGLE_MAPS', 'WEB_SCRAPE', 'DIRECTORY', 'SOCIAL', 'OTHER']],
    ['LeadStatus', ['NEW', 'QUALIFYING', 'QUALIFIED', 'DISQUALIFIED', 'CONVERTED', 'LOST']],
    ['LeadFieldType', ['TEXT', 'LONG_TEXT', 'NUMBER', 'CURRENCY', 'DATE', 'BOOLEAN', 'EMAIL', 'PHONE', 'URL', 'SELECT']],
    ['LeadActivityType', ['EMAIL', 'CALL', 'MESSAGE', 'MEETING', 'NOTE']],
    ['LeadImportSource', ['UPLOAD', 'GOOGLE_SHEET', 'GOOGLE_DRIVE_FILE']],
    ['LeadImportStatus', ['ANALYZING', 'READY', 'IMPORTED', 'FAILED']],
  ];
  for (const [name, values] of enums) {
    const labels = values.map((value) => `'${value}'`).join(', ');
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${name}') THEN
          CREATE TYPE "${name}" AS ENUM (${labels});
        END IF;
      END
      $$;
    `).catch(() => undefined);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "leadgen_lead_imports" (
      "id" TEXT NOT NULL,
      "userId" TEXT NOT NULL DEFAULT '',
      "source" "LeadImportSource" NOT NULL DEFAULT 'UPLOAD',
      "status" "LeadImportStatus" NOT NULL DEFAULT 'ANALYZING',
      "fileName" TEXT,
      "driveFileId" TEXT,
      "sheetNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
      "plan" JSONB,
      "analyzedBy" TEXT,
      "notes" TEXT,
      "error" TEXT,
      "tablesFound" INTEGER NOT NULL DEFAULT 0,
      "groupsCreated" INTEGER NOT NULL DEFAULT 0,
      "leadsCreated" INTEGER NOT NULL DEFAULT 0,
      "leadsUpdated" INTEGER NOT NULL DEFAULT 0,
      "rowsSkipped" INTEGER NOT NULL DEFAULT 0,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "leadgen_lead_imports_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "leadgen_lead_imports_user_fkey" FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE CASCADE
    );
  `).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "leadgen_lead_groups" (
      "id" TEXT NOT NULL,
      "userId" TEXT NOT NULL DEFAULT '',
      "name" TEXT NOT NULL,
      "slug" TEXT NOT NULL,
      "description" TEXT,
      "autoCreated" BOOLEAN NOT NULL DEFAULT false,
      "sourceLabel" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      "leadImportId" TEXT,
      CONSTRAINT "leadgen_lead_groups_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "leadgen_lead_groups_user_fkey" FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT "leadgen_lead_groups_leadImportId_fkey" FOREIGN KEY ("leadImportId") REFERENCES "leadgen_lead_imports"("id") ON DELETE SET NULL ON UPDATE CASCADE
    );
  `).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "leadgen_leads" (
      "id" TEXT NOT NULL,
      "userId" TEXT NOT NULL DEFAULT '',
      "contactName" TEXT NOT NULL,
      "contactEmail" TEXT,
      "contactPhone" TEXT,
      "companyName" TEXT,
      "source" "LeadSource" NOT NULL DEFAULT 'OTHER',
      "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
      "leadScore" INTEGER NOT NULL DEFAULT 0,
      "discoveryCallAt" TIMESTAMP(3),
      "discoveryNotes" TEXT,
      "estimatedDealSize" DECIMAL(12,2),
      "winLossReason" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      "website" TEXT,
      "address" TEXT,
      "city" TEXT,
      "region" TEXT,
      "country" TEXT,
      "category" TEXT,
      "rating" DECIMAL(3,2),
      "reviewsCount" INTEGER,
      "latitude" DOUBLE PRECISION,
      "longitude" DOUBLE PRECISION,
      "socialLinks" JSONB,
      "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
      "externalId" TEXT,
      "dedupeKey" TEXT,
      "enrichment" JSONB,
      "customFields" JSONB,
      "clientId" TEXT,
      "scraperSourceId" TEXT,
      "scraperRunId" TEXT,
      "groupId" TEXT,
      CONSTRAINT "leadgen_leads_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "leadgen_leads_user_fkey" FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT "leadgen_leads_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "leadgen_lead_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE
    );
  `).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "leadgen_lead_fields" (
      "id" TEXT NOT NULL,
      "userId" TEXT NOT NULL DEFAULT '',
      "groupId" TEXT,
      "key" TEXT NOT NULL,
      "label" TEXT NOT NULL,
      "type" "LeadFieldType" NOT NULL DEFAULT 'TEXT',
      "builtin" BOOLEAN NOT NULL DEFAULT false,
      "hidden" BOOLEAN NOT NULL DEFAULT false,
      "position" INTEGER NOT NULL DEFAULT 0,
      "width" INTEGER,
      "meta" JSONB,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "leadgen_lead_fields_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "leadgen_lead_fields_user_fkey" FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT "leadgen_lead_fields_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "leadgen_lead_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE
    );
  `).catch(() => undefined);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "leadgen_lead_activities" (
      "id" TEXT NOT NULL,
      "userId" TEXT NOT NULL DEFAULT '',
      "leadId" TEXT NOT NULL,
      "type" "LeadActivityType" NOT NULL DEFAULT 'NOTE',
      "summary" TEXT NOT NULL,
      "outcome" TEXT,
      "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "actorId" TEXT,
      "actorName" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "leadgen_lead_activities_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "leadgen_lead_activities_user_fkey" FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT "leadgen_lead_activities_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leadgen_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE
    );
  `).catch(() => undefined);

  const indexes = [
    `CREATE INDEX IF NOT EXISTS "leadgen_leads_userId_status_idx" ON "leadgen_leads"("userId", "status")`,
    `CREATE INDEX IF NOT EXISTS "leadgen_leads_groupId_idx" ON "leadgen_leads"("groupId")`,
    `CREATE INDEX IF NOT EXISTS "leadgen_leads_userId_source_createdAt_idx" ON "leadgen_leads"("userId", "source", "createdAt")`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "leadgen_leads_userId_dedupeKey_key" ON "leadgen_leads"("userId", "dedupeKey")`,
    `CREATE INDEX IF NOT EXISTS "leadgen_lead_groups_leadImportId_idx" ON "leadgen_lead_groups"("leadImportId")`,
    `CREATE INDEX IF NOT EXISTS "leadgen_lead_groups_userId_idx" ON "leadgen_lead_groups"("userId")`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "leadgen_lead_groups_userId_slug_key" ON "leadgen_lead_groups"("userId", "slug")`,
    `CREATE INDEX IF NOT EXISTS "leadgen_lead_fields_groupId_position_idx" ON "leadgen_lead_fields"("groupId", "position")`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "leadgen_lead_fields_userId_groupId_key_key" ON "leadgen_lead_fields"("userId", "groupId", "key")`,
    `CREATE INDEX IF NOT EXISTS "leadgen_lead_activities_leadId_occurredAt_idx" ON "leadgen_lead_activities"("leadId", "occurredAt")`,
    `CREATE INDEX IF NOT EXISTS "leadgen_lead_imports_userId_createdAt_idx" ON "leadgen_lead_imports"("userId", "createdAt")`,
  ];
  for (const sql of indexes) {
    await pool.query(sql).catch(() => undefined);
  }


}

export async function runIncrementalUpgradeMigrations(pool: Pool): Promise<void> {
  // 1. Unified Social Inbox Tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS social_inbox_threads (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      platform TEXT NOT NULL DEFAULT 'instagram',
      external_thread_id TEXT,
      sender_name TEXT NOT NULL,
      sender_handle TEXT NOT NULL,
      sender_avatar TEXT,
      subject_or_post_preview TEXT,
      channel_type TEXT NOT NULL DEFAULT 'comment', -- 'comment' | 'dm' | 'mention'
      sentiment TEXT NOT NULL DEFAULT 'positive',   -- 'positive' | 'neutral' | 'urgent' | 'question'
      status TEXT NOT NULL DEFAULT 'open',          -- 'open' | 'resolved' | 'snoozed'
      unread_count INTEGER NOT NULL DEFAULT 1,
      linked_contact_id TEXT,
      last_message_preview TEXT,
      last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS social_inbox_threads_user_status_idx ON social_inbox_threads(user_id, status, last_message_at DESC);

    CREATE TABLE IF NOT EXISTS social_inbox_messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES social_inbox_threads(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      direction TEXT NOT NULL DEFAULT 'inbound', -- 'inbound' | 'outbound'
      sender_name TEXT NOT NULL,
      body TEXT NOT NULL,
      ai_generated BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS social_inbox_messages_thread_idx ON social_inbox_messages(thread_id, created_at ASC);
  `).catch(() => undefined);

  // 2. Client Approval Portals (White-Label Share Links)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS client_approval_links (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      client_name TEXT,
      client_email TEXT,
      resource_type TEXT NOT NULL DEFAULT 'post', -- 'post' | 'card' | 'campaign'
      resource_id TEXT NOT NULL,
      resource_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'pending',     -- 'pending' | 'approved' | 'changes_requested'
      reviewer_name TEXT,
      reviewer_feedback TEXT,
      decided_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS client_approval_links_user_idx ON client_approval_links(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS client_approval_links_token_idx ON client_approval_links(token);
  `).catch(() => undefined);

  // 3. Outbound Webhooks & Deliveries
  await pool.query(`
    CREATE TABLE IF NOT EXISTS outbound_webhooks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      target_url TEXT NOT NULL,
      signing_secret TEXT NOT NULL,
      events TEXT[] NOT NULL DEFAULT ARRAY['lead.created', 'deal.stage_changed', 'post.published', 'approval.decided']::TEXT[],
      is_active BOOLEAN NOT NULL DEFAULT true,
      last_triggered_at TIMESTAMPTZ,
      last_status_code INTEGER,
      failure_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS outbound_webhooks_user_idx ON outbound_webhooks(user_id, is_active);

    CREATE TABLE IF NOT EXISTS outbound_webhook_deliveries (
      id TEXT PRIMARY KEY,
      webhook_id TEXT NOT NULL REFERENCES outbound_webhooks(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_name TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      status_code INTEGER,
      response_excerpt TEXT,
      duration_ms INTEGER,
      delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS outbound_webhook_deliveries_hook_idx ON outbound_webhook_deliveries(webhook_id, delivered_at DESC);
  `).catch(() => undefined);

  // 4. Autonomous Agent Scheduled Runs & Handoffs
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_schedules (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      primary_agent_slug TEXT NOT NULL DEFAULT 'researcher',
      handoff_agent_slug TEXT,
      prompt_goal TEXT NOT NULL,
      frequency TEXT NOT NULL DEFAULT 'daily', -- 'hourly' | 'daily' | 'weekly'
      output_action TEXT NOT NULL DEFAULT 'create_post_draft', -- 'create_post_draft' | 'create_task' | 'notify_only'
      is_active BOOLEAN NOT NULL DEFAULT true,
      last_run_at TIMESTAMPTZ,
      next_run_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 day'),
      last_result_summary TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS agent_schedules_due_idx ON agent_schedules(is_active, next_run_at);

    CREATE TABLE IF NOT EXISTS agent_schedule_runs (
      id TEXT PRIMARY KEY,
      schedule_id TEXT NOT NULL REFERENCES agent_schedules(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'completed',
      primary_output TEXT,
      handoff_output TEXT,
      artifact_type TEXT,
      artifact_id TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS agent_schedule_runs_sched_idx ON agent_schedule_runs(schedule_id, started_at DESC);
  `).catch(() => undefined);

  // 5. Integrations registry rows for every connectable provider; without
  // them user_integrations and integration_logs never record these.
  await pool.query(`
    INSERT INTO integrations (provider, name, slug, type, enabled)
    VALUES
      ('tiktok','TikTok','tiktok','social', true),
      ('threads','Threads','threads','social', true),
      ('google_calendar','Google Calendar','google_calendar','messaging', true)
    ON CONFLICT (slug) DO NOTHING;
  `).catch(() => undefined);

  // 6. Instagram accounts linked through Facebook Login publish with a Page
  // token, which does not expire when minted from a long-lived user token.
  // Older code stamped the user token's 60-day expiry on them, so healthy
  // connections were flagged (and blocked) as expired.
  await pool.query(`
    UPDATE social_accounts
       SET token_expires_at = NULL,
           expires_at = NULL,
           needs_reapproval = CASE WHEN token_data->>'reason' IN ('token_expiring','token_expired') THEN false ELSE needs_reapproval END,
           token_data = CASE WHEN token_data->>'reason' IN ('token_expiring','token_expired')
                             THEN token_data - 'reason' - 'needs_reapproval_at' ELSE token_data END
     WHERE LOWER(platform) = 'instagram'
       AND token_data->>'login_method' = 'facebook'
       AND COALESCE(token_expires_at, expires_at) > COALESCE(connected_at, created_at) + INTERVAL '1 day';
  `).catch(() => undefined);

  // 7. The old token scan flagged every connection whose token expired within
  // days, including Gmail, Calendar and Zoom, whose hour-long tokens renew
  // themselves. Those soft flags were never true; clear them.
  await pool.query(`
    UPDATE social_accounts
       SET needs_reapproval = false,
           token_data = COALESCE(token_data, '{}'::jsonb) - 'reason' - 'needs_reapproval_at'
     WHERE LOWER(platform) IN ('gmail', 'google_calendar', 'slack', 'zoom')
       AND needs_reapproval = true
       AND COALESCE(token_data->>'reason', '') IN ('token_expiring', 'token_expired', 'token_refresh_failed');
  `).catch(() => undefined);

  // 8. The Page / Instagram account a Social Inbox conversation arrived on,
  // so replies go out from the same account.
  await pool.query(`ALTER TABLE social_inbox_threads ADD COLUMN IF NOT EXISTS external_account_id TEXT;`).catch(() => undefined);

  // 9. Agent team coordination: messages between a user's agents, strategies
  // with their rationale and reviews, and niche research the agents share.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      from_agent TEXT NOT NULL,
      to_agent TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'request',
      subject TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      context JSONB NOT NULL DEFAULT '{}'::jsonb,
      priority INT NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      consumed_by TEXT[] NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '14 days')
    );
    CREATE INDEX IF NOT EXISTS agent_messages_inbox_idx ON agent_messages(user_id, to_agent, status, created_at DESC);

    CREATE TABLE IF NOT EXISTS agent_strategies (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      playbook TEXT NOT NULL DEFAULT 'director_plan',
      title TEXT NOT NULL,
      hypothesis TEXT NOT NULL DEFAULT '',
      rationale TEXT NOT NULL,
      evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
      focus JSONB NOT NULL DEFAULT '{}'::jsonb,
      kpi TEXT NOT NULL,
      baseline NUMERIC,
      target NUMERIC NOT NULL,
      eval_window_days INT NOT NULL DEFAULT 14,
      status TEXT NOT NULL DEFAULT 'active',
      created_by TEXT NOT NULL DEFAULT 'director',
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_evaluated_at TIMESTAMPTZ,
      last_value NUMERIC,
      last_verdict TEXT,
      consecutive_misses INT NOT NULL DEFAULT 0,
      ended_at TIMESTAMPTZ,
      ended_reason TEXT,
      superseded_by UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS agent_strategies_one_active_idx ON agent_strategies(user_id) WHERE status = 'active';
    CREATE INDEX IF NOT EXISTS agent_strategies_user_idx ON agent_strategies(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS agent_strategy_reviews (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      strategy_id UUID NOT NULL REFERENCES agent_strategies(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kpi TEXT NOT NULL,
      value NUMERIC,
      sample INT NOT NULL DEFAULT 0,
      verdict TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS agent_strategy_reviews_idx ON agent_strategy_reviews(strategy_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS niche_research (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      niche TEXT NOT NULL DEFAULT '',
      findings JSONB NOT NULL DEFAULT '{}'::jsonb,
      sources JSONB NOT NULL DEFAULT '[]'::jsonb,
      method TEXT NOT NULL DEFAULT 'web_search',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS niche_research_user_idx ON niche_research(user_id, created_at DESC);
  `).catch(() => undefined);

  await pool.query(`
    ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
    ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'not_required';
    ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS post_format TEXT NOT NULL DEFAULT 'blog';
    ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS media_assets JSONB NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS video_url TEXT;
    ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS tenant_id TEXT;
    ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS autopilot_item_id TEXT;
  `).catch(() => undefined);

  await pool.query(`
    ALTER TABLE client_approval_links DROP CONSTRAINT IF EXISTS client_approval_links_resource_type_check;
    ALTER TABLE client_approval_links ADD CONSTRAINT client_approval_links_resource_type_check
      CHECK (resource_type IN ('post', 'card', 'campaign', 'autopilot_item', 'autopilot_batch'));
  `).catch(() => undefined);

  // 17. Brand-Aware Social Content Autopilot Core Schema & Production Hardening
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS autopilot_business_profiles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL UNIQUE,
        org_id TEXT,
        project_id TEXT,
        owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        business_name TEXT NOT NULL DEFAULT '',
        website_url TEXT NOT NULL DEFAULT '',
        industry TEXT NOT NULL DEFAULT '',
        niche TEXT NOT NULL DEFAULT '',
        business_model TEXT NOT NULL DEFAULT 'B2B',
        primary_offer TEXT NOT NULL DEFAULT '',
        price_range TEXT NOT NULL DEFAULT '',
        geography TEXT[] NOT NULL DEFAULT '{}',
        languages TEXT[] NOT NULL DEFAULT '{en}',
        audiences JSONB NOT NULL DEFAULT '[]'::jsonb,
        funnel_stage TEXT NOT NULL DEFAULT 'full_funnel',
        primary_objective TEXT NOT NULL DEFAULT 'awareness',
        secondary_objectives TEXT[] NOT NULL DEFAULT '{}',
        success_metric TEXT NOT NULL DEFAULT '',
        sales_cycle TEXT NOT NULL DEFAULT 'medium',
        conversion_path TEXT NOT NULL DEFAULT '',
        available_proof JSONB NOT NULL DEFAULT '[]'::jsonb,
        capacity JSONB NOT NULL DEFAULT '{}'::jsonb,
        channels JSONB NOT NULL DEFAULT '{}'::jsonb,
        risk_profile JSONB NOT NULL DEFAULT '{}'::jsonb,
        schedule_config JSONB NOT NULL DEFAULT '{}'::jsonb,
        onboarding_step INT NOT NULL DEFAULT 1,
        onboarding_completed BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS autopilot_business_profiles_tenant_idx ON autopilot_business_profiles(tenant_id);

      CREATE TABLE IF NOT EXISTS autopilot_brand_profiles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL UNIQUE,
        org_id TEXT,
        project_id TEXT,
        owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        brand_name TEXT NOT NULL DEFAULT '',
        current_version INT NOT NULL DEFAULT 1,
        source JSONB NOT NULL DEFAULT '{}'::jsonb,
        identity JSONB NOT NULL DEFAULT '{}'::jsonb,
        visual JSONB NOT NULL DEFAULT '{}'::jsonb,
        voice JSONB NOT NULL DEFAULT '{}'::jsonb,
        content_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
        approval_status TEXT NOT NULL DEFAULT 'needs_review',
        approved_by TEXT,
        approved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS autopilot_brand_profiles_tenant_idx ON autopilot_brand_profiles(tenant_id);

      CREATE TABLE IF NOT EXISTS autopilot_brand_versions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        brand_profile_id UUID NOT NULL REFERENCES autopilot_brand_profiles(id) ON DELETE CASCADE,
        tenant_id TEXT NOT NULL,
        version INT NOT NULL,
        snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
        change_rationale TEXT NOT NULL DEFAULT '',
        approved_by TEXT,
        approved_at TIMESTAMPTZ,
        created_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(brand_profile_id, version)
      );
      CREATE INDEX IF NOT EXISTS autopilot_brand_versions_tenant_idx ON autopilot_brand_versions(tenant_id, version DESC);

      CREATE TABLE IF NOT EXISTS autopilot_brand_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        brand_profile_id UUID NOT NULL REFERENCES autopilot_brand_profiles(id) ON DELETE CASCADE,
        tenant_id TEXT NOT NULL,
        name TEXT NOT NULL,
        value JSONB NOT NULL,
        category TEXT NOT NULL,
        sub_type TEXT NOT NULL DEFAULT '',
        source_url TEXT,
        source_type TEXT NOT NULL DEFAULT 'customer_entered',
        confidence NUMERIC(4,3) NOT NULL DEFAULT 1.000,
        rights_confirmed BOOLEAN NOT NULL DEFAULT true,
        approval_status TEXT NOT NULL DEFAULT 'candidate',
        version INT NOT NULL DEFAULT 1,
        notes TEXT NOT NULL DEFAULT '',
        allowed_contexts TEXT[] NOT NULL DEFAULT '{}',
        last_verified_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS autopilot_brand_tokens_tenant_idx ON autopilot_brand_tokens(tenant_id, category, approval_status);

      CREATE TABLE IF NOT EXISTS autopilot_brand_assets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        brand_profile_id UUID NOT NULL REFERENCES autopilot_brand_profiles(id) ON DELETE CASCADE,
        tenant_id TEXT NOT NULL,
        asset_type TEXT NOT NULL,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        mime_type TEXT NOT NULL DEFAULT '',
        variant TEXT NOT NULL DEFAULT 'master',
        rights_confirmed BOOLEAN NOT NULL DEFAULT false,
        consented_likeness BOOLEAN NOT NULL DEFAULT false,
        usage_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
        approval_status TEXT NOT NULL DEFAULT 'needs_review',
        uploaded_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS autopilot_brand_assets_tenant_idx ON autopilot_brand_assets(tenant_id, asset_type);

      CREATE TABLE IF NOT EXISTS autopilot_strategies (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL,
        org_id TEXT,
        project_id TEXT,
        owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL DEFAULT 'Primary Strategy',
        current_version INT NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'proposed',
        objective JSONB NOT NULL DEFAULT '{}'::jsonb,
        audiences JSONB NOT NULL DEFAULT '[]'::jsonb,
        positioning JSONB NOT NULL DEFAULT '{}'::jsonb,
        channels JSONB NOT NULL DEFAULT '[]'::jsonb,
        pillars JSONB NOT NULL DEFAULT '[]'::jsonb,
        funnel_mix JSONB NOT NULL DEFAULT '{}'::jsonb,
        cadence JSONB NOT NULL DEFAULT '{}'::jsonb,
        campaigns JSONB NOT NULL DEFAULT '[]'::jsonb,
        cta_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
        proof_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
        risk_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
        measurement JSONB NOT NULL DEFAULT '{}'::jsonb,
        assumptions JSONB NOT NULL DEFAULT '[]'::jsonb,
        follow_up_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
        rationale TEXT NOT NULL DEFAULT '',
        approved_by TEXT,
        approved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS autopilot_strategies_tenant_idx ON autopilot_strategies(tenant_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS autopilot_strategy_versions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        strategy_id UUID NOT NULL REFERENCES autopilot_strategies(id) ON DELETE CASCADE,
        tenant_id TEXT NOT NULL,
        version INT NOT NULL,
        snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
        change_rationale TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(strategy_id, version)
      );

      CREATE TABLE IF NOT EXISTS autopilot_content_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL,
        org_id TEXT,
        project_id TEXT,
        owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        strategy_id UUID REFERENCES autopilot_strategies(id) ON DELETE SET NULL,
        strategy_version INT,
        brand_profile_id UUID REFERENCES autopilot_brand_profiles(id) ON DELETE SET NULL,
        brand_version INT,
        campaign_id TEXT NOT NULL DEFAULT '',
        campaign_name TEXT NOT NULL DEFAULT '',
        pillar_id TEXT NOT NULL DEFAULT '',
        pillar_name TEXT NOT NULL DEFAULT '',
        funnel_stage TEXT NOT NULL DEFAULT 'awareness',
        title TEXT NOT NULL DEFAULT '',
        hook TEXT NOT NULL DEFAULT '',
        caption TEXT NOT NULL DEFAULT '',
        channel_variants JSONB NOT NULL DEFAULT '{}'::jsonb,
        format TEXT NOT NULL DEFAULT 'static_graphic',
        workflow_type TEXT NOT NULL DEFAULT 'branded_social_graphic',
        target_channels TEXT[] NOT NULL DEFAULT '{}',
        lifecycle_state TEXT NOT NULL DEFAULT 'idea',
        approval_required BOOLEAN NOT NULL DEFAULT true,
        risk_flags TEXT[] NOT NULL DEFAULT '{}',
        validation_report JSONB NOT NULL DEFAULT '{}'::jsonb,
        media_assets JSONB NOT NULL DEFAULT '[]'::jsonb,
        deterministic_overlay JSONB NOT NULL DEFAULT '{}'::jsonb,
        slides JSONB NOT NULL DEFAULT '[]'::jsonb,
        storyboard JSONB NOT NULL DEFAULT '[]'::jsonb,
        alt_text TEXT NOT NULL DEFAULT '',
        disclosures TEXT[] NOT NULL DEFAULT '{}',
        scheduled_slot JSONB,
        linked_blog_post_id TEXT,
        content_hash TEXT NOT NULL DEFAULT '',
        approved_content_hash TEXT,
        approved_destination JSONB,
        execution_mode TEXT NOT NULL DEFAULT 'pending',
        version INT NOT NULL DEFAULT 1,
        created_by TEXT NOT NULL,
        approved_by TEXT,
        approved_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS autopilot_content_items_tenant_idx ON autopilot_content_items(tenant_id, lifecycle_state, created_at DESC);

      CREATE TABLE IF NOT EXISTS autopilot_content_item_revisions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL,
        content_item_id UUID NOT NULL REFERENCES autopilot_content_items(id) ON DELETE CASCADE,
        version INT NOT NULL,
        content_hash TEXT NOT NULL,
        snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
        changed_fields TEXT[] NOT NULL DEFAULT '{}',
        created_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(content_item_id, version)
      );
      CREATE INDEX IF NOT EXISTS autopilot_item_revs_tenant_idx ON autopilot_content_item_revisions(tenant_id, content_item_id, version DESC);

      CREATE TABLE IF NOT EXISTS autopilot_creative_briefs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        content_item_id UUID NOT NULL UNIQUE REFERENCES autopilot_content_items(id) ON DELETE CASCADE,
        tenant_id TEXT NOT NULL,
        objective TEXT NOT NULL DEFAULT '',
        target_audience TEXT NOT NULL DEFAULT '',
        channel TEXT NOT NULL DEFAULT 'instagram',
        placement TEXT NOT NULL DEFAULT 'FEED_POST',
        aspect_ratio TEXT NOT NULL DEFAULT '4:5',
        safe_areas JSONB NOT NULL DEFAULT '{}'::jsonb,
        hook_message TEXT NOT NULL DEFAULT '',
        intended_takeaway TEXT NOT NULL DEFAULT '',
        cta TEXT NOT NULL DEFAULT '',
        destination_url TEXT NOT NULL DEFAULT '',
        brand_profile_id UUID,
        brand_version INT NOT NULL DEFAULT 1,
        creative_mode TEXT NOT NULL DEFAULT 'brand_inspired',
        controls JSONB NOT NULL DEFAULT '{}'::jsonb,
        reference_asset_ids TEXT[] NOT NULL DEFAULT '{}',
        permitted_claims TEXT[] NOT NULL DEFAULT '{}',
        evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
        selected_provider TEXT NOT NULL DEFAULT '',
        selected_model TEXT NOT NULL DEFAULT '',
        estimated_provider_cost_usd NUMERIC(10,4) NOT NULL DEFAULT 0,
        estimated_credits INT NOT NULL DEFAULT 0,
        spend_limit_usd NUMERIC(10,4) NOT NULL DEFAULT 5.0000,
        credit_ceiling INT NOT NULL DEFAULT 100,
        max_attempts INT NOT NULL DEFAULT 3,
        review_criteria TEXT[] NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS autopilot_creative_briefs_tenant_idx ON autopilot_creative_briefs(tenant_id);

      CREATE TABLE IF NOT EXISTS autopilot_workflow_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL,
        content_item_id UUID NOT NULL REFERENCES autopilot_content_items(id) ON DELETE CASCADE,
        workflow_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
        node_executions JSONB NOT NULL DEFAULT '[]'::jsonb,
        estimated_provider_cost_usd NUMERIC(10,4) NOT NULL DEFAULT 0,
        actual_provider_cost_usd NUMERIC(10,4) NOT NULL DEFAULT 0,
        estimated_credits INT NOT NULL DEFAULT 0,
        actual_credits INT NOT NULL DEFAULT 0,
        attempt_number INT NOT NULL DEFAULT 1,
        failure_reason TEXT,
        provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS autopilot_workflow_runs_tenant_idx ON autopilot_workflow_runs(tenant_id, content_item_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS autopilot_budget_reservations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        content_item_id UUID REFERENCES autopilot_content_items(id) ON DELETE SET NULL,
        workflow_run_id UUID REFERENCES autopilot_workflow_runs(id) ON DELETE SET NULL,
        idempotency_key TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'reserved',
        estimated_provider_cost_usd NUMERIC(10,4) NOT NULL DEFAULT 0,
        actual_provider_cost_usd NUMERIC(10,4) NOT NULL DEFAULT 0,
        customer_price_usd NUMERIC(10,4) NOT NULL DEFAULT 0,
        reserved_credits INT NOT NULL DEFAULT 0,
        settled_credits INT NOT NULL DEFAULT 0,
        provider TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        is_mock BOOLEAN NOT NULL DEFAULT false,
        meta JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(tenant_id, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS autopilot_budget_res_tenant_status_idx ON autopilot_budget_reservations(tenant_id, status, created_at DESC);

      CREATE TABLE IF NOT EXISTS autopilot_tenant_controls (
        tenant_id TEXT PRIMARY KEY,
        kill_switch_generation BOOLEAN NOT NULL DEFAULT false,
        kill_switch_publishing BOOLEAN NOT NULL DEFAULT false,
        auto_generate_enabled BOOLEAN NOT NULL DEFAULT false,
        auto_publish_enabled BOOLEAN NOT NULL DEFAULT false,
        monthly_budget_usd NUMERIC(10,4) NOT NULL DEFAULT 50.0000,
        monthly_credit_cap INT NOT NULL DEFAULT 5000,
        per_job_max_usd NUMERIC(10,4) NOT NULL DEFAULT 10.0000,
        confirmation_threshold_usd NUMERIC(10,4) NOT NULL DEFAULT 2.0000,
        retention_days INT NOT NULL DEFAULT 90,
        updated_by TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS autopilot_website_scans (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL,
        url TEXT NOT NULL,
        final_url TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'success',
        candidate_count INT NOT NULL DEFAULT 0,
        warnings TEXT[] NOT NULL DEFAULT '{}',
        duration_ms INT NOT NULL DEFAULT 0,
        created_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS autopilot_website_scans_tenant_idx ON autopilot_website_scans(tenant_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS autopilot_approval_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL,
        content_item_id UUID NOT NULL REFERENCES autopilot_content_items(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        from_state TEXT NOT NULL,
        to_state TEXT NOT NULL,
        actor_user_id TEXT,
        actor_name TEXT NOT NULL DEFAULT '',
        actor_role TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS autopilot_approval_events_tenant_idx ON autopilot_approval_events(tenant_id, content_item_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS autopilot_publications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL,
        content_item_id UUID NOT NULL REFERENCES autopilot_content_items(id) ON DELETE CASCADE,
        channel TEXT NOT NULL,
        social_account_id TEXT,
        platform_media_type TEXT NOT NULL DEFAULT 'FEED_POST',
        slot_name TEXT NOT NULL DEFAULT '',
        timezone TEXT NOT NULL DEFAULT 'UTC',
        scheduled_at TIMESTAMPTZ,
        status TEXT NOT NULL DEFAULT 'pending',
        remote_post_id TEXT,
        error_message TEXT,
        retryable BOOLEAN NOT NULL DEFAULT false,
        reconcile_required BOOLEAN NOT NULL DEFAULT false,
        approved_revision_hash TEXT,
        provider_response JSONB NOT NULL DEFAULT '{}'::jsonb,
        paused BOOLEAN NOT NULL DEFAULT false,
        published_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS autopilot_publications_tenant_idx ON autopilot_publications(tenant_id, status, scheduled_at);
      CREATE INDEX IF NOT EXISTS autopilot_publications_due_worker_idx ON autopilot_publications(status, scheduled_at) WHERE status IN ('scheduled', 'publish_failed');

      CREATE TABLE IF NOT EXISTS autopilot_publication_attempts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL,
        publication_id UUID NOT NULL REFERENCES autopilot_publications(id) ON DELETE CASCADE,
        idempotency_key TEXT NOT NULL,
        attempt_number INT NOT NULL DEFAULT 1,
        status TEXT NOT NULL,
        request_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
        response_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
        error_message TEXT,
        retryable BOOLEAN NOT NULL DEFAULT false,
        next_retry_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS autopilot_pub_attempts_pub_idx ON autopilot_publication_attempts(publication_id, attempt_number DESC);
      CREATE INDEX IF NOT EXISTS autopilot_pub_attempts_retry_idx ON autopilot_publication_attempts(status, next_retry_at) WHERE retryable IS TRUE;

      CREATE TABLE IF NOT EXISTS autopilot_channel_metrics (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL,
        content_item_id UUID REFERENCES autopilot_content_items(id) ON DELETE SET NULL,
        publication_id UUID REFERENCES autopilot_publications(id) ON DELETE SET NULL,
        strategy_id UUID REFERENCES autopilot_strategies(id) ON DELETE SET NULL,
        strategy_version INT,
        content_item_version INT,
        channel TEXT NOT NULL,
        objective TEXT NOT NULL DEFAULT 'awareness',
        pillar_name TEXT NOT NULL DEFAULT '',
        format TEXT NOT NULL DEFAULT '',
        traffic_source TEXT NOT NULL DEFAULT 'organic',
        external_post_id TEXT,
        metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
        window_start TIMESTAMPTZ,
        window_end TIMESTAMPTZ,
        source TEXT NOT NULL DEFAULT 'platform_api',
        collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS autopilot_channel_metrics_tenant_idx ON autopilot_channel_metrics(tenant_id, channel, collected_at DESC);

      CREATE TABLE IF NOT EXISTS autopilot_experiments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL,
        strategy_id UUID REFERENCES autopilot_strategies(id) ON DELETE SET NULL,
        hypothesis TEXT NOT NULL,
        variable_changed TEXT NOT NULL,
        control_variant JSONB NOT NULL DEFAULT '{}'::jsonb,
        test_variant JSONB NOT NULL DEFAULT '{}'::jsonb,
        channel TEXT NOT NULL DEFAULT '',
        audience_segment TEXT NOT NULL DEFAULT '',
        primary_metric TEXT NOT NULL,
        min_sample_size INT NOT NULL DEFAULT 6,
        current_sample_size INT NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'proposed',
        result JSONB NOT NULL DEFAULT '{}'::jsonb,
        started_at TIMESTAMPTZ,
        ended_at TIMESTAMPTZ,
        created_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS autopilot_experiments_tenant_idx ON autopilot_experiments(tenant_id, status);

      CREATE TABLE IF NOT EXISTS autopilot_recommendations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL,
        strategy_id UUID REFERENCES autopilot_strategies(id) ON DELETE CASCADE,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
        sample_size INT NOT NULL DEFAULT 0,
        confidence NUMERIC(4,3) NOT NULL DEFAULT 0,
        proposed_patch JSONB NOT NULL DEFAULT '{}'::jsonb,
        attribution_note TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        decided_by TEXT,
        decided_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS autopilot_recommendations_tenant_idx ON autopilot_recommendations(tenant_id, status, created_at DESC);

      CREATE TABLE IF NOT EXISTS autopilot_audit_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id TEXT NOT NULL,
        actor_user_id TEXT,
        actor_role TEXT NOT NULL DEFAULT '',
        event_type TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        details JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS autopilot_audit_events_tenant_idx ON autopilot_audit_events(tenant_id, created_at DESC);
    `);

    // Incremental column upgrades & index migrations for existing databases
    await pool.query(`
      DO $$
      BEGIN
        ALTER TABLE autopilot_business_profiles ALTER COLUMN org_id TYPE TEXT USING org_id::text;
        ALTER TABLE autopilot_business_profiles ALTER COLUMN project_id TYPE TEXT USING project_id::text;
        ALTER TABLE autopilot_brand_profiles ALTER COLUMN org_id TYPE TEXT USING org_id::text;
        ALTER TABLE autopilot_brand_profiles ALTER COLUMN project_id TYPE TEXT USING project_id::text;
        ALTER TABLE autopilot_strategies ALTER COLUMN org_id TYPE TEXT USING org_id::text;
        ALTER TABLE autopilot_strategies ALTER COLUMN project_id TYPE TEXT USING project_id::text;
        ALTER TABLE autopilot_content_items ALTER COLUMN org_id TYPE TEXT USING org_id::text;
        ALTER TABLE autopilot_content_items ALTER COLUMN project_id TYPE TEXT USING project_id::text;
      EXCEPTION WHEN OTHERS THEN NULL;
      END $$;

      ALTER TABLE client_approval_links ADD COLUMN IF NOT EXISTS tenant_id TEXT;
      CREATE INDEX IF NOT EXISTS client_approval_links_tenant_idx ON client_approval_links(tenant_id) WHERE tenant_id IS NOT NULL;

      ALTER TABLE autopilot_content_items ADD COLUMN IF NOT EXISTS campaign_id TEXT NOT NULL DEFAULT '';
      ALTER TABLE autopilot_content_items ADD COLUMN IF NOT EXISTS content_hash TEXT NOT NULL DEFAULT '';
      ALTER TABLE autopilot_content_items ADD COLUMN IF NOT EXISTS approved_content_hash TEXT;
      ALTER TABLE autopilot_content_items ADD COLUMN IF NOT EXISTS approved_destination JSONB;
      ALTER TABLE autopilot_content_items ADD COLUMN IF NOT EXISTS execution_mode TEXT NOT NULL DEFAULT 'pending';

      ALTER TABLE autopilot_publications ADD COLUMN IF NOT EXISTS reconcile_required BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE autopilot_publications ADD COLUMN IF NOT EXISTS approved_revision_hash TEXT;
      ALTER TABLE autopilot_publications ADD COLUMN IF NOT EXISTS provider_response JSONB NOT NULL DEFAULT '{}'::jsonb;
      ALTER TABLE autopilot_publications ADD COLUMN IF NOT EXISTS paused BOOLEAN NOT NULL DEFAULT false;

      ALTER TABLE autopilot_channel_metrics ADD COLUMN IF NOT EXISTS strategy_id UUID REFERENCES autopilot_strategies(id) ON DELETE SET NULL;
      ALTER TABLE autopilot_channel_metrics ADD COLUMN IF NOT EXISTS strategy_version INT;
      ALTER TABLE autopilot_channel_metrics ADD COLUMN IF NOT EXISTS content_item_version INT;
      ALTER TABLE autopilot_channel_metrics ADD COLUMN IF NOT EXISTS traffic_source TEXT NOT NULL DEFAULT 'organic';
      ALTER TABLE autopilot_channel_metrics ADD COLUMN IF NOT EXISTS external_post_id TEXT;

      DO $$
      BEGIN
        ALTER TABLE autopilot_publication_attempts DROP CONSTRAINT IF EXISTS autopilot_publication_attempts_idempotency_key_key;
      EXCEPTION WHEN OTHERS THEN NULL;
      END $$;

      CREATE UNIQUE INDEX IF NOT EXISTS autopilot_pub_attempts_tenant_idemp_idx ON autopilot_publication_attempts(tenant_id, idempotency_key);
      CREATE UNIQUE INDEX IF NOT EXISTS autopilot_publications_active_unique_idx ON autopilot_publications (tenant_id, content_item_id, channel, COALESCE(social_account_id, '')) WHERE status IN ('pending', 'scheduled', 'publishing');
      CREATE UNIQUE INDEX IF NOT EXISTS autopilot_metrics_dedup_idx ON autopilot_channel_metrics (
        tenant_id,
        COALESCE(publication_id, '00000000-0000-0000-0000-000000000000'::uuid),
        channel,
        COALESCE(window_start, '1970-01-01 00:00:00+00'::timestamptz),
        COALESCE(window_end, '1970-01-01 00:00:00+00'::timestamptz),
        traffic_source
      );

      INSERT INTO schema_migrations(version, checksum, applied_at)
      VALUES ('2026.10.29-autopilot-v2-production', 'applied', NOW())
      ON CONFLICT (version) DO UPDATE SET applied_at = NOW();
    `);

    logger.info('Autopilot v2 production migration applied successfully');
  } catch (err: any) {
    logger.error({ err }, 'Autopilot v2 production migration failed');
    throw new Error(`Autopilot database migration failed: ${err?.message || String(err)}`);
  }
}
