import express from 'express';
import type { Router, Response } from 'express';
import type { Request } from '../types/http.ts';
import axios from 'axios';
import { randomUUID } from 'crypto';
import { logger } from '../logger.ts';

type AuthResult = { userId: string; role?: string } | null;

interface HubtelDeps {
  requireAuth: (req: Request, res: Response) => AuthResult;
  requireAdmin: (req: Request, res: Response) => Promise<AuthResult>;
  hasDatabase: () => boolean;
  dbQuery: <T = any>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  getPlatformConfig: (platform: string) => Promise<Record<string, string>>;
}

// Hubtel messaging endpoints (per developers.hubtel.com — Messaging → SMS/OTP).
// Overridable via env in case Hubtel moves them.
const HUBTEL_SMS_ENDPOINT = process.env.HUBTEL_SMS_ENDPOINT || 'https://sms.hubtel.com/v1/messages/send';
const HUBTEL_OTP_BASE = process.env.HUBTEL_OTP_BASE || 'https://api-otp.hubtel.com/otp';

// Hubtel expects international format without '+' (e.g. 233241234567).
// Accepts local Ghana formats (024..., 24...) and passes through other
// country codes untouched.
function normalizeMsisdn(raw: string): string | null {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('233') && digits.length === 12) return digits;
  if (digits.startsWith('0') && digits.length === 10) return `233${digits.slice(1)}`;
  if (digits.length === 9) return `233${digits}`;
  return digits.length >= 11 && digits.length <= 15 ? digits : null;
}

