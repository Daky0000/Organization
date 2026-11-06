import axios from 'axios';
import type { Pool } from 'pg';
import { callAINonStreaming, getAIConfig, resolveActiveKey, FAST_MODEL } from '../../ai-helpers.ts';
import { decryptPlatformConfig } from '../../integration-helpers.ts';
import { logger } from '../../logger.ts';
import type { VisualProviderAdapterInput, VisualProviderAdapterResult } from './workflowOrchestrator.ts';
import { OPENAI_IMAGE_MODELS } from '../openaiRoutes.ts';
import {
  getMagnificApiKey,
  getFreepikApiKey,
  magnificPost,
  pollMagnificTask,
  proxyHeaders,
  MAGNIFIC_BASE,
  FREEPIK_BASE,
  MAGNIFIC_IMAGE_MODELS,
  MAGNIFIC_VIDEO_MODELS,
  ASPECT_RATIO_MAP,
} from '../magnificRoutes.ts';

export interface ProviderBridgeDeps {
  pool?: Pool | Pick<Pool, 'query'> | null;
  hasDatabase?: () => boolean;
  appUrl?: string;
}

export interface AutopilotProviderStatus {
  openai: boolean;
  magnific: boolean;
  freepik: boolean;
  llm: boolean;
  executionMode: 'live_provider' | 'sandbox_fallback';
}

export async function getAutopilotProviderStatus(pool?: Pool | Pick<Pool, 'query'> | null): Promise<AutopilotProviderStatus> {
  let hasOpenAI = Boolean(process.env.OPENAI_API_KEY);
  let hasMagnific = Boolean(process.env.MAGNIFIC_API_KEY);
  let hasFreepik = Boolean(process.env.FREEPIK_API_KEY);
  let hasLLM = Boolean(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY);

  try {
    if (pool) {
    const cfgs = await pool.query<{ platform: string; config: Record<string, string> }>(

      `SELECT platform, config FROM platform_configs WHERE platform IN ('openai', 'magnific', 'freepik', 'ai')`
    );
    for (const row of cfgs.rows) {
      const dec = decryptPlatformConfig(row.config);
      if (row.platform === 'openai' && dec?.api_key) hasOpenAI = true;
      if (row.platform === 'magnific' && dec?.apiKey) hasMagnific = true;
      if (row.platform === 'freepik' && dec?.apiKey) hasFreepik = true;
      if (row.platform === 'ai' && (dec?.encryptedKey || dec?.googleEncryptedKey)) hasLLM = true;
    }
    }
  } catch {
    /* fallback to env vars */
  }

  const isLive = hasOpenAI || hasMagnific || hasFreepik || hasLLM;
  return {
    openai: hasOpenAI,
    magnific: hasMagnific,
    freepik: hasFreepik,
    llm: hasLLM,
    executionMode: isLive ? 'live_provider' : 'sandbox_fallback',
  };
}

async function resolveOpenAIKey(pool?: Pool | Pick<Pool, 'query'> | null): Promise<string | null> {
  try {
    if (pool) {
    const r = await pool.query<{ config: Record<string, string> }>(

      'SELECT config FROM platform_configs WHERE platform=$1',
      ['openai']
    );
    const dbKey = decryptPlatformConfig(r.rows[0]?.config)?.api_key;
    if (dbKey) return dbKey;
    }
  } catch {
    /* fall through */
  }
  return process.env.OPENAI_API_KEY || null;
}

