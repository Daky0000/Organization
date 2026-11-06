import express from 'express';
import type { Router, Response, NextFunction } from 'express';
import type { Request } from '../types/http.ts';
import axios from 'axios';
import { randomBytes, randomUUID } from 'crypto';
import bcrypt from 'bcryptjs';
import { signToken, getUserById, userToAuthPayload } from '../user-auth.ts';
import { encryptPlatformConfig, decryptPlatformConfig, maskPlatformConfigSecrets, mergeMaskedSecrets } from '../integration-helpers.ts';
import type { Pool } from 'pg';
import { logger } from '../logger.ts';

type AuthResult = { userId: string; role?: string } | null;

interface SocialAuthDeps {
  pool: Pool;
  requireAuth: (req: Request, res: Response) => AuthResult;
  requireAdmin: (req: Request, res: Response) => Promise<AuthResult>;
  hasDatabase: () => boolean;
  dbQuery: <T = any>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  jwtSecret: string;
  jwtExpiresIn: string;
}

const SOCIAL_PROVIDER_CONFIG: Record<string, { authUrl: string; tokenUrl: string; userInfoUrl: string; scopes: string }> = {
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
    scopes: 'openid email profile',
  },
  github: {
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    scopes: 'read:user user:email',
  },
  microsoft: {
    authUrl: 'https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token',
    userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
    scopes: 'openid email profile',
  },
};

// Module-level OAuth state store (replaces app.locals usage; auto-expires entries)

