import axios from 'axios';
import type { Pool } from 'pg';
import { callAINonStreaming, getAIConfig, resolveActiveKey, resolveTextKey, FAST_MODEL } from '../../ai-helpers.ts';
import { decryptPlatformConfig } from '../../integration-helpers.ts';
import { logger } from '../../logger.ts';
import type { VisualProviderAdapterInput } from './workflowOrchestrator.ts';
import { openaiImageSizeForAspect } from '../openaiRoutes.ts';
import { getMagnificApiKey, magnificGenerateImage, magnificGenerateVideo } from '../magnificRoutes.ts';
import { generateTastefulImage } from '../imageTaste.ts';
import { callMagnificMcpTool } from '../mcpRoutes.ts';
import { dbQuery } from '../../db.ts';
import { resolveSelectableModel, ModelUnavailableError, listSelectableModels } from './creativeBriefAndRouter.ts';
import type { VisualGenerationResult, ProviderUsage } from './assetPipeline.ts';

export interface ProviderBridgeDeps {
  pool?: Pool | Pick<Pool, 'query'> | null;
  hasDatabase?: () => boolean;
  appUrl?: string;
  http?: { post: typeof axios.post; get: typeof axios.get };
}

export interface ProviderHealth {
  configured: boolean;
  health: 'healthy' | 'unhealthy' | 'not_checked';
  checked_at: string | null;
  detail: string | null;
}

export interface AutopilotProviderStatus {
  openai: boolean;
  magnific: boolean;
  freepik: boolean;
  llm: boolean;
  /** live_provider when at least one image provider has a credential; sandbox_demo only when explicitly enabled. */
  executionMode: 'live_provider' | 'sandbox_demo' | 'not_configured';
  sandboxEnabled: boolean;
}

export function isSandboxModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AUTOPILOT_SANDBOX_MODE === 'true';
}

