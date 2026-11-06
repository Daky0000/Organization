import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import { logger } from '../logger.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Unified platform mailer.
//
// Two providers, switchable in Admin → Platform Settings:
//  - `smtp` platform config — the "default" hosting-provider mailbox
//    (cPanel/phpmail-style SMTP creds): host, port, user, pass, fromEmail,
//    fromName, secure ("true"/"false").
//  - Resend (`resend` platform config) — the connected third-party provider.
//
// Selection: the `email` platform config's `provider` key ('smtp' |
// 'resend'). Without it, whichever single provider is configured is used;
// with both configured, Resend wins (tracking webhooks only work there).
// ─────────────────────────────────────────────────────────────────────────────

interface MailerDeps {
  getPlatformConfig: (platform: string) => Promise<Record<string, string>>;
  getResendConfig: () => Promise<{ apiKey: string; fromEmail: string; fromName: string }>;
}

export interface SendMailInput {
  to: string;
  subject: string;
  html: string;
  fromName?: string;
  fromEmail?: string;
  headers?: Record<string, string>;
}

export interface SendMailResult {
  provider: 'resend' | 'smtp';
  id: string | null;
}

export function buildMailer({ getPlatformConfig, getResendConfig }: MailerDeps) {
  async function getSmtpConfig(): Promise<Record<string, string>> {
    return getPlatformConfig('smtp').catch(() => ({} as Record<string, string>));
  }

  async function resolveProvider(): Promise<'resend' | 'smtp'> {
    const emailCfg = await getPlatformConfig('email').catch(() => ({} as Record<string, string>));
    const preferred = String(emailCfg.provider || '').toLowerCase();
    if (preferred === 'smtp' || preferred === 'resend') return preferred;
    const [{ apiKey }, smtp] = await Promise.all([getResendConfig(), getSmtpConfig()]);
    if (apiKey) return 'resend';
    if (smtp.host) return 'smtp';
    return 'resend';
  }

  async function sendViaSmtp(input: SendMailInput): Promise<SendMailResult> {
    const cfg = await getSmtpConfig();
    if (!cfg.host) throw new Error('SMTP is not configured — set host/port/user/pass in Admin → Platform Settings (smtp)');
    const port = Number(cfg.port || 587);
    const transporter = nodemailer.createTransport({
      host: cfg.host,
      port,
      secure: cfg.secure === 'true' || port === 465,
      auth: cfg.user ? { user: cfg.user, pass: cfg.pass || '' } : undefined,
    });
    const fromEmail = input.fromEmail || cfg.fromEmail || cfg.user;
    const fromName = input.fromName || cfg.fromName || '';
    const info = await transporter.sendMail({
      from: fromName ? `"${fromName.replaceAll('"', '')}" <${fromEmail}>` : fromEmail,
      to: input.to,
      subject: input.subject,
      html: input.html,
      headers: input.headers,
    });
    return { provider: 'smtp', id: info.messageId ?? null };
  }

  async function sendViaResend(input: SendMailInput): Promise<SendMailResult> {
    const { apiKey, fromEmail, fromName } = await getResendConfig();
    if (!apiKey) throw new Error('Resend is not configured');
    const finalFromEmail = input.fromEmail || fromEmail;
    const finalFromName = input.fromName || fromName || '';
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from: finalFromName ? `${finalFromName} <${finalFromEmail}>` : finalFromEmail,
      to: input.to,
      subject: input.subject,
      html: input.html,
      headers: input.headers,
    });
    if (error) throw new Error(error.message);
    return { provider: 'resend', id: data?.id ?? null };
  }

  // Send using the selected provider; if it fails and the other provider is
  // configured, fall back so platform email keeps flowing.
  async function sendPlatformEmail(input: SendMailInput): Promise<SendMailResult> {
    const provider = await resolveProvider();
    try {
      return provider === 'smtp' ? await sendViaSmtp(input) : await sendViaResend(input);
    } catch (err) {
      logger.warn({ err, provider }, 'mailer_primary_failed_trying_fallback');
      try {
        return provider === 'smtp' ? await sendViaResend(input) : await sendViaSmtp(input);
      } catch {
        throw err; // report the primary provider's error
      }
    }
  }

  return { sendPlatformEmail, resolveProvider };
}

export type Mailer = ReturnType<typeof buildMailer>;
