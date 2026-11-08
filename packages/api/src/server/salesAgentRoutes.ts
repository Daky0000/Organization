// ─────────────────────────────────────────────────────────────────────────────
// Admin → Sales Voice Agent.
//
// One voice agent for the whole organisation: identity, opening line, company
// knowledge, objection handling, and the provider / voice / model it runs on.
// Stored in platform_configs under 'sales_agent'; anything never saved falls
// back to the Africon defaults in sales/orgAgent.ts. The Vapi phone number is
// written into the 'vapi' integration config, next to the keys, because that is
// where the provider reads it.
// ─────────────────────────────────────────────────────────────────────────────

import { randomBytes } from 'crypto';
import express from 'express';
import type { Response, Router } from 'express';
import type { Request } from '../types/http.ts';
import type { Pool } from 'pg';
import { logger } from '../logger.ts';
import { recordAuditLog } from '../link-metadata.ts';
import { decryptPlatformConfig, encryptPlatformConfig } from '../integration-helpers.ts';
import {
  AFRICON_DEFAULT_AGENT, SALES_AGENT_PLATFORM, buildInboundSystemPrompt, fillTemplate, resolveOrgAgent,
} from './sales/orgAgent.ts';
import type { SalesEngine } from './sales/salesEngine.ts';
import { getLiveEventsText } from './sales/eventContext.ts';

interface Deps {
  requireAdmin: (req: Request, res: Response) => Promise<any>;
  hasDatabase: () => boolean;
  pool: Pool | null;
  salesEngine: SalesEngine;
}

const EDITABLE = Object.keys(AFRICON_DEFAULT_AGENT) as (keyof typeof AFRICON_DEFAULT_AGENT)[];

export type InboundSyncResult = { ok: boolean; skipped?: string; error?: string; assistantId?: string };

export function registerSalesAgentRoutes({ requireAdmin, hasDatabase, pool, salesEngine }: Deps): Router {
  const router = express.Router();
  const { readRow, writeRow, syncInbound } = buildInboundSync(pool, salesEngine);
  type SyncResult = InboundSyncResult;

  async function view(sync?: SyncResult) {
    const [stored, vapi] = await Promise.all([readRow(SALES_AGENT_PLATFORM), readRow('vapi')]);
    return {
      success: true,
      config: resolveOrgAgent(stored),
      defaults: AFRICON_DEFAULT_AGENT,
      customised: Object.keys(stored).length > 0,
      vapi: {
        hasPrivateKey: Boolean(vapi.apiKey || vapi.privateKey || process.env.VAPI_API_KEY),
        hasPublicKey: Boolean(vapi.publicKey || process.env.VAPI_PUBLIC_KEY),
        hasWebhookSecret: Boolean(vapi.webhookSecret || process.env.VAPI_WEBHOOK_SECRET),
        phoneNumberId: vapi.phoneNumberId || process.env.VAPI_PHONE_NUMBER_ID || null,
        inboundAssistantId: vapi.inboundAssistantId || null,
      },
      ...(sync ? { sync } : {}),
    };
  }

  router.get('/admin/sales-agent', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    try {
      return res.json(await view());
    } catch (err: any) {
      logger.error({ err }, 'sales_agent_config_get_failed');
      return res.status(500).json({ success: false, error: 'Failed to load the voice agent settings' });
    }
  });

  // Each field is optional and replaces only itself.
  router.put('/admin/sales-agent', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!hasDatabase() || !pool) return res.status(503).json({ success: false, error: 'Database unavailable' });
    const b = (req.body ?? {}) as Record<string, unknown>;
    try {
      const stored = await readRow(SALES_AGENT_PLATFORM);
      const next: Record<string, string> = { ...stored };
      for (const key of EDITABLE) {
        const v = b[key];
        if (v === undefined || v === null) continue;
        next[key] = typeof v === 'object' ? JSON.stringify(v) : String(v);
      }
      // Validate through the resolver, then store exactly what it accepts.
      const resolved = resolveOrgAgent(next);
      const clean: Record<string, string> = {};
      for (const key of EDITABLE) {
        if (!(key in next)) continue;
        const v = resolved[key];
        clean[key] = typeof v === 'object' ? JSON.stringify(v) : String(v);
      }
      await writeRow(SALES_AGENT_PLATFORM, clean);

      if (typeof b.phoneNumberId === 'string') {
        const vapi = await readRow('vapi');
        const id = b.phoneNumberId.trim();
        if (id) vapi.phoneNumberId = id;
        else delete vapi.phoneNumberId;
        await writeRow('vapi', vapi);
      }

      void recordAuditLog((admin as any).id, 'admin_sales_agent_updated', [], { fields: Object.keys(b) });
      return res.json(await view(await syncInbound()));
    } catch (err: any) {
      logger.error({ err }, 'sales_agent_config_save_failed');
      return res.status(500).json({ success: false, error: err?.message || 'Save failed' });
    }
  });

  // Forget every saved field: the agent goes back to the Africon defaults.
  router.post('/admin/sales-agent/reset', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!hasDatabase() || !pool) return res.status(503).json({ success: false, error: 'Database unavailable' });
    try {
      await pool.query(`DELETE FROM platform_configs WHERE platform=$1`, [SALES_AGENT_PLATFORM]);
      void recordAuditLog((admin as any).id, 'admin_sales_agent_reset', [], {});
      return res.json(await view(await syncInbound()));
    } catch (err: any) {
      logger.error({ err }, 'sales_agent_config_reset_failed');
      return res.status(500).json({ success: false, error: 'Reset failed' });
    }
  });

  // Replace the webhook secret (e.g. after it may have been exposed) and push
  // the new one to the Vapi assistant straight away.
  router.post('/admin/sales-agent/rotate-secret', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!hasDatabase() || !pool) return res.status(503).json({ success: false, error: 'Database unavailable' });
    try {
      const vapi = await readRow('vapi');
      await writeRow('vapi', { ...vapi, webhookSecret: randomBytes(24).toString('hex') });
      void recordAuditLog((admin as any).id, 'admin_vapi_webhook_secret_rotated', [], {});
      return res.json(await view(await syncInbound()));
    } catch (err: any) {
      logger.error({ err }, 'sales_agent_rotate_secret_failed');
      return res.status(500).json({ success: false, error: 'Could not rotate the secret' });
    }
  });

  router.post('/admin/sales-agent/sync-vapi', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    if (!hasDatabase() || !pool) return res.status(503).json({ success: false, error: 'Database unavailable' });
    return res.json(await view(await syncInbound()));
  });

  // Uses the stored private key to list the account's phone numbers, so the
  // admin picks one instead of pasting a UUID.
  router.get('/admin/sales-agent/vapi', async (req: Request, res: Response) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;
    try {
      return res.json({ success: true, status: await salesEngine.getVapiStatus() });
    } catch (err: any) {
      logger.error({ err }, 'sales_agent_vapi_check_failed');
      return res.status(502).json({ success: false, error: 'Could not check Vapi' });
    }
  });

  return router;
}