export function registerSocialAuthRoutes({ requireAuth, requireAdmin, hasDatabase, dbQuery, pool }: SocialAuthDeps): Router {
  const router = express.Router();
  async function loginIdentity(provider: string,subject: string,email: string,name: string,verifiedEmail: boolean) {
    if (!hasDatabase()) throw new Error('Database unavailable');
    if (!subject || !email || !email.includes('@')) throw new Error('The provider did not supply an email address. Sign in with email instead.');
    const client=await pool.connect();
    let id: string;
    try {
      await client.query('BEGIN');
      const identity=await client.query('SELECT user_id FROM social_login_identities WHERE provider=$1 AND subject=$2',[provider,subject]);
      const existing=await client.query('SELECT id,status FROM users WHERE LOWER(email)=LOWER($1)',[email]);
      if (identity.rows[0]) id=identity.rows[0].user_id;
      else if (existing.rows[0]) {
        if (!verifiedEmail) throw new Error('Sign in with your password to link this provider.');
        id=existing.rows[0].id;
      } else {
        id=randomUUID();
        await client.query(`INSERT INTO users(id,full_name,username,email,password_hash,role,status,email_verified)
          VALUES($1,$2,$3,$4,$5,'user','active',$6)`,[id,name,`${provider}_${id.slice(0,8)}`,email.toLowerCase(),await bcrypt.hash(randomBytes(32).toString('hex'),12),verifiedEmail]);
      }
      const user=await client.query('SELECT status FROM users WHERE id=$1',[id]);
      if (user.rows[0]?.status!=='active') throw new Error('Account is disabled');
      await client.query('INSERT INTO social_login_identities(provider,subject,user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[provider,subject,id]);
      await client.query('UPDATE users SET last_login_at=NOW() WHERE id=$1',[id]);
      await client.query('COMMIT');
    } catch(error) { await client.query('ROLLBACK');throw error; } finally { client.release(); }
    const user=await getUserById(id);
    if (!user || user.status!=='active') throw new Error('Account is disabled');
    return { token: signToken(user.id,user.email,user.token_version),user: userToAuthPayload(user) };
  }


  // GET /api/auth/:provider/start — redirect to provider's OAuth page
  router.get('/api/auth/:provider/start', async (req: Request, res: Response) => {
    try {
      const { provider } = req.params as { provider: string };
      const cfg = SOCIAL_PROVIDER_CONFIG[provider];
      if (!cfg) return res.status(404).json({ success: false, error: 'Unknown provider' });

      const providerRow = await dbQuery('SELECT config, enabled FROM auth_providers WHERE provider = $1', [provider]).catch(() => ({ rows: [] }));
      if (!providerRow.rows.length || !(providerRow.rows[0] as any).enabled) {
        return res.status(403).json({ success: false, error: 'Provider not enabled' });
      }
      const config = decryptPlatformConfig((providerRow.rows[0] as any).config) as Record<string, string>;
      const clientId = config.clientId || '';
      const redirectUri = config.redirectUri || '';
      if (!clientId || !redirectUri) return res.status(400).json({ success: false, error: 'Provider not configured' });

      const state = randomBytes(16).toString('hex');
      if (!hasDatabase()) return res.status(503).json({ error: 'Login service unavailable' });
      await dbQuery(`INSERT INTO login_oauth_states(state,provider,expires_at) VALUES($1,$2,NOW()+INTERVAL '10 minutes')`,[state,provider]);

      let authUrl = cfg.authUrl.replace('{tenantId}', config.tenantId || 'common');
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: cfg.scopes,
        state,
        access_type: 'offline',
        prompt: 'select_account',
      });
      return res.redirect(`${authUrl}?${params.toString()}`);
    } catch (error) {
      logger.error('Social auth start error:', error);
      return res.status(500).json({ success: false, error: 'Failed to start social login' });
    }
  });

  // GET /auth/:provider/callback — handle social login; pass-through integration callbacks to frontend SPA
  router.get('/auth/:provider/callback', async (req: Request, res: Response, next) => {
    const FRONTEND_URL = process.env.VITE_APP_URL || process.env.FRONTEND_URL || 'https://marketing.dakyx.com';
    try {
      const { provider } = req.params as { provider: string };
      const providerKey = String(provider || '').trim().toLowerCase();

      // Integration callbacks (Gmail/LinkedIn/Twitter/Facebook/etc.) belong to the SPA.
      // Call next() so the SPA catch-all serves index.html — avoids a redirect loop when
      // the frontend and backend share the same domain (e.g. marketing.dakyx.com).
      if (!SOCIAL_PROVIDER_CONFIG[providerKey]) {
        const hasError = req.query['error'] || req.query['error_description'];
        if (hasError) logger.error(`OAuth callback error for ${providerKey}:`, req.query);
        return next();
      }

      const { code, state, error: oauthError } = req.query as Record<string, string>;
      if (oauthError) return res.redirect(`${FRONTEND_URL}/?auth_error=${encodeURIComponent(oauthError)}`);

      // Validate state
      const consumed = await dbQuery('DELETE FROM login_oauth_states WHERE state=$1 AND provider=$2 AND expires_at>NOW() RETURNING state',[state,provider]);
      if (!consumed.rows.length) return res.redirect(`${FRONTEND_URL}/?auth_error=invalid_state`);

      const cfg = SOCIAL_PROVIDER_CONFIG[provider];
      if (!cfg) return res.redirect(`${FRONTEND_URL}/?auth_error=unknown_provider`);

      const providerRow = await dbQuery('SELECT config FROM auth_providers WHERE provider = $1', [provider]).catch(() => ({ rows: [] }));
      if (!providerRow.rows.length) return res.redirect(`${FRONTEND_URL}/?auth_error=provider_not_configured`);
      const config = decryptPlatformConfig((providerRow.rows[0] as any).config) as Record<string, string>;

      // Exchange code for token
      const tokenUrl = cfg.tokenUrl.replace('{tenantId}', config.tenantId || 'common');
      const tokenRes = await axios.post<Record<string, string>>(tokenUrl, new URLSearchParams({
        client_id: config.clientId || '',
        client_secret: config.clientSecret || '',
        code: code || '',
        redirect_uri: config.redirectUri || '',
        grant_type: 'authorization_code',
      }).toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      });

      const accessToken = tokenRes.data.access_token;
      if (!accessToken) throw new Error('No access token received');

      // Fetch user info
      const userInfoUrl = cfg.userInfoUrl;
      const userRes = await axios.get<Record<string, string>>(userInfoUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const userInfo = userRes.data;
      let email = userInfo.email || userInfo.mail || '';
      let verified = provider === 'google' && (userInfo as Record<string,unknown>).email_verified === true;
      if (provider === 'github') {
        const emails = await axios.get<Array<{ email: string; primary: boolean; verified: boolean }>>('https://api.github.com/user/emails',{ headers: { Authorization: `Bearer ${accessToken}` },timeout: 10000 });
        const primary = emails.data.find(item => item.primary && item.verified);
        email=primary?.email || '';verified=Boolean(primary);
      }
      const result=await loginIdentity(provider,String(userInfo.sub || userInfo.id || ''),email,userInfo.name || userInfo.displayName || email.split('@')[0],verified);
      return res.redirect(`${FRONTEND_URL}/login#auth_token=${encodeURIComponent(result.token)}&auth_provider=${provider}`);

    } catch (error) {
      logger.error('Social auth callback error:', error);
      const FRONTEND_URL = process.env.VITE_APP_URL || process.env.FRONTEND_URL || 'https://marketing.dakyx.com';
      return res.redirect(`${FRONTEND_URL}/?auth_error=${encodeURIComponent('Social login failed')}`);
    }
  });

  // GET /api/auth/providers — public: returns only enabled providers (for login page)
  router.get('/api/auth/providers', async (req: Request, res: Response) => {
    try {
      if (hasDatabase()) {
        const result = await dbQuery('SELECT provider, config FROM auth_providers WHERE enabled = true ORDER BY provider').catch((error) => {
          logger.error('Auth providers query failed; falling back to empty list:', error);
          return { rows: [] as any[] } as any;
        });
        return res.json({
          success: true,
          providers: result.rows.map((r: any) => ({
            provider: r.provider as string,
            clientId: ((r.config || {}) as Record<string, string>).clientId || '',
          })),
        });
      }
      return res.json({ success: true, providers: [] });
    } catch (error) {
      logger.error('Get auth providers error:', error);
      return res.json({ success: true, providers: [] });
    }
  });

  // POST /api/auth/facebook/token — verify FB JS SDK access token, sign in / register user
  router.post('/api/auth/facebook/token', async (req: Request, res: Response) => {
    try {
      const { accessToken } = req.body as { accessToken?: string };
      if (!accessToken) return res.status(400).json({ success: false, error: 'Access token required' });

      // Verify token and fetch profile via Graph API
      const graphRes = await axios.get<{ id: string; name?: string; email?: string }>(
        'https://graph.facebook.com/me',
        { params: { fields: 'id,name,email', access_token: accessToken } },
      );
      const { id: fbId, name: fbName, email: fbEmail } = graphRes.data;
      if (!fbId) return res.status(401).json({ success: false, error: 'Could not verify Facebook token' });

      const result = await loginIdentity('facebook',fbId,fbEmail || '',fbName || 'Facebook user',false);
      return res.json({ success: true,...result });

    } catch (error) {
      logger.error('Facebook token auth error:', error);
      return res.status(401).json({ success: false, error: 'Facebook authentication failed' });
    }
  });

  // GET /api/admin/auth-providers — admin: returns all providers with full config
  router.get('/api/admin/auth-providers', async (req: Request, res: Response) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      if (hasDatabase()) {
        const result = await dbQuery('SELECT provider, config, enabled, updated_at FROM auth_providers ORDER BY provider');
        // Secrets go out masked; a mask sent back on save keeps the stored value.
        return res.json({ success: true, providers: result.rows.map(row => ({ ...row, config: maskPlatformConfigSecrets(decryptPlatformConfig(row.config)) })) });
      }
      return res.json({ success: true, providers: [] });
    } catch (error) {
      logger.error('Get admin auth providers error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch auth providers' });
    }
  });

  // PUT /api/admin/auth-providers/:provider — save/update provider config + enabled toggle
  router.put('/api/admin/auth-providers/:provider', async (req: Request, res: Response) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      const { provider } = req.params as { provider: string };
      const { config, enabled } = req.body as { config: Record<string, string>; enabled: boolean };
      if (!provider) return res.status(400).json({ success: false, error: 'Provider required' });
      if (hasDatabase()) {
        const existing = await dbQuery('SELECT config FROM auth_providers WHERE provider = $1', [provider]).catch(() => ({ rows: [] as any[] }));
        const merged = mergeMaskedSecrets(existing.rows[0] ? decryptPlatformConfig((existing.rows[0] as any).config) : {}, config ?? {});
        await dbQuery(
          `INSERT INTO auth_providers (provider, config, enabled, updated_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (provider) DO UPDATE
             SET config = EXCLUDED.config, enabled = EXCLUDED.enabled, updated_at = NOW()`,
          [provider, JSON.stringify(encryptPlatformConfig(merged)), Boolean(enabled)],
        );
        return res.json({ success: true });
      }
      return res.json({ success: true });
    } catch (error) {
      logger.error('Save auth provider error:', error);
      return res.status(500).json({ success: false, error: 'Failed to save auth provider' });
    }
  });

  return router;
}
