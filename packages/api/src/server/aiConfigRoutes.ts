import type { Response } from 'express';
import type { Request } from '../types/http.ts';
import { Router } from 'express';
import { logger } from '../logger.ts';
import { recordAuditLog } from '../link-metadata.ts';
import { AI_SYSTEM_PROMPT_DEFAULT } from './aiChatRoutes.ts';

const AI_CONFIG_PLATFORM = 'ai_assistant';

export interface AIConfigDeps {
  requireAdmin: (req: Request, res: Response) => Promise<any>;
  hasDatabase: () => boolean;
  dbQuery: <T = any>(sql: string, params?: any[]) => Promise<{ rows: T[]; rowCount?: number | null }>;
  getAIConfig: () => Promise<{
    model: string;
    provider: 'anthropic' | 'google';
    encryptedKey: string | null;
    googleEncryptedKey: string | null;
    systemPrompt: string | null;
  }>;
  encryptIntegrationSecret: (plain: string) => string;
  decryptAIKey: (encryptedKey: string) => string;
  resolveActiveKey: (config: { provider: 'anthropic' | 'google'; encryptedKey: string | null; googleEncryptedKey: string | null }) => string;
  callAINonStreaming: typeof import('../ai-helpers.ts').callAINonStreaming;
  inMemoryPlatformConfigs: Map<string, any>;
}

function maskKey(raw: string): string {
  if (!raw || raw.length < 8) return '••••';
  return '••••' + raw.slice(-4);
}