export function registerHubtelRoutes({ requireAuth, requireAdmin, hasDatabase, dbQuery, getPlatformConfig }: HubtelDeps): Router {
  const router = express.Router();

  async function getHubtelConfig(): Promise<{ clientId: string; clientSecret: string; merchantAccountNumber: string; senderId: string } | null> {
    const cfg = await getPlatformConfig('hubtel');
    const clientId = cfg.clientId || process.env.HUBTEL_CLIENT_ID || '';
    const clientSecret = cfg.clientSecret || process.env.HUBTEL_CLIENT_SECRET || '';
    const merchantAccountNumber = cfg.merchantAccountNumber || process.env.HUBTEL_MERCHANT_ACCOUNT_NUMBER || '';
    const senderId = cfg.senderId || process.env.HUBTEL_SMS_SENDER_ID || '';
    if (!clientId || !clientSecret) return null;
    return { clientId, clientSecret, merchantAccountNumber, senderId };
  }

  // Sends one SMS and records the attempt in sms_logs regardless of outcome,
  // so Admin → Payments → Messaging shows failures with the provider's reason.
  async function sendHubtelSms(params: {
    to: string; content: string; userId: string | null; context: string;
  }): Promise<{ ok: boolean; status: number; data: any; error?: string }> {
    const hubtel = await getHubtelConfig();
    if (!hubtel) return { ok: false, status: 503, data: null, error: 'Hubtel is not configured. Add credentials in Admin > Payments.' };
    if (!hubtel.senderId) return { ok: false, status: 400, data: null, error: 'No SMS Sender ID configured. Add your approved Hubtel sender ID in Admin > Payments.' };
    const to = normalizeMsisdn(params.to);
    if (!to) return { ok: false, status: 400, data: null, error: `Invalid recipient phone number: ${params.to}` };
    const content = String(params.content || '').trim();
    if (!content) return { ok: false, status: 400, data: null, error: 'Message content is required' };

    let status = 0;
    let data: any = null;
    let error: string | undefined;
    try {
      const r = await axios.post(
        HUBTEL_SMS_ENDPOINT,
        { From: hubtel.senderId, To: to, Content: content },
        {
          auth: { username: hubtel.clientId, password: hubtel.clientSecret },
          headers: { 'Content-Type': 'application/json' },
          validateStatus: () => true,
          timeout: 20000,
        }
      );
      status = r.status;
      data = r.data;
      if (status >= 400) error = data?.message || data?.Message || `Hubtel SMS returned HTTP ${status}`;
    } catch (err: any) {
      status = err?.response?.status || 500;
      data = err?.response?.data ?? null;
      error = err?.message || 'SMS request failed';
    }

    const ok = !error;
    if (hasDatabase()) {
      await dbQuery(
        `INSERT INTO sms_logs (id, user_id, recipient, sender_id, content, context, status, provider_message_id, provider_response)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
        [
          randomUUID(), params.userId, to, hubtel.senderId, content, params.context,
          ok ? 'sent' : 'failed',
          data?.messageId || data?.MessageId || null,
          JSON.stringify(ok ? data : { error, response: data }),
        ]
      ).catch((e) => logger.error('sms_logs insert failed:', e));
    }
    return { ok, status, data, error };
  }

  // POST /api/payments/hubtel/initiate
  router.post('/payments/hubtel/initiate', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;

      const { amount, description, customerName, customerEmail, customerMsisdn } = req.body as {
        amount: number; description: string; customerName: string; customerEmail: string; customerMsisdn: string;
      };

      if (!amount || !customerName || !customerMsisdn) {
        return res.status(400).json({ success: false, error: 'amount, customerName, and customerMsisdn are required' });
      }

      const hubtel = await getHubtelConfig();
      if (!hubtel) {
        return res.status(503).json({ success: false, error: 'Hubtel is not configured. Add credentials in Admin > Payments.' });
      }

      const clientReference = randomUUID();
      const backendUrl = process.env.BACKEND_PUBLIC_URL || `https://contentflow-api.onrender.com`;

      const payload = {
        totalAmount: Number(amount),
        description: description || 'Payment',
        callbackUrl: `${backendUrl}/api/payments/hubtel/callback`,
        returnUrl: `${process.env.FRONTEND_ORIGIN || 'https://marketing.dakyx.com'}/payments/success`,
        cancellationUrl: `${process.env.FRONTEND_ORIGIN || 'https://marketing.dakyx.com'}/payments/cancel`,
        merchantAccountNumber: hubtel.merchantAccountNumber,
        clientReference,
      };

      const response = await axios.post('https://payproxyapi.hubtel.com/items/initiate', payload, {
        auth: { username: hubtel.clientId, password: hubtel.clientSecret },
        headers: { 'Content-Type': 'application/json' },
      });

      const checkoutUrl: string = response.data?.data?.checkoutUrl || response.data?.checkoutUrl || '';
      const txnId = randomUUID();

      if (hasDatabase()) {
        await dbQuery(
          `INSERT INTO payment_transactions
             (id, amount, currency, description, status, provider, client_reference, customer_name, customer_email, customer_phone, checkout_url, metadata)
           VALUES ($1,$2,'GHS',$3,'pending','hubtel',$4,$5,$6,$7,$8,$9)`,
          [txnId, Number(amount), description || null, clientReference, customerName, customerEmail || null, customerMsisdn, checkoutUrl, JSON.stringify(response.data || null)]
        );
      } else {
        logger.warn('Payment transaction could not be persisted — no database available');
      }

      return res.json({ success: true, checkoutUrl, clientReference });
    } catch (error: any) {
      logger.error('Hubtel initiate error:', error?.response?.data || error);
      return res.status(502).json({ success: false, error: error?.response?.data?.message || 'Failed to initiate payment' });
    }
  });

  // POST /api/payments/hubtel/callback
  router.post('/payments/hubtel/callback', async (req: Request, res: Response) => {
    try {
      const body = req.body as any;
      const clientReference: string = body?.Data?.ClientReference || body?.clientReference || '';
      const status: string = (body?.Data?.Status || body?.status || 'failed').toLowerCase();
      const providerRef: string = body?.Data?.TransactionId || body?.transactionId || '';
      const mappedStatus = status === 'successful' || status === 'success' ? 'successful' : status === 'pending' ? 'pending' : 'failed';

      if (clientReference && hasDatabase()) {
        await dbQuery(
          `UPDATE payment_transactions SET status = $1, provider_reference = $2, updated_at = NOW(), metadata = metadata || $3::jsonb
           WHERE client_reference = $4`,
          [mappedStatus, providerRef, JSON.stringify({ hubtelCallback: body }), clientReference]
        );
      } else if (clientReference) {
        logger.warn('Hubtel callback: no database available to update transaction', { clientReference });
      }

      return res.json({ success: true });
    } catch (error) {
      logger.error('Hubtel callback error:', error);
      return res.status(500).json({ success: false, error: 'Callback processing failed' });
    }
  });

  // GET /api/payments/hubtel/verify/:clientReference
  router.get('/payments/hubtel/verify/:clientReference', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;

      const { clientReference } = req.params;
      const hubtel = await getHubtelConfig();

      if (hubtel) {
        try {
          const response = await axios.get(
            `https://api.hubtel.com/checkout/v1.1/merchant/transactions/status?clientReference=${clientReference}`,
            { auth: { username: hubtel.clientId, password: hubtel.clientSecret } }
          );
          const remoteStatus = (response.data?.data?.status || '').toLowerCase();
          const mappedStatus = remoteStatus === 'successful' || remoteStatus === 'success' ? 'successful' : remoteStatus === 'pending' ? 'pending' : 'failed';

          if (hasDatabase()) {
            await dbQuery(`UPDATE payment_transactions SET status = $1, updated_at = NOW() WHERE client_reference = $2`, [mappedStatus, clientReference]);
          }
          return res.json({ success: true, status: mappedStatus, data: response.data });
        } catch (_err) {
          // fall through to DB lookup
        }
      }

      if (hasDatabase()) {
        const result = await dbQuery('SELECT status FROM payment_transactions WHERE client_reference = $1', [clientReference]);
        if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Transaction not found' });
        return res.json({ success: true, status: result.rows[0].status });
      }

      return res.status(503).json({ success: false, error: 'Database unavailable' });
    } catch (error) {
      logger.error('Verify payment error:', error);
      return res.status(500).json({ success: false, error: 'Failed to verify payment' });
    }
  });

  // ── Messaging: SMS ───────────────────────────────────────────────────────────

  // POST /api/admin/hubtel/sms/test — send a test SMS to confirm credentials + sender ID
  router.post('/admin/hubtel/sms/test', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    const { to, content } = req.body as { to?: string; content?: string };
    if (!to?.trim()) return res.status(400).json({ success: false, error: 'Recipient phone number (to) is required' });
    const result = await sendHubtelSms({
      to,
      content: content?.trim() || 'Test message from your ContentFlow admin console.',
      userId: (admin as any).userId ?? (admin as any).id ?? null,
      context: 'admin-test',
    });
    if (!result.ok) return res.status(result.status >= 500 ? 502 : result.status).json({ success: false, error: result.error, provider: result.data });
    return res.json({ success: true, provider: result.data });
  });

  // GET /api/admin/hubtel/sms/logs — recent SMS activity
  router.get('/admin/hubtel/sms/logs', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!hasDatabase()) return res.json({ success: true, logs: [] });
    try {
      const { rows } = await dbQuery(
        `SELECT s.id, s.recipient, s.sender_id, s.content, s.context, s.status,
                s.provider_message_id, s.provider_response, s.created_at, u.email AS user_email
         FROM sms_logs s LEFT JOIN users u ON u.id = s.user_id
         ORDER BY s.created_at DESC LIMIT 100`
      );
      return res.json({ success: true, logs: rows });
    } catch (error) {
      logger.error('List sms logs error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch SMS logs' });
    }
  });

  // ── Messaging: OTP (phone verification) ──────────────────────────────────────

  // POST /api/hubtel/otp/send — send an OTP to a phone number
  router.post('/hubtel/otp/send', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    const { phoneNumber } = req.body as { phoneNumber?: string };
    const phone = normalizeMsisdn(phoneNumber || '');
    if (!phone) return res.status(400).json({ success: false, error: 'A valid phone number is required' });

    const hubtel = await getHubtelConfig();
    if (!hubtel) return res.status(503).json({ success: false, error: 'Hubtel is not configured. Add credentials in Admin > Payments.' });
    if (!hubtel.senderId) return res.status(503).json({ success: false, error: 'No SMS Sender ID configured in Admin > Payments.' });

    // At most 3 OTP sends per user per 10 minutes
    const { rows: recent } = await dbQuery<{ n: string }>(
      `SELECT COUNT(*) AS n FROM otp_requests WHERE user_id=$1 AND created_at >= NOW() - INTERVAL '10 minutes'`,
      [auth.userId]
    ).catch(() => ({ rows: [{ n: '0' }] }));
    if (Number(recent[0]?.n || 0) >= 3) {
      return res.status(429).json({ success: false, error: 'Too many OTP requests. Try again in a few minutes.' });
    }

    try {
      const r = await axios.post(
        `${HUBTEL_OTP_BASE}/send`,
        { senderId: hubtel.senderId, phoneNumber: phone, countryCode: 'GH' },
        {
          auth: { username: hubtel.clientId, password: hubtel.clientSecret },
          headers: { 'Content-Type': 'application/json' },
          validateStatus: () => true,
          timeout: 20000,
        }
      );
      const requestId = r.data?.data?.requestId || r.data?.requestId || '';
      const prefix = r.data?.data?.prefix || r.data?.prefix || '';
      if (r.status >= 400 || !requestId) {
        logger.error({ status: r.status, data: r.data }, 'hubtel_otp_send_failed');
        return res.status(502).json({ success: false, error: r.data?.message || `OTP send failed (HTTP ${r.status})`, provider: r.data });
      }
      await dbQuery(
        `INSERT INTO otp_requests (id, user_id, phone, request_id, prefix, status) VALUES ($1,$2,$3,$4,$5,'sent')`,
        [randomUUID(), auth.userId, phone, requestId, prefix]
      );
      // The code itself never touches our servers — user relays it from SMS
      return res.json({ success: true, requestId, prefix });
    } catch (error: any) {
      logger.error('Hubtel OTP send error:', error?.response?.data || error);
      return res.status(502).json({ success: false, error: 'Failed to send OTP' });
    }
  });

  // POST /api/hubtel/otp/verify — verify the code the user received
  router.post('/hubtel/otp/verify', async (req: Request, res: Response) => {
    const auth = requireAuth(req, res);
    if (!auth) return;
    if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });
    const { requestId, prefix, code } = req.body as { requestId?: string; prefix?: string; code?: string };
    if (!requestId?.trim() || !code?.trim()) {
      return res.status(400).json({ success: false, error: 'requestId and code are required' });
    }

    // Only the user who initiated the request may verify it
    const { rows: reqRows } = await dbQuery<{ id: string; phone: string; prefix: string | null }>(
      `SELECT id, phone, prefix FROM otp_requests WHERE request_id=$1 AND user_id=$2 AND status='sent'
       AND created_at >= NOW() - INTERVAL '15 minutes' ORDER BY created_at DESC LIMIT 1`,
      [requestId.trim(), auth.userId]
    );
    const otpRow = reqRows[0];
    if (!otpRow) return res.status(404).json({ success: false, error: 'OTP request not found or expired. Request a new code.' });

    const hubtel = await getHubtelConfig();
    if (!hubtel) return res.status(503).json({ success: false, error: 'Hubtel is not configured' });

    try {
      const r = await axios.post(
        `${HUBTEL_OTP_BASE}/verify`,
        { requestId: requestId.trim(), prefix: (prefix || otpRow.prefix || '').trim(), code: code.trim() },
        {
          auth: { username: hubtel.clientId, password: hubtel.clientSecret },
          headers: { 'Content-Type': 'application/json' },
          validateStatus: () => true,
          timeout: 20000,
        }
      );
      const verified = r.status < 400 && (r.data?.code === '0000' || r.data?.data?.verified === true || r.data?.verified === true);
      if (!verified) {
        return res.status(400).json({ success: false, error: r.data?.message || 'Invalid or expired code', provider: r.data });
      }
      await dbQuery(`UPDATE otp_requests SET status='verified', verified_at=NOW() WHERE id=$1`, [otpRow.id]);
      await dbQuery(`UPDATE users SET phone=$2, phone_verified=TRUE WHERE id=$1`, [auth.userId, otpRow.phone]).catch(() => undefined);
      return res.json({ success: true, phone: otpRow.phone });
    } catch (error: any) {
      logger.error('Hubtel OTP verify error:', error?.response?.data || error);
      return res.status(502).json({ success: false, error: 'Failed to verify OTP' });
    }
  });

  // GET /api/admin/payments
  router.get('/admin/payments', async (req: Request, res: Response) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;

      if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });

      const result = await dbQuery(
        `SELECT id, amount, currency, description, status, provider, client_reference, provider_reference,
                customer_name, customer_email, customer_phone, created_at, updated_at
         FROM payment_transactions ORDER BY created_at DESC LIMIT 200`
      );
      return res.json({ success: true, transactions: result.rows });
    } catch (error) {
      logger.error('List payments error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch transactions' });
    }
  });

  // GET /api/admin/payments/stats
  router.get('/admin/payments/stats', async (req: Request, res: Response) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;

      if (!hasDatabase()) return res.status(503).json({ success: false, error: 'Database unavailable' });

      const result = await dbQuery(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'successful')::int AS successful,
          COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
          COALESCE(SUM(amount) FILTER (WHERE status = 'successful'), 0)::numeric AS revenue
        FROM payment_transactions
      `);
      return res.json({ success: true, stats: result.rows[0] });
    } catch (error) {
      logger.error('Payment stats error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch payment stats' });
    }
  });

  return router;
}
