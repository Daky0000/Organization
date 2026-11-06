import bcrypt from 'bcryptjs';
import { createHmac, randomBytes } from 'crypto';
import { randomUUID } from 'crypto';
import type { Response } from 'express';
import type { Request } from '../types/http.ts';
import { Router } from 'express';
import { Resend } from 'resend';
import { z } from 'zod';
import { logger } from '../logger.ts';
import { authLimiter, passwordLimiter } from '../middleware/rateLimiter.ts';
import { validateBody } from '../middleware/validate.ts';

// ─── Local schemas ────────────────────────────────────────────────────────────

const authRegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(72, { message: 'Password must be at most 72 characters (bcrypt limitation)' }),
  name: z.string().min(1).max(100),
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_-]+$/),
});

const authLoginSchema = z
  .object({
    identifier: z.string().optional(),
    email: z.string().email().optional(),
    password: z.string().min(1),
  })
  .refine((v) => Boolean((v.identifier || '').trim() || (v.email || '').trim()), {
    message: 'Username or email is required',
    path: ['identifier'],
  });

const authProfileSchema = z.object({
  name: z.string().min(1).max(100),
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_-]+$/),
  email: z.string().email(),
  phone: z.string().optional(),
  country: z.string().optional(),
  website: z.string().optional(),
  avatar: z.string().url().optional(),
  cover: z.string().url().optional(),
});

// ─── Deps ─────────────────────────────────────────────────────────────────────

export interface AuthDeps {
  requireAuth: (req: Request, res: Response) => { userId: string; role: string; tokenVersion: number | null } | null;
  hasDatabase: () => boolean;
  dbQuery: <T = any>(sql: string, params?: any[]) => Promise<{ rows: T[]; rowCount?: number | null }>;
  getUserById: (id: string) => Promise<any>;
  findUserByEmail: (email: string) => Promise<any>;
  findUserByUsername: (username: string) => Promise<any>;
  findUserByIdentifier: (identifier: string) => Promise<any>;
  createUser: (name: string, username: string, email: string, password: string) => Promise<any>;
  updateUserProfile: (userId: string, data: any) => Promise<any>;
  updateLastLogin: (userId: string) => Promise<void>;
  getUserPlanName: (userId: string) => Promise<string>;
  /** The plan with where it came from, so the client can say "included with your DakyX retainer". */
  getEffectivePlan?: (userId: string) => Promise<{ name: string; source: 'local' | 'dakyx' }>;
  signToken: (userId: string, email: string, tokenVersion?: number) => string;
  userToAuthPayload: (user: any, planName?: string, planSource?: 'local' | 'dakyx') => any;
  checkTokenVersion: (auth: { userId: string; tokenVersion: number | null }, res: Response) => Promise<boolean>;
  provisionUserAgents: (userId: string) => Promise<void>;
  createNotification: (userId: string, type: string, title: string, body: string, meta: any) => Promise<void>;
  getResendConfig: () => Promise<{ apiKey: string; fromEmail: string; fromName: string }>;
  jwtSecret: string;
  appUrl: string;
  syncProfileMedia: (user: any) => Promise<number>;
}

// ─── Local email helpers ───────────────────────────────────────────────────────

async function sendPasswordResetEmail(
  email: string,
  resetUrl: string,
  getResendConfig: AuthDeps['getResendConfig'],
): Promise<void> {
  const { apiKey, fromEmail, fromName } = await getResendConfig();
  if (!apiKey) {
    logger.warn('Resend not configured — password reset email not sent');
    return;
  }
  const resend = new Resend(apiKey);
  const { error: sendError } = await resend.emails.send({
    from: fromName ? `${fromName} <${fromEmail}>` : fromEmail,
    to: email,
    subject: 'Reset your password',
    html: `
      <p>You requested a password reset. Click the link below to set a new password. This link expires in 1 hour.</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>
      <p>If you did not request this, you can safely ignore this email.</p>
    `,
  });
  if (sendError) throw new Error(sendError.message);
}