export function registerAIConfigRoutes(deps: AIConfigDeps): Router {
  const {
    requireAdmin, hasDatabase, dbQuery,
    getAIConfig, encryptIntegrationSecret, decryptAIKey,
    resolveActiveKey, callAINonStreaming, inMemoryPlatformConfigs,
  } = deps;

  const router = Router();

  // GET /api/admin/ai-usage — token spend by day, feature, model, and top users
  router.get('/admin/ai-usage', async (req: Request, res: Response) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      if (!hasDatabase()) return res.json({ success: true, byDay: [], byFeature: [], topUsers: [] });
      const days = Math.min(90, Math.max(1, Number(req.query.days) || 30));
      const [totals, byDay, byFeature, topUsers] = await Promise.all([
        dbQuery(
          `SELECT COUNT(*) AS calls, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
                  SUM(cache_read_tokens) AS cache_read_tokens,
                  COALESCE(SUM(cost_usd), 0) AS cost_usd, COALESCE(SUM(credits_charged), 0) AS credits_charged
           FROM ai_usage_log WHERE created_at > NOW() - ($1 || ' days')::interval`,
          [days]
        ).catch(() => ({ rows: [{}] })),
        dbQuery(
          `SELECT DATE(created_at) AS day, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
                  SUM(cache_read_tokens) AS cache_read_tokens, COUNT(*) AS calls,
                  COALESCE(SUM(cost_usd), 0) AS cost_usd, COALESCE(SUM(credits_charged), 0) AS credits_charged
           FROM ai_usage_log WHERE created_at > NOW() - ($1 || ' days')::interval
           GROUP BY DATE(created_at) ORDER BY day`,
          [days]
        ).catch(() => ({ rows: [] })),
        dbQuery(
          `SELECT feature, model, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, COUNT(*) AS calls,
                  COALESCE(SUM(cost_usd), 0) AS cost_usd, COALESCE(SUM(credits_charged), 0) AS credits_charged
           FROM ai_usage_log WHERE created_at > NOW() - ($1 || ' days')::interval
           GROUP BY feature, model ORDER BY SUM(cost_usd) DESC LIMIT 30`,
          [days]
        ).catch(() => ({ rows: [] })),
        dbQuery(
          `SELECT l.user_id, u.email, SUM(l.input_tokens) AS input_tokens, SUM(l.output_tokens) AS output_tokens, COUNT(*) AS calls,
                  COALESCE(SUM(l.cost_usd), 0) AS cost_usd, COALESCE(SUM(l.credits_charged), 0) AS credits_charged
           FROM ai_usage_log l LEFT JOIN users u ON u.id = l.user_id
           WHERE l.created_at > NOW() - ($1 || ' days')::interval
           GROUP BY l.user_id, u.email ORDER BY SUM(l.cost_usd) DESC LIMIT 20`,
          [days]
        ).catch(() => ({ rows: [] })),
      ]);
      const t: any = totals.rows[0] ?? {};
      const costUsd = Number(t.cost_usd ?? 0);
      const creditsCharged = Number(t.credits_charged ?? 0);
      // Retail value of charged credits ($0.01/credit) minus raw provider cost
      const revenueUsd = creditsCharged * 0.01;
      return res.json({
        success: true, days,
        totals: {
          calls: Number(t.calls ?? 0),
          input_tokens: Number(t.input_tokens ?? 0),
          output_tokens: Number(t.output_tokens ?? 0),
          cache_read_tokens: Number(t.cache_read_tokens ?? 0),
          cost_usd: costUsd,
          credits_charged: creditsCharged,
          credit_value_usd: revenueUsd,
          gross_margin_usd: revenueUsd - costUsd,
        },
        byDay: byDay.rows, byFeature: byFeature.rows, topUsers: topUsers.rows,
      });
    } catch (err) {
      logger.error('AI usage GET error:', err);
      return res.status(500).json({ success: false, error: 'Failed to load AI usage' });
    }
  });

  router.get('/admin/ai-config', async (req: Request, res: Response) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      const { model, provider, encryptedKey, googleEncryptedKey, systemPrompt } = await getAIConfig();
      const rawAnthropicKey = encryptedKey ? decryptAIKey(encryptedKey) : (process.env.ANTHROPIC_API_KEY || '');
      const rawGoogleKey = googleEncryptedKey ? decryptAIKey(googleEncryptedKey) : (process.env.GOOGLE_AI_API_KEY || '');
      const activeKey = provider === 'google' ? rawGoogleKey : rawAnthropicKey;
      return res.json({
        success: true,
        config: {
          model, provider,
          apiKeyMasked: rawAnthropicKey ? maskKey(rawAnthropicKey) : '',
          googleApiKeyMasked: rawGoogleKey ? maskKey(rawGoogleKey) : '',
          enabled: Boolean(activeKey),
          systemPrompt: systemPrompt || null,
          defaultSystemPrompt: AI_SYSTEM_PROMPT_DEFAULT,
        },
      });
    } catch (err) {
      logger.error('AI config GET error:', err);
      return res.status(500).json({ success: false, error: 'Failed to fetch AI config' });
    }
  });

  router.put('/admin/ai-config', async (req: Request, res: Response) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      const { apiKey, googleApiKey, model, provider, systemPrompt } = req.body as {
        apiKey?: string; googleApiKey?: string; model?: string; provider?: string; systemPrompt?: string;
      };

      const existing = await getAIConfig();
      const newModel = String(model || existing.model).trim();
      const newProvider = (provider === 'google' || provider === 'anthropic') ? provider : existing.provider;

      let newEncryptedKey = existing.encryptedKey;
      if (apiKey && !String(apiKey).startsWith('••')) {
        newEncryptedKey = encryptIntegrationSecret(String(apiKey).trim());
      }

      let newGoogleEncryptedKey = existing.googleEncryptedKey;
      if (googleApiKey && !String(googleApiKey).startsWith('••')) {
        newGoogleEncryptedKey = encryptIntegrationSecret(String(googleApiKey).trim());
      }

      const finalSystemPrompt = 'systemPrompt' in req.body
        ? (systemPrompt ? String(systemPrompt).trim() : null)
        : existing.systemPrompt;

      const configObj: Record<string, any> = { model: newModel, provider: newProvider };
      if (newEncryptedKey) configObj.apiKeyEncrypted = newEncryptedKey;
      if (newGoogleEncryptedKey) configObj.googleApiKeyEncrypted = newGoogleEncryptedKey;
      if (finalSystemPrompt) configObj.systemPrompt = finalSystemPrompt;

      if (hasDatabase()) {
        const updateRes = await dbQuery(
          `UPDATE platform_configs SET config = $2, enabled = true, updated_at = NOW() WHERE platform = $1`,
          [AI_CONFIG_PLATFORM, JSON.stringify(configObj)]
        );
        if (updateRes.rowCount === 0) {
          await dbQuery(
            `INSERT INTO platform_configs (platform, config, enabled, updated_at) VALUES ($1, $2, true, NOW())`,
            [AI_CONFIG_PLATFORM, JSON.stringify(configObj)]
          );
        }
      } else {
        inMemoryPlatformConfigs.set(AI_CONFIG_PLATFORM, {
          platform: AI_CONFIG_PLATFORM,
          config: configObj,
          enabled: true,
          updated_at: new Date().toISOString(),
        });
      }

      void recordAuditLog((admin as any).id, 'admin_ai_config_updated', [], {
        model: newModel, provider: newProvider,
        anthropicKeyChanged: Boolean(apiKey && !String(apiKey).startsWith('\u2022\u2022')),
        googleKeyChanged: Boolean(googleApiKey && !String(googleApiKey).startsWith('\u2022\u2022')),
      });

      const rawAnthropicKey = newEncryptedKey ? decryptAIKey(newEncryptedKey) : (process.env.ANTHROPIC_API_KEY || '');
      const rawGoogleKey = newGoogleEncryptedKey ? decryptAIKey(newGoogleEncryptedKey) : (process.env.GOOGLE_AI_API_KEY || '');
      const activeKey = newProvider === 'google' ? rawGoogleKey : rawAnthropicKey;
      return res.json({
        success: true,
        config: {
          model: newModel, provider: newProvider,
          apiKeyMasked: rawAnthropicKey ? maskKey(rawAnthropicKey) : '',
          googleApiKeyMasked: rawGoogleKey ? maskKey(rawGoogleKey) : '',
          enabled: Boolean(activeKey),
          systemPrompt: finalSystemPrompt || null,
          defaultSystemPrompt: AI_SYSTEM_PROMPT_DEFAULT,
        },
      });
    } catch (err) {
      logger.error('AI config PUT error:', err);
      return res.status(500).json({ success: false, error: 'Failed to save AI config' });
    }
  });

  router.post('/admin/ai-config/test', async (req: Request, res: Response) => {
    try {
      const admin = await requireAdmin(req, res);
      if (!admin) return;
      const aiCfg = await getAIConfig();
      const rawKey = resolveActiveKey(aiCfg);
      if (!rawKey) return res.status(400).json({ success: false, message: 'No API key configured for the active provider' });
      await callAINonStreaming(aiCfg.provider, rawKey, aiCfg.model, 'You are a test assistant.', 'Reply with just: ok', 16);
      return res.json({ success: true, message: `Connected — ${aiCfg.provider === 'google' ? 'Google Gemini' : 'Anthropic'} model ${aiCfg.model} is responding` });
    } catch (err: any) {
      const msg = err?.message || 'Connection failed';
      return res.status(400).json({ success: false, message: msg });
    }
  });

  return router;
}