/**
 * The Vapi inbound assistant: the org agent plus the live events, pushed to
 * the assistant that answers the phone number. Used after an agent save and
 * after an events sync that changed something.
 */
export function buildInboundSync(pool: Pool | null, salesEngine: SalesEngine) {
  async function readRow(platform: string): Promise<Record<string, any>> {
    if (!pool) return {};
    const { rows } = await pool.query(`SELECT config FROM platform_configs WHERE platform=$1 LIMIT 1`, [platform]);
    return decryptPlatformConfig(rows[0]?.config) ?? {};
  }

  async function writeRow(platform: string, config: Record<string, any>) {
    await pool!.query(
      `INSERT INTO platform_configs (platform, config, enabled, updated_at) VALUES ($1, $2, true, NOW())
       ON CONFLICT (platform) DO UPDATE SET config=$2, updated_at=NOW()`,
      [platform, JSON.stringify(encryptPlatformConfig(config))],
    );
  }

  /**
   * Push the agent to Vapi as the assistant that answers the phone number, so
   * calling the number reaches it. Runs after every save; never throws.
   */
  async function syncInbound(): Promise<InboundSyncResult> {
    try {
      const [agent, stored, liveEvents] = await Promise.all([
        salesEngine.getOrgAgent(), readRow('vapi'), pool ? getLiveEventsText(pool).catch(() => '') : Promise.resolve(''),
      ]);
      let vapi = stored;
      const phoneNumberId = vapi.phoneNumberId || process.env.VAPI_PHONE_NUMBER_ID || '';
      if (!(vapi.apiKey || vapi.privateKey || process.env.VAPI_API_KEY)) return { ok: false, skipped: 'No Vapi private key yet' };
      if (!phoneNumberId) return { ok: false, skipped: 'No phone number chosen yet' };
      // Vapi never issues a webhook secret — it is whatever we send. Make one
      // so call reports are verified without anyone pasting a secret around.
      if (!vapi.webhookSecret && !process.env.VAPI_WEBHOOK_SECRET) {
        vapi = { ...vapi, webhookSecret: randomBytes(24).toString('hex') };
        await writeRow('vapi', vapi);
      }
      const provider = await salesEngine.buildVapiProvider(agent);
      const assistant = provider.buildAssistant({
        firstMessage: fillTemplate(agent.inboundFirstMessage, agent),
        systemPrompt: buildInboundSystemPrompt(agent, liveEvents),
        voiceId: agent.voiceId || null,
        maxDurationSec: agent.maxCallDurationSec,
        recordingEnabled: true,
      });
      const { assistantId } = await provider.syncInboundAssistant({
        assistantId: vapi.inboundAssistantId || null,
        assistant,
        phoneNumberId,
      });
      if (assistantId !== vapi.inboundAssistantId) await writeRow('vapi', { ...vapi, inboundAssistantId: assistantId });
      return { ok: true, assistantId };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Vapi sync failed' };
    }
  }

  return { readRow, writeRow, syncInbound };
}