export function buildAutopilotVisualAdapter(deps: ProviderBridgeDeps) {
  return async function visualAdapter(input: VisualProviderAdapterInput): Promise<VisualProviderAdapterResult> {
    const prov = (input.provider || '').toLowerCase();
    const model = (input.model || '').toLowerCase();

    // 1. OpenAI Images (gpt-image-1, gpt-image-1-mini)
    if (prov === 'openai' || model.startsWith('gpt-image')) {
      const apiKey = await resolveOpenAIKey(deps.pool);
      if (apiKey) {
        try {
          const aspect = input.aspectRatio || '1:1';
          const size = aspect === '16:9' ? '1536x1024' : aspect === '9:16' ? '1024x1536' : '1024x1024';
          const targetModel = model in OPENAI_IMAGE_MODELS ? model : 'gpt-image-1-mini';
          const rateCard = OPENAI_IMAGE_MODELS[targetModel] || { credits: 4, providerCostUsd: 0.015 };

          const res = await axios.post(
            'https://api.openai.com/v1/images/generations',
            {
              model: targetModel,
              prompt: input.prompt.slice(0, 4000),
              n: 1,
              size,
              response_format: 'b64_json',
            },
            {
              headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
              },
              timeout: 60000,
            }
          );

          const b64 = res.data?.data?.[0]?.b64_json;
          if (b64) {
            return {
              url: `data:image/png;base64,${b64}`,
              type: 'image',
              provider: 'openai',
              model: targetModel,
              actualProviderCostUsd: rateCard.providerCostUsd,
              actualCredits: rateCard.credits,
              provenanceNote: `Live OpenAI ${targetModel} generation`,
            };
          }
        } catch (err: any) {
          logger.warn({ err: err?.message, model }, 'openai_visual_generation_failed_falling_back');
        }
      }
    }

    // 2. Magnific / Freepik
    if (prov === 'magnific' || prov === 'freepik') {
      const apiKey = await getMagnificApiKey((deps.pool as any) || null);
      if (apiKey) {
        try {
          const isVideo = Boolean(MAGNIFIC_VIDEO_MODELS[model as keyof typeof MAGNIFIC_VIDEO_MODELS]);
          const endpoint = isVideo ? '/video/generate' : '/image/generate';
          const body: Record<string, any> = {
            prompt: input.prompt.slice(0, 3000),
            aspect_ratio: input.aspectRatio || '1:1',
          };
          if (model) body.model = model;
          if (input.referenceUrls?.length) {
            body.image_url = input.referenceUrls[0];
          }

          const resp = await magnificPost(endpoint, body, apiKey);
          const taskData = resp.data?.data ?? resp.data;
          const taskId = taskData?.task_id ?? taskData?.id;

          if (taskId) {
            const taskPath = `/tasks/${taskId}`;
            const poll = await pollMagnificTask(taskPath, apiKey, isVideo ? 180 : 90);
            if (poll.url) {
              const rateCard = (MAGNIFIC_IMAGE_MODELS as Record<string, any>)[model] ||
                (MAGNIFIC_VIDEO_MODELS as Record<string, any>)[model] ||
                { credits: 15, providerCostUsd: 0.08 };

              return {
                url: poll.url,
                type: isVideo ? 'video' : 'image',
                provider: prov,
                model,
                actualProviderCostUsd: rateCard.providerCostUsd ?? 0.08,
                actualCredits: rateCard.credits ?? 15,
                provenanceNote: `Live ${prov} ${model} generation (task ${taskId})`,
              };
            }
          }
        } catch (err: any) {
          logger.warn({ err: err?.message, prov, model }, 'magnific_visual_generation_failed_falling_back');
        }
      }
    }

    // 3. Transparent Fallback (Never record fake provider spend)
    return {
      url: '',
      type: model.includes('video') ? 'video' : 'image',
      provider: 'deterministic_fallback',
      model: 'svg_compositor_v2',
      actualProviderCostUsd: 0,
      actualCredits: 0,
      provenanceNote: 'Sandbox fallback: no external visual provider configured or provider call failed gracefully',
    };
  };
}

export function buildAutopilotCopyAdapter(deps?: ProviderBridgeDeps) {
  return async function copyAdapter(userPrompt: string, systemPrompt?: string): Promise<string> {
    try {
      const aiCfg = await getAIConfig().catch(() => ({
        provider: 'anthropic' as const,
        model: FAST_MODEL,
        encryptedKey: null,
        googleEncryptedKey: null,
        systemPrompt: null,
      }));
      const apiKey = resolveActiveKey(aiCfg);
      if (!apiKey) {
        return '';
      }
      const model = aiCfg.model || FAST_MODEL;
      const result = await callAINonStreaming(
        aiCfg.provider,
        apiKey,
        model,
        systemPrompt || 'You are an expert brand marketing copywriter.',
        userPrompt,
        1500,
        { userId: null, feature: 'autopilot_copy' }
      );
      return result || '';
    } catch (err: any) {
      logger.warn({ err: err?.message }, 'autopilot_copy_llm_failed_falling_back');
      return '';
    }
  };
}
