import express from 'express';
import { FAST_MODEL, recordAIUsage, hasAICredits, chargeAICredits } from '../ai-helpers.ts';
import type { Router, Response } from 'express';
import type { Request } from '../types/http.ts';
import { randomUUID } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../logger.ts';
import { decryptPlatformConfig } from '../integration-helpers.ts';
import {
  magnificOneGenerate,
  magnificGenerateImage,
  magnificGenerateVideo,
  magnificLipSync,
  magnificGenerateAudio,
  magnificExecuteSpaceOrFlow,
} from './magnificRoutes.ts';

type AuthResult = { userId: string; role?: string } | null;

interface AIConfig {
  model: string;
  provider: 'anthropic' | 'google';
  encryptedKey: string | null;
  googleEncryptedKey: string | null;
}

interface WorkflowDeps {
  requireAuth: (req: Request, res: Response) => AuthResult;
  hasDatabase: () => boolean;
  dbQuery: <T = any>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  enqueueSocialAutomationTask: (params: {
    userId: string;
    postId: string;
    platform: string;
    runAt: Date;
    payload: Record<string, any>;
    accountLabel: string;
  }) => Promise<void>;
  getAIConfig: () => Promise<AIConfig>;
  resolveActiveKey: (config: AIConfig) => string;
}

async function buildExecuteWorkflowOnce(deps: WorkflowDeps) {
  return deps; // just return deps so executeWorkflowOnce can close over them
}