async function sendEmailVerification(
  userId: string,
  email: string,
  jwtSecret: string,
  appUrl: string,
  hasDatabase: () => boolean,
  dbQuery: AuthDeps['dbQuery'],
  getResendConfig: AuthDeps['getResendConfig'],
): Promise<void> {
  if (!hasDatabase()) return;
  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = createHmac('sha256', jwtSecret).update(rawToken).digest('hex');
  await dbQuery(
    `INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at)
     VALUES ($1, $2, $3, NOW() + INTERVAL '24 hours')
     ON CONFLICT DO NOTHING`,
    [randomUUID(), userId, tokenHash]
  );
  const { apiKey, fromEmail, fromName } = await getResendConfig();
  if (!apiKey) return;
  const verifyUrl = `${appUrl.replace(/\/$/, '')}/verify-email#token=${rawToken}`;
  const resend = new Resend(apiKey);
  const { error: sendError } = await resend.emails.send({
    from: fromName ? `${fromName} <${fromEmail}>` : fromEmail,
    to: email,
    subject: 'Verify your email address',
    html: `
      <p>Thanks for signing up! Please verify your email address by clicking the link below. This link expires in 24 hours.</p>
      <p><a href="${verifyUrl}">${verifyUrl}</a></p>
    `,
  });
  if (sendError) throw new Error(sendError.message);
}

// ─── Router ───────────────────────────────────────────────────────────────────