export async function getAutopilotProviderStatus(pool?: Pool | Pick<Pool, 'query'> | null): Promise<AutopilotProviderStatus> {
  let hasOpenAI = Boolean(process.env.OPENAI_API_KEY);
  let hasMagnific = Boolean(process.env.MAGNIFIC_API_KEY);
  let hasFreepik = Boolean(process.env.FREEPIK_API_KEY);
  let hasLLM = Boolean(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY);

  try {
    if (pool) {
      const cfgs = await pool.query<{ platform: string; config: Record<string, string> }>(
        `SELECT platform, config FROM platform_configs WHERE platform IN ('openai', 'magnific', 'freepik', 'ai')`,
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

  const sandboxEnabled = isSandboxModeEnabled();
  const anyImageProvider = hasOpenAI || hasMagnific;
  return {
    openai: hasOpenAI,
    magnific: hasMagnific,
    freepik: hasFreepik,
    llm: hasLLM,
    executionMode: anyImageProvider ? 'live_provider' : sandboxEnabled ? 'sandbox_demo' : 'not_configured',
    sandboxEnabled,
  };
}

/** Providers that hold a credential, as the set the router filters on. */
export async function getConfiguredVisualProviders(pool?: Pool | Pick<Pool, 'query'> | null): Promise<Set<string>> {
  const s = await getAutopilotProviderStatus(pool);
  const out = new Set<string>();
  if (s.openai) out.add('openai');
  if (s.magnific) out.add('magnific');
  return out;
}

async function resolveOpenAIKey(pool?: Pool | Pick<Pool, 'query'> | null): Promise<string | null> {
  try {
    if (pool) {
      const r = await pool.query<{ config: Record<string, string> }>('SELECT config FROM platform_configs WHERE platform=$1', ['openai']);
      const dbKey = decryptPlatformConfig(r.rows[0]?.config)?.api_key;
      if (dbKey) return dbKey;
    }
  } catch {
    /* fall through */
  }
  return process.env.OPENAI_API_KEY || null;
}

const healthCache = new Map<string, ProviderHealth>();
const HEALTH_TTL_MS = 10 * 60 * 1000;

/**
 * A credential being present is not proof a model works. This asks OpenAI
 * whether each selectable OpenAI model is retrievable with the configured key
 * (GET /v1/models/{id}, no generation, no charge). Magnific has no documented
 * no-cost check, so it is reported as not_checked.
 */
export async function checkProviderHealth(deps: ProviderBridgeDeps, force = false): Promise<Record<string, ProviderHealth>> {
  const status = await getAutopilotProviderStatus(deps.pool);
  const http = deps.http ?? axios;
  const out: Record<string, ProviderHealth> = {};
  const openaiModels = listSelectableModels().filter((m) => m.provider === 'openai' && m.selectable && m.output_type === 'image');
  for (const m of openaiModels) {
    const key = `openai:${m.model}`;
    const cached = healthCache.get(key);
    if (!force && cached?.checked_at && Date.now() - Date.parse(cached.checked_at) < HEALTH_TTL_MS) {
      out[key] = cached;
      continue;
    }
    if (!status.openai) {
      out[key] = { configured: false, health: 'not_checked', checked_at: null, detail: 'No OpenAI credential configured' };
      continue;
    }
    const apiKey = await resolveOpenAIKey(deps.pool);
    let entry: ProviderHealth;
    try {
      const res = await http.get(`https://api.openai.com/v1/models/${encodeURIComponent(m.model)}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        timeout: 10_000,
        validateStatus: () => true,
      });
      entry = res.status === 200
        ? { configured: true, health: 'healthy', checked_at: new Date().toISOString(), detail: null }
        : { configured: true, health: 'unhealthy', checked_at: new Date().toISOString(), detail: `HTTP ${res.status} from /v1/models/${m.model}` };
    } catch (err: any) {
      entry = { configured: true, health: 'unhealthy', checked_at: new Date().toISOString(), detail: err?.code || 'network error' };
    }
    healthCache.set(key, entry);
    out[key] = entry;
  }
  out['magnific'] = {
    configured: status.magnific,
    health: 'not_checked',
    checked_at: null,
    detail: status.magnific ? 'No documented no-cost health endpoint; verify with a staging generation' : 'No Magnific credential configured',
  };
  return out;
}

function failure(
  code: Extract<VisualGenerationResult, { ok: false }>['code'],
  safeMessage: string,
  billing: Extract<VisualGenerationResult, { ok: false }>['billing'],
  retryable: boolean,
  providerRequestId?: string,
): VisualGenerationResult {
  return { ok: false, code, safeMessage, billing, retryable, providerRequestId };
}

/** Classifies an axios failure from a synchronous provider call. */
export function classifyProviderHttpError(err: any): Extract<VisualGenerationResult, { ok: false }> {
  const status = Number(err?.response?.status || 0);
  const requestId = err?.response?.headers?.['x-request-id'] ? String(err.response.headers['x-request-id']) : undefined;
  const code = String(err?.code || '');
  if (!status) {
    // Never left this machine: nothing to reconcile.
    if (['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN', 'ERR_INVALID_URL'].includes(code)) {
      return failure('PROVIDER_TIMEOUT', 'Could not reach the image provider.', 'not_submitted', true) as any;
    }
    // Sent, then the connection dropped or timed out: the image may exist and be billed.
    return failure('PROVIDER_TIMEOUT', 'The image provider did not answer in time; the outcome is unknown and will be reconciled.', 'unknown_outcome', false, requestId) as any;
  }
  if (status === 401 || status === 403) {
    return failure('PROVIDER_AUTH_FAILED', 'The image provider rejected the configured credential. Check the API key and organization access.', 'definitive_failure', false, requestId) as any;
  }
  if (status === 404) {
    return failure('MODEL_UNAVAILABLE', 'The image provider does not serve this model for the configured key.', 'definitive_failure', false, requestId) as any;
  }
  if (status === 429) {
    return failure('PROVIDER_RATE_LIMITED', 'The image provider is rate-limiting requests.', 'definitive_failure', true, requestId) as any;
  }
  if (status === 504) {
    return failure('PROVIDER_TIMEOUT', 'The image provider timed out upstream; the outcome is unknown and will be reconciled.', 'unknown_outcome', false, requestId) as any;
  }
  if (status >= 500) {
    return failure('PROVIDER_REJECTED', `The image provider failed (HTTP ${status}).`, 'definitive_failure', true, requestId) as any;
  }
  return failure('PROVIDER_REJECTED', `The image provider rejected the request (HTTP ${status}).`, 'definitive_failure', false, requestId) as any;
}

const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

export function decodeStrictBase64(b64: unknown): Buffer | null {
  if (typeof b64 !== 'string') return null;
  const clean = b64.replace(/\s+/g, '');
  if (!clean || clean.length % 4 !== 0 || !BASE64_RE.test(clean)) return null;
  const buf = Buffer.from(clean, 'base64');
  return buf.length ? buf : null;
}

export function buildAutopilotVisualAdapter(deps: ProviderBridgeDeps) {
  const http = deps.http ?? axios;
  return async function visualAdapter(input: VisualProviderAdapterInput): Promise<VisualGenerationResult> {
    let entry;
    try {
      entry = resolveSelectableModel(input.modelId || `${input.provider}:${input.model}`);
    } catch (err) {
      if (err instanceof ModelUnavailableError) return failure('MODEL_UNAVAILABLE', err.message, 'not_submitted', false);
      throw err;
    }

    if (entry.adapter === 'openai_images') {
      const apiKey = await resolveOpenAIKey(deps.pool);
      if (!apiKey) return failure('PROVIDER_NOT_CONFIGURED', 'OpenAI is not configured (Admin → AI Assistant → OpenAI).', 'not_submitted', false);
      const outputFormat = input.outputFormat ?? 'jpeg';
      let res;
      try {
        res = await http.post(
          'https://api.openai.com/v1/images/generations',
          {
            model: entry.model,
            prompt: input.prompt.slice(0, 4000),
            n: 1,
            size: openaiImageSizeForAspect(input.aspectRatio || '1:1'),
            quality: input.quality ?? 'medium',
            output_format: outputFormat,
            ...(outputFormat === 'jpeg' ? { output_compression: 90 } : {}),
          },
          {
            // The Images API documents no idempotency key, so duplicate protection
            // lives in the accounting state machine: an unknown outcome is never resubmitted blindly.
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: 120_000,
          },
        );
      } catch (err: any) {
        logger.warn({ status: err?.response?.status, code: err?.code, model: entry.model }, 'autopilot_openai_image_failed');
        return classifyProviderHttpError(err);
      }
      const requestId = res.headers?.['x-request-id'] ? String(res.headers['x-request-id']) : undefined;
      const bytes = decodeStrictBase64(res.data?.data?.[0]?.b64_json);
      const usage: ProviderUsage | undefined = res.data?.usage && typeof res.data.usage === 'object' ? res.data.usage : undefined;
      if (!bytes) {
        return {
          ok: false,
          code: 'INVALID_PROVIDER_RESPONSE',
          safeMessage: 'The image provider returned no decodable image.',
          // The provider answered 200, so the call was processed (and likely billed).
          billing: 'definitive_failure',
          retryable: false,
          providerRequestId: requestId,
        };
      }
      return {
        ok: true,
        provider: 'openai',
        model: entry.model,
        mediaType: 'image',
        providerRequestId: requestId,
        bytes,
        mimeType: outputFormat === 'png' ? 'image/png' : outputFormat === 'webp' ? 'image/webp' : 'image/jpeg',
        usage,
      };
    }

    if (entry.adapter === 'magnific_image_task' || entry.adapter === 'magnific_video_task') {
      const apiKey = await getMagnificApiKey((deps.pool as any) || null).catch(() => '');
      if (!apiKey) return failure('PROVIDER_NOT_CONFIGURED', 'Magnific is not configured.', 'not_submitted', false);
      const isVideo = entry.adapter === 'magnific_video_task';
      // Magnific One with the user's Brand Kit, example styles and saved items (their taught style).
      if (!isVideo && entry.model === 'magnific-one' && input.useTaste && input.userId) {
        const mcp = (tool: string, args: Record<string, unknown>) => callMagnificMcpTool((deps.pool as any) || null, tool, args, (val: unknown) => {
          const dec = decryptPlatformConfig(val as any);
          return typeof dec === 'string' ? dec : (dec as any)?.value ?? '';
        });
        const taught = await generateTastefulImage({
          query: (sql, p) => dbQuery(sql, p as any[]), userId: input.userId, mcp, prompt: input.prompt, aspectRatio: input.aspectRatio || '1:1', mode: 'quality', channel: 'social',
        }).catch(() => null);
        if (taught) {
          return { ok: true, provider: 'magnific', model: entry.model, mediaType: 'image', sourceUrl: taught.url, mimeType: 'application/octet-stream' };
        }
      }
      let out: { url: string | null; taskId: string | null; error: string | null };
      try {
        out = isVideo
          ? await magnificGenerateVideo(
              {
                model: entry.model,
                prompt: input.prompt.slice(0, 2500),
                aspect_ratio: input.aspectRatio || '9:16',
                exclude_music: true,
                reference_images: input.referenceUrls?.length ? input.referenceUrls.slice(0, entry.max_references) : undefined,
              } as any,
              apiKey,
            )
          : await magnificGenerateImage(entry.model, input.prompt.slice(0, 2000), input.aspectRatio || '1:1', apiKey, undefined, {
              reference_images: input.referenceUrls?.length ? input.referenceUrls.slice(0, entry.max_references) : undefined,
            });
      } catch (err: any) {
        return classifyProviderHttpError(err);
      }
      const taskId = out.taskId ?? undefined;
      if (out.url) {
        return {
          ok: true,
          provider: 'magnific',
          model: entry.model,
          mediaType: isVideo ? 'video' : 'image',
          providerRequestId: taskId,
          sourceUrl: out.url,
          mimeType: 'application/octet-stream',
        };
      }
      const msg = String(out.error || 'Magnific generation failed');
      if (!taskId) {
        const authFail = /HTTP (401|403)/.test(msg);
        return failure(authFail ? 'PROVIDER_AUTH_FAILED' : 'PROVIDER_REJECTED', authFail ? 'Magnific rejected the configured credential.' : 'Magnific did not accept the task.', authFail ? 'definitive_failure' : 'definitive_failure', /HTTP (429|5\d\d)/.test(msg));
      }
      if (/^Timeout/i.test(msg)) {
        // The task exists; reconciliation polls it by ID instead of resubmitting.
        return failure('PROVIDER_TIMEOUT', 'Magnific task is still running; it will be reconciled by task ID.', 'unknown_outcome', false, taskId);
      }
      return failure('PROVIDER_REJECTED', 'Magnific reported the task as failed.', 'definitive_failure', false, taskId);
    }

    return failure('MODEL_UNAVAILABLE', `No provider adapter for ${entry.id}.`, 'not_submitted', false);
  };
}

export function buildAutopilotCopyAdapter(_deps?: ProviderBridgeDeps) {
  return async function copyAdapter(userPrompt: string, systemPrompt?: string): Promise<string> {
    try {
      const aiCfg = await getAIConfig().catch(() => ({
        provider: 'anthropic' as const,
        model: FAST_MODEL,
        encryptedKey: null,
        googleEncryptedKey: null,
        systemPrompt: null,
      }));
      // Free models first (NVIDIA), the paid key as the fallback — not paid-only.
      const apiKey = resolveTextKey(aiCfg as any) || resolveActiveKey(aiCfg);
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
        { userId: null, feature: 'autopilot_copy' },
      );
      return result || '';
    } catch (err: any) {
      logger.warn({ err: err?.message }, 'autopilot_copy_llm_failed_falling_back');
      return '';
    }
  };
}