export function buildWorkflowEngine(deps: WorkflowDeps): {
  fireWorkflowTriggers: (userId: string, eventType: string, triggerData: Record<string, any>) => Promise<void>;
  workflowRouter: Router;
} {
  const { requireAuth, hasDatabase, dbQuery, enqueueSocialAutomationTask, getAIConfig, resolveActiveKey } = deps;
  const router = express.Router();

  async function executeWorkflowOnce(
    userId: string,
    wf: { id: string; nodes: any[]; edges: any[] },
    triggerData: Record<string, any>
  ): Promise<{ run_id: string; status: string; logs: { step: string; message: string; ts: string }[] }> {
    const logs: { step: string; message: string; ts: string }[] = [];
    const addLog = (step: string, message: string) =>
      logs.push({ step, message, ts: new Date().toISOString() });

    const { rows: runRows } = await dbQuery(
      `INSERT INTO workflow_runs (workflow_id, user_id, trigger_data, logs) VALUES ($1, $2, $3, $4) RETURNING id`,
      [wf.id, userId, JSON.stringify(triggerData), JSON.stringify(logs)]
    );
    const runId = (runRows[0] as any).id;

    const nodes: any[] = wf.nodes ?? [];
    const edges: any[] = wf.edges ?? [];
    const findEdges = (sourceId: string, branch?: string) =>
      edges.filter((e: any) => e.sourceId === sourceId && (!branch || e.branch === branch));

    let finalStatus = 'completed';
    try {
      const triggerNode = nodes.find((n: any) => n.type === 'trigger');
      if (!triggerNode) throw new Error('No trigger node found');
      addLog(triggerNode.id, `Trigger fired: ${triggerNode.subType}`);

      const executeNode = async (nodeId: string): Promise<void> => {
        const node = nodes.find((n: any) => n.id === nodeId);
        if (!node || node.type === 'end') return;

        if (node.type === 'condition') {
          const cfg = node.config ?? {};
          let result = false;
          if (node.subType === 'has_image') result = !!(triggerData.featured_image ?? triggerData.image_url);
          else if (node.subType === 'no_image') result = !(triggerData.featured_image ?? triggerData.image_url);
          else if (node.subType === 'platform_is') result = triggerData.platform === cfg.platform;
          else if (node.subType === 'keyword_contains')
            result = (triggerData.content ?? triggerData.title ?? '').toLowerCase()
              .includes((cfg.keyword ?? '').toLowerCase());
          else if (node.subType === 'post_type_is') {
            const postType = triggerData.post_type
              ?? (triggerData.featured_image ? 'image' : triggerData.video_url ? 'video' : 'text');
            result = postType === cfg.type;
          }
          else result = false;

          addLog(node.id, `Condition "${node.label}": ${result ? 'YES' : 'NO'}`);
          for (const edge of findEdges(node.id, result ? 'yes' : 'no')) await executeNode(edge.targetId);

        } else if (node.type === 'action') {
          addLog(node.id, `Running action: ${node.label}`);
          const cfg = node.config ?? {};

          if (node.subType === 'send_notification') {
            const msg = (cfg.message ?? 'Workflow action completed').replace(
              '{{post_title}}', triggerData.title ?? 'your post'
            );
            await dbQuery(
              `INSERT INTO notifications (user_id, type, title, message) VALUES ($1, 'workflow', 'Workflow', $2)`,
              [userId, msg]
            ).catch(() => undefined);

          } else if (node.subType === 'auto_schedule') {
            const postId = String(triggerData.id ?? triggerData.post_id ?? '');
            const platform = String(cfg.platform || 'twitter').toLowerCase();
            const delayHours = Number(cfg.delay_hours ?? 1);
            if (postId) {
              const runAt = new Date(Date.now() + delayHours * 3_600_000);
              await enqueueSocialAutomationTask({
                userId,
                postId,
                platform,
                runAt,
                payload: { destination: { type: 'profile' } },
                accountLabel: platform,
              }).catch(() => undefined);
              addLog(node.id, `Scheduled post to ${platform} in ${delayHours}h`);
            } else {
              addLog(node.id, 'auto_schedule skipped: no post id in trigger data');
            }

          } else if (node.subType === 'add_to_media') {
            const imageUrl = triggerData.featured_image ?? triggerData.image_url ?? '';
            const postTitle = String(triggerData.title ?? 'Workflow Image');
            if (imageUrl) {
              await dbQuery(
                `INSERT INTO media_images (id, user_id, file_name, original_name, file_size, file_type, url, category, upload_date)
                 VALUES ($1, $2, $3, $4, 0, 'image/jpeg', $5, 'workflow', NOW()) ON CONFLICT DO NOTHING`,
                [randomUUID(), userId, `workflow-${Date.now()}.jpg`, postTitle, imageUrl]
              ).catch(() => undefined);
              addLog(node.id, 'Added featured image to media library');
            } else {
              addLog(node.id, 'add_to_media skipped: no image in trigger data');
            }

          } else if (node.subType === 'generate_ai_image') {
            const postTitle = String(triggerData.title ?? cfg.prompt ?? '');
            const postExcerpt = String(triggerData.excerpt ?? '');
            if (postTitle && !(await hasAICredits(userId))) {
              addLog(node.id, 'generate_ai_image skipped: out of AI credits');
            } else if (postTitle) {
              try {
                const aiCfg = await getAIConfig();
                const apiKey = resolveActiveKey(aiCfg);
                let imagePrompt = postTitle;
                if (apiKey) {
                  if (aiCfg.provider === 'google') {
                    const { GoogleGenerativeAI } = await import('@google/generative-ai') as any;
                    const genai = new GoogleGenerativeAI(apiKey);
                    const model = genai.getGenerativeModel({ model: 'gemini-2.0-flash' });
                    const resp = await model.generateContent(
                      `Write a vivid, creative-director intent prompt for Magnific One for a post titled "${postTitle}".${postExcerpt ? ` Context: ${postExcerpt.slice(0, 200)}` : ''} Keep it under 80 words, no --ar flags.`
                    );
                    imagePrompt = resp.response.text().trim() || postTitle;
                    void recordAIUsage({
                      userId, feature: 'workflow_ai_image_prompt', provider: 'google', model: 'gemini-2.0-flash',
                      inputTokens: resp.response.usageMetadata?.promptTokenCount ?? 0,
                      outputTokens: resp.response.usageMetadata?.candidatesTokenCount ?? 0,
                    });
                  } else {
                    const anthropic = new Anthropic({ apiKey });
                    const resp = await anthropic.messages.create({
                      model: FAST_MODEL,
                      max_tokens: 150,
                      messages: [{
                        role: 'user',
                        content: `Write a vivid, creative-director intent prompt for Magnific One for a post titled "${postTitle}".${postExcerpt ? ` Context: ${postExcerpt.slice(0, 200)}` : ''} Keep it under 80 words, no --ar flags.`,
                      }],
                    });
                    imagePrompt = (resp.content[0] as any)?.text?.trim() || postTitle;
                    void recordAIUsage({
                      userId, feature: 'workflow_ai_image_prompt', provider: 'anthropic', model: FAST_MODEL,
                      inputTokens: resp.usage.input_tokens, outputTokens: resp.usage.output_tokens,
                    });
                  }
                }
                // Resolve Magnific API key and render via Magnific One / Magnific Image
                const { rows: magCfg } = await dbQuery(`SELECT config FROM platform_configs WHERE platform = 'magnific' LIMIT 1`).catch(() => ({ rows: [] as any[] }));
                const magnificKey = decryptPlatformConfig(magCfg[0]?.config)?.apiKey || process.env.MAGNIFIC_API_KEY || process.env.FREEPIK_API_KEY || '';
                if (magnificKey && imagePrompt) {
                  const magModel = String(cfg.model || 'magnific-one');
                  const genRes = await magnificGenerateImage(magModel, imagePrompt, String(cfg.aspect_ratio || '16:9'), magnificKey, undefined, {
                    mode: cfg.mode || 'quality',
                    resolution: cfg.resolution || '2k',
                    tiles: cfg.tiles,
                    reference_images: cfg.reference_images,
                  });
                  if (genRes.url && !genRes.error) {
                    triggerData.featured_image = genRes.url;
                    triggerData.image_url = genRes.url;
                    const postId = String(triggerData.id ?? triggerData.post_id ?? '');
                    if (postId) {
                      await dbQuery(`UPDATE blog_posts SET featured_image = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3`, [genRes.url, postId, userId]).catch(() => undefined);
                    }
                    await chargeAICredits(userId, 6, 'workflow_magnific_image', { model: magModel });
                    addLog(node.id, `Generated Magnific (${magModel}) image: ${genRes.url}`);
                  } else {
                    addLog(node.id, `Magnific image fallback to prompt notification (${genRes.error || 'no url'})`);
                  }
                }
                if (imagePrompt) {
                  await dbQuery(
                    `INSERT INTO notifications (user_id, type, title, message) VALUES ($1, 'workflow', 'Magnific AI Image Ready', $2)`,
                    [userId, triggerData.featured_image ? `Magnific One image generated for "${postTitle}".` : `Image prompt for "${postTitle}": ${imagePrompt.slice(0, 300)}`]
                  ).catch(() => undefined);
                }
              } catch (aiErr: any) {
                addLog(node.id, `generate_ai_image error: ${aiErr.message}`);
              }
            } else {
              addLog(node.id, 'generate_ai_image skipped: no post title in trigger data');
            }

          } else if (node.subType === 'generate_ai_video') {
            const { rows: magCfg } = await dbQuery(`SELECT config FROM platform_configs WHERE platform = 'magnific' LIMIT 1`).catch(() => ({ rows: [] as any[] }));
            const magnificKey = decryptPlatformConfig(magCfg[0]?.config)?.apiKey || process.env.MAGNIFIC_API_KEY || '';
            if (!magnificKey) {
              addLog(node.id, 'generate_ai_video skipped: Magnific key not configured');
            } else {
              const vidRes = await magnificGenerateVideo(
                {
                  model: cfg.model || 'kling-v2-6-pro',
                  prompt: String(cfg.prompt || triggerData.title || 'Cinematic brand video'),
                  image_url: cfg.image_url || triggerData.featured_image || triggerData.image_url,
                  duration: cfg.duration || 5,
                  generate_audio: cfg.generate_audio ?? true,
                },
                magnificKey
              );
              if (vidRes.url) {
                triggerData.video_url = vidRes.url;
                await chargeAICredits(userId, 25, 'workflow_magnific_video', { model: vidRes.model });
                addLog(node.id, `Generated Magnific video (${vidRes.model}): ${vidRes.url}`);
              } else {
                addLog(node.id, `generate_ai_video error: ${vidRes.error}`);
              }
            }

          } else if (node.subType === 'generate_ai_lipsync') {
            const { rows: magCfg } = await dbQuery(`SELECT config FROM platform_configs WHERE platform = 'magnific' LIMIT 1`).catch(() => ({ rows: [] as any[] }));
            const magnificKey = decryptPlatformConfig(magCfg[0]?.config)?.apiKey || process.env.MAGNIFIC_API_KEY || '';
            const imgUrl = String(cfg.image_url || triggerData.featured_image || triggerData.image_url || '');
            const audUrl = String(cfg.audio_url || triggerData.audio_url || '');
            if (!magnificKey || !imgUrl || !audUrl) {
              addLog(node.id, 'generate_ai_lipsync skipped: requires Magnific key, image_url, and audio_url');
            } else {
              const lipRes = await magnificLipSync({ image_url: imgUrl, audio_url: audUrl, prompt: cfg.prompt, resolution: cfg.resolution || '1080p' }, magnificKey);
              if (lipRes.url) {
                triggerData.video_url = lipRes.url;
                await chargeAICredits(userId, 30, 'workflow_magnific_lipsync', {});
                addLog(node.id, `Generated OmniHuman 1.5 lip-sync video: ${lipRes.url}`);
              } else {
                addLog(node.id, `generate_ai_lipsync error: ${lipRes.error}`);
              }
            }

          } else if (node.subType === 'generate_ai_audio') {
            const { rows: magCfg } = await dbQuery(`SELECT config FROM platform_configs WHERE platform = 'magnific' LIMIT 1`).catch(() => ({ rows: [] as any[] }));
            const magnificKey = decryptPlatformConfig(magCfg[0]?.config)?.apiKey || process.env.MAGNIFIC_API_KEY || '';
            if (!magnificKey) {
              addLog(node.id, 'generate_ai_audio skipped: Magnific key not configured');
            } else {
              const audRes = await magnificGenerateAudio(
                {
                  type: cfg.audio_type || 'sound-effects',
                  prompt: String(cfg.prompt || triggerData.title || 'Ambient brand sound'),
                  text: String(cfg.prompt || triggerData.title || 'Ambient brand sound'),
                  description: String(cfg.description || cfg.prompt || 'voice'),
                  duration_seconds: cfg.duration_seconds,
                  audio: cfg.audio || triggerData.audio_url,
                  video: cfg.video || triggerData.video_url,
                },
                magnificKey
              );
              if (audRes.url) {
                triggerData.audio_url = audRes.url;
                await chargeAICredits(userId, 5, 'workflow_magnific_audio', { type: audRes.type });
                addLog(node.id, `Generated Magnific audio (${audRes.type}): ${audRes.url}`);
              } else {
                addLog(node.id, `generate_ai_audio error: ${audRes.error}`);
              }
            }

          } else if (node.subType === 'run_magnific_flow' || node.subType === 'magnific_space') {
            const { rows: magCfg } = await dbQuery(`SELECT config FROM platform_configs WHERE platform = 'magnific' LIMIT 1`).catch(() => ({ rows: [] as any[] }));
            const magnificKey = decryptPlatformConfig(magCfg[0]?.config)?.apiKey || process.env.MAGNIFIC_API_KEY || '';
            const flowRes = await magnificExecuteSpaceOrFlow(
              {
                action: cfg.action || 'run_flow',
                goal: String(cfg.goal || triggerData.title || 'Brand visual campaign'),
                aspect_ratio: cfg.aspect_ratio || '16:9',
                nodes: cfg.nodes,
                reference_images: cfg.reference_images,
              },
              magnificKey
            );
            if (flowRes.final_url) {
              triggerData.featured_image = flowRes.final_url;
              triggerData.image_url = flowRes.final_url;
              await chargeAICredits(userId, flowRes.estimated_credits ?? 10, 'workflow_magnific_flow', {});
              addLog(node.id, `Completed Magnific Space/Flow: ${flowRes.final_url}`);
            } else {
              addLog(node.id, `Magnific Space/Flow status: ${flowRes.error || flowRes.action}`);
            }

          } else if (node.subType === 'apply_template') {
            const templateId = String(cfg.template_id || '');
            const postTitle = String(triggerData.title ?? 'Untitled');
            if (templateId) {
              const { rows: tmplRows } = await dbQuery(
                `SELECT id, name, design_data FROM card_templates WHERE id = $1 LIMIT 1`, [templateId]
              ).catch(() => ({ rows: [] }));
              if (tmplRows.length) {
                const tmpl = tmplRows[0] as any;
                const designId = randomUUID();
                await dbQuery(
                  `INSERT INTO user_designs (id, user_id, name, description, design_data, created_at, updated_at)
                   VALUES ($1, $2, $3, $4, $5::jsonb, NOW(), NOW())
                   ON CONFLICT DO NOTHING`,
                  [designId, userId, `${postTitle} — ${tmpl.name}`, `Auto-created from workflow template`, JSON.stringify(tmpl.design_data)]
                ).catch(() => undefined);
                await dbQuery(
                  `INSERT INTO notifications (user_id, type, title, message) VALUES ($1, 'workflow', 'Card Created', $2)`,
                  [userId, `A card was created from template "${tmpl.name}" for your post "${postTitle}".`]
                ).catch(() => undefined);
                addLog(node.id, `Created design "${postTitle} — ${tmpl.name}" from template`);
              } else {
                addLog(node.id, `apply_template: template "${templateId}" not found`);
              }
            } else {
              addLog(node.id, 'apply_template: no template selected');
            }

          } else {
            addLog(node.id, `Action subType "${node.subType}" not yet implemented`);
          }

          addLog(node.id, `Action "${node.label}" done`);
          for (const edge of findEdges(node.id)) await executeNode(edge.targetId);
        } else {
          for (const edge of findEdges(node.id)) await executeNode(edge.targetId);
        }
      };

      for (const edge of findEdges(triggerNode.id)) await executeNode(edge.targetId);
    } catch (err: any) {
      finalStatus = 'failed';
      addLog('engine', `Error: ${err.message}`);
    }

    await dbQuery(
      `UPDATE workflow_runs SET status = $2, logs = $3, completed_at = NOW() WHERE id = $1`,
      [runId, finalStatus, JSON.stringify(logs)]
    );

    return { run_id: runId, status: finalStatus, logs };
  }

  async function fireWorkflowTriggers(
    userId: string,
    eventType: string,
    triggerData: Record<string, any>
  ): Promise<void> {
    if (!hasDatabase()) return;
    try {
      const { rows } = await dbQuery(
        `SELECT id, nodes, edges FROM workflows WHERE user_id = $1 AND status = 'active'`,
        [userId]
      );
      for (const wf of rows) {
        const nodes: any[] = (wf as any).nodes ?? [];
        const triggerNode = nodes.find((n: any) => n.type === 'trigger' && n.subType === eventType);
        if (!triggerNode) continue;
        void executeWorkflowOnce(userId, wf as any, triggerData).catch(() => undefined);
      }
    } catch (err) {
      logger.error('Unhandled error:', err);
    }
  }

  // ── Workflow CRUD routes ──────────────────────────────────────────────────────

  router.get('/workflows', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!hasDatabase()) return res.json({ success: true, workflows: [] });
      const { rows } = await dbQuery(
        `SELECT id, name, description, status, nodes, edges, created_at, updated_at
         FROM workflows WHERE user_id = $1 ORDER BY updated_at DESC`,
        [auth.userId]
      );
      return res.json({ success: true, workflows: rows });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  router.post('/workflows', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      const { name = 'Untitled Workflow', description = '', nodes = [], edges = [] } = req.body;
      if (!hasDatabase()) return res.status(503).json({ success: false, error: 'DB unavailable' });
      const { rows } = await dbQuery(
        `INSERT INTO workflows (user_id, name, description, nodes, edges)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [auth.userId, name, description, JSON.stringify(nodes), JSON.stringify(edges)]
      );
      return res.json({ success: true, workflow: rows[0] });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  router.get('/workflows/:id', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!hasDatabase()) return res.status(503).json({ success: false, error: 'DB unavailable' });
      const { rows } = await dbQuery(
        `SELECT * FROM workflows WHERE id = $1 AND user_id = $2`,
        [req.params.id, auth.userId]
      );
      if (!rows.length) return res.status(404).json({ success: false, error: 'Workflow not found' });
      return res.json({ success: true, workflow: rows[0] });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  router.put('/workflows/:id', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!hasDatabase()) return res.status(503).json({ success: false, error: 'DB unavailable' });
      const { name, description, nodes, edges, status } = req.body;
      const { rows } = await dbQuery(
        `UPDATE workflows SET
          name        = COALESCE($3, name),
          description = COALESCE($4, description),
          nodes       = COALESCE($5, nodes),
          edges       = COALESCE($6, edges),
          status      = COALESCE($7, status),
          updated_at  = NOW()
         WHERE id = $1 AND user_id = $2 RETURNING *`,
        [req.params.id, auth.userId, name ?? null, description ?? null,
         nodes ? JSON.stringify(nodes) : null, edges ? JSON.stringify(edges) : null, status ?? null]
      );
      if (!rows.length) return res.status(404).json({ success: false, error: 'Workflow not found' });
      return res.json({ success: true, workflow: rows[0] });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  router.delete('/workflows/:id', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!hasDatabase()) return res.status(503).json({ success: false, error: 'DB unavailable' });
      await dbQuery(`DELETE FROM workflows WHERE id = $1 AND user_id = $2`, [req.params.id, auth.userId]);
      return res.json({ success: true });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  router.post('/workflows/:id/activate', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!hasDatabase()) return res.status(503).json({ success: false, error: 'DB unavailable' });
      const { rows: current } = await dbQuery(
        `SELECT status FROM workflows WHERE id = $1 AND user_id = $2`,
        [req.params.id, auth.userId]
      );
      if (!current.length) return res.status(404).json({ success: false, error: 'Not found' });
      const newStatus = (current[0] as any).status === 'active' ? 'inactive' : 'active';
      const { rows } = await dbQuery(
        `UPDATE workflows SET status = $3, updated_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING *`,
        [req.params.id, auth.userId, newStatus]
      );
      return res.json({ success: true, workflow: rows[0] });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  router.get('/workflows/:id/runs', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!hasDatabase()) return res.json({ success: true, runs: [] });
      const { rows } = await dbQuery(
        `SELECT r.* FROM workflow_runs r
         JOIN workflows w ON w.id = r.workflow_id
         WHERE r.workflow_id = $1 AND w.user_id = $2
         ORDER BY r.started_at DESC LIMIT 50`,
        [req.params.id, auth.userId]
      );
      return res.json({ success: true, runs: rows });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  router.post('/workflows/:id/run', async (req: Request, res: Response) => {
    try {
      const auth = requireAuth(req, res);
      if (!auth) return;
      if (!hasDatabase()) return res.status(503).json({ success: false, error: 'DB unavailable' });
      const { rows: wfRows } = await dbQuery(
        `SELECT * FROM workflows WHERE id = $1 AND user_id = $2`,
        [req.params.id, auth.userId]
      );
      if (!wfRows.length) return res.status(404).json({ success: false, error: 'Workflow not found' });
      const triggerData = req.body.trigger_data ?? {};
      const result = await executeWorkflowOnce(auth.userId, wfRows[0] as any, triggerData);
      return res.json({ success: true, ...result });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  return { fireWorkflowTriggers, workflowRouter: router };
}