export function registerAuthRoutes(deps: AuthDeps): Router {
  const {
    requireAuth, hasDatabase, dbQuery,
    getUserById, findUserByEmail, findUserByUsername, findUserByIdentifier,
    createUser, updateUserProfile, updateLastLogin,
    getUserPlanName, getEffectivePlan, signToken, userToAuthPayload, checkTokenVersion,
    provisionUserAgents, createNotification, getResendConfig,
    jwtSecret, appUrl, syncProfileMedia,
  } = deps;

  const router = Router();

  router.post('/auth/register', authLimiter, validateBody(authRegisterSchema), async (req: Request, res: Response) => {
    try {
      const { email, password, name, username } = req.body;
      if (!email || !password || !name || !username) {
        return res.status(400).json({ success: false, error: 'Name, username, email, and password are required' });
      }

      const existing = await findUserByEmail(email);
      if (existing) return res.status(400).json({ success: false, error: 'Account already exists' });

      const existingUsername = await findUserByUsername(username);
      if (existingUsername) return res.status(400).json({ success: false, error: 'Username is already in use' });

      const user = await createUser(name, username, email, password);
      provisionUserAgents(user.id).catch(() => undefined);
      createNotification(user.id, 'welcome',
        'Welcome to Dakyworld Hub!',
        'Your account is ready. Connect a social account and start chatting with Daky.',
        {},
      ).catch(() => undefined);
      sendEmailVerification(user.id, user.email, jwtSecret, appUrl, hasDatabase, dbQuery, getResendConfig).catch(() => undefined);
      const token = signToken(user.id, user.email, user.token_version ?? 1);
      return res.json({ success: true, token, user: userToAuthPayload(user) });
    } catch (error) {
      logger.error({ error, errorId: (req as any).id }, 'auth_register_failed');
      return res.status(500).json({ success: false, error: 'Registration failed' });
    }
  });

  router.post('/auth/login', authLimiter, validateBody(authLoginSchema), async (req: Request, res: Response) => {
    try {
      const { identifier, email, password } = req.body;
      const loginIdentifier = (identifier || email || '').trim();
      if (!loginIdentifier || !password) {
        return res.status(400).json({ success: false, error: 'Username or email and password are required' });
      }

      const user = await findUserByIdentifier(loginIdentifier);
      if (!user || user.status !== 'active') return res.status(400).json({ success: false, error: 'Invalid credentials' });

      if (user.locked_until && new Date(user.locked_until) > new Date()) {
        const minutesLeft = Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60000);
        return res.status(429).json({
          success: false,
          error: `Account temporarily locked due to too many failed attempts. Try again in ${minutesLeft} minute${minutesLeft === 1 ? '' : 's'}.`,
        });
      }

      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        if (hasDatabase()) {
          const newAttempts = (user.failed_login_attempts || 0) + 1;
          const lockUntil = newAttempts >= 5 ? new Date(Date.now() + 30 * 60 * 1000) : null;
          await dbQuery('UPDATE users SET failed_login_attempts = $1, locked_until = $2 WHERE id = $3', [newAttempts, lockUntil, user.id]);
          if (lockUntil) logger.warn({ userId: user.id, ip: req.ip }, 'auth:account_locked');
        }
        return res.status(400).json({ success: false, error: 'Invalid credentials' });
      }

      if (hasDatabase()) {
        await dbQuery('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1', [user.id]);
      }
      await updateLastLogin(user.id);
      logger.info({ userId: user.id, ip: req.ip, ua: req.headers['user-agent'] }, 'auth:login');
      const refreshedUser = (await getUserById(user.id)) || user;
      const token = signToken(user.id, user.email, refreshedUser.token_version ?? 1);
      return res.json({ success: true, token, user: userToAuthPayload(refreshedUser) });
    } catch (error) {
      logger.error({ error, errorId: (req as any).id }, 'auth_login_failed');
      return res.status(500).json({ success: false, error: 'Login failed' });
    }
  });

  router.get('/auth/me', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      const user = await getUserById(auth.userId);
      if (!user) return res.status(404).json({ success: false, error: 'User not found' });
      const plan = getEffectivePlan ? await getEffectivePlan(auth.userId) : { name: await getUserPlanName(auth.userId), source: 'local' as const };
      return res.json({ success: true, user: userToAuthPayload(user, plan.name, plan.source) });
    } catch (error) {
      logger.error('Me error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch user' });
    }
  });

  router.put('/auth/profile', validateBody(authProfileSchema), async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      const { name, username, email, phone, country, website, avatar, cover } = req.body;
      if (!name || !username || !email) {
        return res.status(400).json({ success: false, error: 'Name, username, and email are required' });
      }
      const updated = await updateUserProfile(auth.userId, {
        name: String(name), username: String(username), email: String(email),
        phone: String(phone || ''), country: String(country || ''), website: String(website || ''),
        avatar: typeof avatar === 'string' ? avatar : undefined,
        cover: typeof cover === 'string' ? cover : undefined,
      });
      if (!updated) return res.status(404).json({ success: false, error: 'User not found' });
      await syncProfileMedia({ id: updated.id, avatar_url: updated.avatar_url, cover_url: updated.cover_url })
        .catch((error: any) => { logger.error('Profile media sync error:', error); });
      return res.json({ success: true, user: userToAuthPayload(updated) });
    } catch (error) {
      logger.error({ error, errorId: (req as any).id }, 'auth_profile_update_failed');
      const message = error instanceof Error ? error.message : 'Failed to update profile';
      const statusCode = message.includes('already in use') ? 400 : 500;
      return res.status(statusCode).json({ success: false, error: message });
    }
  });

  router.post('/auth/change-password', passwordLimiter, async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    const { currentPassword, newPassword } = req.body as Record<string, string>;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, error: 'currentPassword and newPassword are required' });
    }
    if (newPassword.length < 8) return res.status(400).json({ success: false, error: 'New password must be at least 8 characters' });
    if (newPassword.length > 72) return res.status(400).json({ success: false, error: 'New password must be at most 72 characters (bcrypt limitation)' });
    try {
      const { rows } = await dbQuery<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [auth.userId]);
      if (!rows[0]) return res.status(404).json({ success: false, error: 'User not found' });
      const valid = await bcrypt.compare(currentPassword, rows[0].password_hash);
      if (!valid) return res.status(400).json({ success: false, error: 'Current password is incorrect' });
      const newHash = await bcrypt.hash(newPassword, 12);
      await dbQuery('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, auth.userId]);
      return res.json({ success: true });
    } catch (e) {
      logger.error({ e }, 'change_password_failed');
      return res.status(500).json({ success: false, error: 'Failed to change password' });
    }
  });

  router.post('/auth/forgot-password', authLimiter, async (req: Request, res: Response) => {
    const SAFE_RESPONSE = { success: true, message: 'If that email exists, a reset link has been sent.' };
    const MIN_RESPONSE_MS = 600;
    const t0 = Date.now();
    const safeReturn = async () => {
      const elapsed = Date.now() - t0;
      if (elapsed < MIN_RESPONSE_MS) await new Promise(r => setTimeout(r, MIN_RESPONSE_MS - elapsed));
      return res.json(SAFE_RESPONSE);
    };
    try {
      const email = String(req.body.email || '').trim().toLowerCase();
      if (!email || !email.includes('@')) return safeReturn();
      if (!hasDatabase()) return safeReturn();
      const user = await findUserByEmail(email);
      if (!user) return safeReturn();
      await dbQuery(`UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL`, [user.id]);
      const rawToken = randomBytes(32).toString('hex');
      const tokenHash = createHmac('sha256', jwtSecret).update(rawToken).digest('hex');
      await dbQuery(
        `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, NOW() + INTERVAL '1 hour')`,
        [randomUUID(), user.id, tokenHash]
      );
      const resetUrl = `${appUrl.replace(/\/$/, '')}/reset-password#token=${rawToken}`;
      await sendPasswordResetEmail(user.email, resetUrl, getResendConfig);
      logger.info({ userId: user.id }, 'password_reset_requested');
      return safeReturn();
    } catch (error) {
      logger.error({ error }, 'forgot_password_failed');
      return safeReturn();
    }
  });

  router.post('/auth/reset-password', authLimiter, async (req: Request, res: Response) => {
    try {
      const token = String(req.body.token || '').trim();
      const newPassword = String(req.body.newPassword || '');
      if (!token || !newPassword) return res.status(400).json({ success: false, error: 'Token and newPassword are required' });
      if (newPassword.length < 8) return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
      if (newPassword.length > 72) return res.status(400).json({ success: false, error: 'Password must be at most 72 characters (bcrypt limitation)' });
      if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Service unavailable' });

      const tokenHash = createHmac('sha256', jwtSecret).update(token).digest('hex');
      const { rows } = await dbQuery<{ id: string; user_id: string; expires_at: string; used_at: string | null }>(
        `SELECT id, user_id, expires_at, used_at FROM password_reset_tokens WHERE token_hash = $1`,
        [tokenHash]
      );
      const record = rows[0];
      if (!record || record.used_at || new Date(record.expires_at) < new Date()) {
        return res.status(400).json({ success: false, error: 'Invalid or expired reset link' });
      }
      const newHash = await bcrypt.hash(newPassword, 12);
      await dbQuery(`UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1`, [record.id]);
      await dbQuery(
        `UPDATE users SET password_hash = $1, token_version = COALESCE(token_version, 1) + 1 WHERE id = $2`,
        [newHash, record.user_id]
      );
      logger.info({ userId: record.user_id }, 'password_reset_completed');
      return res.json({ success: true, message: 'Password has been reset. Please log in with your new password.' });
    } catch (error) {
      logger.error({ error }, 'reset_password_failed');
      return res.status(500).json({ success: false, error: 'Failed to reset password' });
    }
  });

  router.post('/auth/verify-email', async (req: Request, res: Response) => {
    try {
      const token = String(req.body.token || '').trim();
      if (!token) return res.status(400).json({ success: false, error: 'Token is required' });
      if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Service unavailable' });
      const tokenHash = createHmac('sha256', jwtSecret).update(token).digest('hex');
      const { rows } = await dbQuery<{ id: string; user_id: string; expires_at: string; used_at: string | null }>(
        `SELECT id, user_id, expires_at, used_at FROM email_verification_tokens WHERE token_hash = $1`,
        [tokenHash]
      );
      const record = rows[0];
      if (!record || record.used_at || new Date(record.expires_at) < new Date()) {
        return res.status(400).json({ success: false, error: 'Invalid or expired verification link' });
      }
      await dbQuery(`UPDATE email_verification_tokens SET used_at = NOW() WHERE id = $1`, [record.id]);
      await dbQuery(`UPDATE users SET email_verified = true WHERE id = $1`, [record.user_id]);
      logger.info({ userId: record.user_id }, 'email_verified');
      return res.json({ success: true, message: 'Email verified successfully.' });
    } catch (error) {
      logger.error({ error }, 'verify_email_failed');
      return res.status(500).json({ success: false, error: 'Failed to verify email' });
    }
  });

  router.post('/auth/resend-verification', authLimiter, async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Service unavailable' });
      const user = await getUserById(auth.userId);
      if (!user) return res.status(404).json({ success: false, error: 'User not found' });
      if (user.email_verified) return res.json({ success: true, message: 'Email already verified' });
      await sendEmailVerification(user.id, user.email, jwtSecret, appUrl, hasDatabase, dbQuery, getResendConfig);
      return res.json({ success: true, message: 'Verification email sent' });
    } catch (error) {
      logger.error({ error }, 'resend_verification_failed');
      return res.status(500).json({ success: false, error: 'Failed to resend verification email' });
    }
  });

  router.post('/auth/logout-all-devices', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!(await checkTokenVersion(auth, res))) return;
      if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Service unavailable' });
      await dbQuery(`UPDATE users SET token_version = COALESCE(token_version, 1) + 1 WHERE id = $1`, [auth.userId]);
      logger.info({ userId: auth.userId }, 'logout_all_devices');
      return res.json({ success: true, message: 'All sessions have been invalidated' });
    } catch (error) {
      logger.error({ error }, 'logout_all_devices_failed');
      return res.status(500).json({ success: false, error: 'Failed to invalidate sessions' });
    }
  });

  return router;
}
