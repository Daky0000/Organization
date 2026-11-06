// social_accounts.token_data is a plaintext JSONB column that also carries
// profile metadata (handle, avatar, scopes, page binding) read all over the
// app. Live credentials must never be persisted there: access/refresh tokens
// belong in the *_encrypted columns, and the one extra credential some flows
// need (the Meta user token behind Instagram-via-Facebook) is stored
// encrypted under USER_ACCESS_TOKEN_ENC_KEY.

// Removed at any nesting depth (Slack nests a user token under authed_user).
export const TOKEN_DATA_SECRET_KEYS = [
  'access_token',
  'accessToken',
  'refresh_token',
  'refreshToken',
  'short_lived_access_token',
  'user_access_token',
  'pageAccessToken',
  'page_access_token',
  'id_token',
  'client_secret',
  'code_verifier',
] as const;

export const USER_ACCESS_TOKEN_ENC_KEY = 'user_access_token_enc';

const SECRET_KEY_SET = new Set<string>(TOKEN_DATA_SECRET_KEYS);
const MAX_DEPTH = 4;

function stripSecrets(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => stripSecrets(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_SET.has(key)) continue;
    // Slack incoming-webhook URLs are bearer credentials too.
    if (key === 'incoming_webhook' && child && typeof child === 'object') {
      const { url: _url, ...rest } = child as Record<string, unknown>;
      out[key] = stripSecrets(rest, depth + 1);
      continue;
    }
    out[key] = stripSecrets(child, depth + 1);
  }
  return out;
}

// Returns a copy safe to write to token_data. When `encrypt` is given, a
// plaintext Meta user token is kept as ciphertext so Instagram-via-Facebook
// can still discover Pages later.
export function sanitizeTokenData(
  tokenData: unknown,
  encrypt?: (plain: string) => string,
): Record<string, any> {
  if (!tokenData || typeof tokenData !== 'object' || Array.isArray(tokenData)) return {};
  const source = tokenData as Record<string, any>;
  const safe = stripSecrets(source, 0) as Record<string, any>;
  const userToken = typeof source.user_access_token === 'string' ? source.user_access_token.trim() : '';
  if (userToken && encrypt) {
    safe[USER_ACCESS_TOKEN_ENC_KEY] = encrypt(userToken);
  }
  return safe;
}

// Reads the Meta user token for Instagram-via-Facebook: the encrypted copy
// first, then the plaintext key that rows written before this change carry.
export function readUserAccessToken(tokenData: unknown, decrypt: (encrypted: string) => string): string {
  if (!tokenData || typeof tokenData !== 'object') return '';
  const data = tokenData as Record<string, any>;
  const encrypted = typeof data[USER_ACCESS_TOKEN_ENC_KEY] === 'string' ? data[USER_ACCESS_TOKEN_ENC_KEY] : '';
  if (encrypted) {
    try {
      const plain = decrypt(encrypted).trim();
      if (plain) return plain;
    } catch {
      // Encrypted under a different key — fall through to the legacy copy.
    }
  }
  return typeof data.user_access_token === 'string' ? data.user_access_token.trim() : '';
}

// The account fields an API response may show for a freshly connected
// account. Never includes credentials.
export function toPublicConnectionSummary(platform: string, tokenData: unknown): {
  platform: string;
  accountId: string | null;
  accountName: string | null;
  username: string | null;
  avatarUrl: string | null;
} {
  const data = tokenData && typeof tokenData === 'object' ? (tokenData as Record<string, any>) : {};
  const str = (value: unknown) => (typeof value === 'string' || typeof value === 'number' ? String(value).trim() || null : null);
  return {
    platform,
    accountId: str(data.user_id ?? data.id ?? data.sub),
    accountName: str(data.name),
    username: str(data.username),
    avatarUrl: str(data.avatar_url),
  };
}

type QueryFn = (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;

// One-off cleanup for rows written before credentials were kept out of
// token_data: secrets are dropped (the encrypted columns hold the live
// tokens) and a Meta user token moves to its encrypted key. A row whose
// re-encryption fails is left untouched rather than losing that token.
export async function migrateLegacyTokenData(query: QueryFn, encrypt: (plain: string) => string): Promise<number> {
  const { rows } = await query(
    `SELECT id, token_data FROM social_accounts
      WHERE token_data ?| $1::text[]
         OR (token_data->'authed_user') ? 'access_token'
         OR (token_data->'incoming_webhook') ? 'url'`,
    [TOKEN_DATA_SECRET_KEYS],
  );
  let migrated = 0;
  for (const row of rows) {
    try {
      const cleaned = sanitizeTokenData(row.token_data, encrypt);
      await query('UPDATE social_accounts SET token_data = $2::jsonb WHERE id = $1', [row.id, JSON.stringify(cleaned)]);
      migrated++;
    } catch {
      // Keep the row as it is; the next boot retries.
    }
  }
  return migrated;
}
