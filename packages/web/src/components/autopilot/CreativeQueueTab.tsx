import { useCallback, useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Drawer,
  EmptyState,
  Eyebrow,
  Field,
  Loading,
  Modal,
  Notice,
  SectionHeading,
  Table,
  Td,
  Th,
  Thead,
  Tr,
} from '../ui';
import { autopilotService } from '../../services/autopilotService';

interface Props {
  onRefreshOverview: () => void;
  onOpenApprovalQueue: () => void;
}

function stateBadgeTone(state: string): 'default' | 'positive' | 'warn' | 'danger' | 'info' | 'muted' {
  if (state === 'approved' || state === 'published') return 'positive';
  if (state === 'review_required' || state === 'scheduled') return 'info';
  if (state === 'needs_changes') return 'warn';
  if (state === 'rejected' || state === 'generation_failed' || state === 'publish_failed') return 'danger';
  return 'muted';
}

export default function CreativeQueueTab({ onRefreshOverview, onOpenApprovalQueue }: Props) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [items, setItems] = useState<any[]>([]);
  const [models, setModels] = useState<any[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [newFormat, setNewFormat] = useState<'static_graphic' | 'carousel' | 'short_video' | 'product_demo'>('static_graphic');
  const [newChannel, setNewChannel] = useState('instagram');

  // Active drawer item
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ item: any; brief: any; runs: any[] } | null>(null);
  const [creativeMode, setCreativeMode] = useState<'strict_brand' | 'brand_inspired' | 'creative_freedom'>('brand_inspired');
  const [logoPolicy, setLogoPolicy] = useState<'always' | 'contextual' | 'never'>('contextual');
  const [textInImage, setTextInImage] = useState<'avoid' | 'minimal' | 'allowed'>('avoid');
  const [referenceFidelity, setReferenceFidelity] = useState<'strict' | 'balanced' | 'exploratory'>('balanced');
  const [mediaSourceMode, setMediaSourceMode] = useState<'ai_generated' | 'real_screenshot' | 'real_photography' | 'hybrid'>('ai_generated');
  const [spendLimitUsd, setSpendLimitUsd] = useState(2.5);
  const [creditCeiling, setCreditCeiling] = useState(80);
  const [demoCaptureUrl, setDemoCaptureUrl] = useState('');
  const [preferDraftCost, setPreferDraftCost] = useState(false);
  const [costEstimate, setCostEstimate] = useState<any | null>(null);

  // Spend modal & aspect ratio states
  const [confirmSpendModalOpen, setConfirmSpendModalOpen] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<'1:1' | '4:5' | '9:16'>('4:5');

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [itemsRes, modelsRes] = await Promise.all([
        autopilotService.listItems(),
        autopilotService.listModels().catch(() => ({ models: [] })),
      ]);
      setItems(itemsRes.items || []);
      setModels(modelsRes.models || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load Creative Queue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const openItemDrawer = async (id: string) => {
    setSelectedId(id);
    setError(null);
    try {
      const res = await autopilotService.getItemDetail(id);
      setDetail({ item: res.item, brief: res.brief, runs: res.runs || [] });
      if (res.brief) {
        setCreativeMode(res.brief.creative_mode || 'brand_inspired');
        setLogoPolicy(res.brief.controls?.logo_policy || 'contextual');
        setTextInImage(res.brief.controls?.text_in_image || 'avoid');
        setReferenceFidelity(res.brief.controls?.reference_fidelity || 'balanced');
        setMediaSourceMode(res.brief.controls?.media_source_mode || 'ai_generated');
        setSpendLimitUsd(Number(res.brief.spend_limit_usd ?? 2.5));
        setCreditCeiling(Number(res.brief.credit_ceiling ?? 80));
        const est = await autopilotService.estimateItemCost(id).catch(() => null);
        if (est?.estimate) setCostEstimate(est.estimate);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load item brief');
    }
  };

  const handleCreateCustomItem = async () => {
    if (!newTitle.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await autopilotService.createItem({
        title: newTitle.trim(),
        hook: newTitle.trim(),
        caption: `${newTitle.trim()}\n\nPractical breakdown and next steps.`,
        format: newFormat,
        target_channels: [newChannel],
      });
      setNewTitle('');
      await loadList();
      onRefreshOverview();
      await openItemDrawer(res.item.id);
    } catch (e: any) {
      setError(e.message || 'Failed to create content item');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveBriefControls = async () => {
    if (!detail?.item?.id) return;
    setBusy(true);
    setError(null);
    try {
      const res = await autopilotService.updateBrief(detail.item.id, {
        creative_mode: creativeMode,
        spend_limit_usd: Number(spendLimitUsd),
        credit_ceiling: Number(creditCeiling),
        controls: {
          logo_policy: logoPolicy,
          text_in_image: textInImage,
          reference_fidelity: referenceFidelity,
          media_source_mode: mediaSourceMode,
          user_confirmed_spend: true,
        },
      });
      setDetail((prev) => (prev ? { ...prev, brief: res.brief } : prev));
      setCostEstimate(res.cost_estimate);
      setNote('Updated Creative Brief controls and recalculated dual USD / credit estimate.');
    } catch (e: any) {
      setError(e.message || 'Failed to update Creative Brief');
    } finally {
      setBusy(false);
    }
  };

  const handleExecuteWorkflow = async (regenSceneNumber?: number, bypassSpendPrompt?: boolean) => {
    if (!detail?.item?.id) return;
    if (!bypassSpendPrompt && (costEstimate?.estimated_provider_cost_usd ?? 0) > 2.0) {
      setConfirmSpendModalOpen(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await autopilotService.updateBrief(detail.item.id, {
        creative_mode: creativeMode,
        spend_limit_usd: Number(spendLimitUsd),
        credit_ceiling: Number(creditCeiling),
        controls: {
          logo_policy: logoPolicy,
          text_in_image: textInImage,
          reference_fidelity: referenceFidelity,
          media_source_mode: mediaSourceMode,
          user_confirmed_spend: true,
        },
      });

      const genRes = await autopilotService.generateItemAssets(detail.item.id, {
        prefer_draft_cost: preferDraftCost,
        demo_capture_url: demoCaptureUrl.trim() || undefined,
        regenerate_scene_numbers: regenSceneNumber ? [regenSceneNumber] : undefined,
      });

      const refreshed = await autopilotService.getItemDetail(detail.item.id);
      setDetail({ item: refreshed.item, brief: refreshed.brief, runs: refreshed.runs || [] });
      await loadList();
      onRefreshOverview();
      setNote(
        `Workflow ${genRes.run.workflow_type} completed · Provider spend $${Number(genRes.run.actual_provider_cost_usd).toFixed(3)} USD · ${genRes.run.actual_credits} credits · QA score ${genRes.item.validation_report?.score ?? 100}/100.`,
      );
    } catch (e: any) {
      setError(e.message || 'Workflow execution blocked');
    } finally {
      setBusy(false);
    }
  };

  const handleRegenerateCaptionOnly = async () => {
    if (!detail?.item?.id) return;
    setBusy(true);
    setError(null);
    try {
      const refreshed = await autopilotService.updateItem(detail.item.id, {
        caption: `${detail.item.title}\n\nKey takeaways:\n• Actionable insight 1\n• Concrete step 2\n• Practical implementation advice.`,
      });
      setDetail((prev) => (prev ? { ...prev, item: refreshed.item } : prev));
      setNote('Regenerated caption copy with structured takeaway formatting.');
      await loadList();
    } catch (e: any) {
      setError(e.message || 'Failed to regenerate caption');
    } finally {
      setBusy(false);
    }
  };

  const handleOpenInPostEditor = (item: any) => {
    localStorage.setItem(
      'contentflow_prefill_post',
      JSON.stringify({
        title: item.title,
        excerpt: item.hook,
        content: item.caption,
        featured_image: item.media_assets?.[0]?.url || '',
      }),
    );
    window.location.href = '/posts';
  };

  if (loading) {
    return <Loading label="Loading Creative Queue" rows={4} />;
  }

  return (
    <div className="space-y-6">
      {error && <Notice tone="danger" title="Creative Queue Alert">{error}</Notice>}
      {note && <Notice tone="positive" title="Workflow Complete">{note}</Notice>}

      <Card>
        <SectionHeading
          title="Parameterized Creative Queue"
          hint="Author briefs with Strict Brand, Brand-Inspired, or Creative Freedom controls, inspect separate third-party USD vs workspace credit estimates, and run deterministic typography/logo finishing."
          action={
            <Button variant="secondary" size="sm" onClick={onOpenApprovalQueue}>
              Go to Approval Queue
            </Button>
          }
        />

        {/* Quick Create Bar */}
        <div className="mb-5 flex flex-wrap items-end gap-3 rounded-xl border border-line bg-sunken p-4">
          <div className="min-w-[220px] flex-1">
            <Field label="New Content Idea / Hook">
              <input
                className="w-full rounded-[10px] border border-line bg-white px-3.5 py-2 text-xs text-ink"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. How our webhook retry queue prevents duplicate posts"
              />
            </Field>
          </div>
          <Field label="Format / Workflow">
            <select className="rounded-[10px] border border-line bg-white px-3 py-2 text-xs text-ink" value={newFormat} onChange={(e) => setNewFormat(e.target.value as any)}>
              <option value="static_graphic">Branded Social Graphic (Workflow A)</option>
              <option value="carousel">Educational / Product Carousel (Workflow C)</option>
              <option value="short_video">Short-Form Video / Reel (Workflow B)</option>
              <option value="product_demo">Authentic Product Demo (Workflow D)</option>
            </select>
          </Field>
          <Field label="Primary Channel">
            <select className="rounded-[10px] border border-line bg-white px-3 py-2 text-xs text-ink" value={newChannel} onChange={(e) => setNewChannel(e.target.value)}>
              <option value="instagram">Instagram</option>
              <option value="linkedin">LinkedIn</option>
              <option value="facebook">Facebook</option>
              <option value="twitter">X / Twitter</option>
            </select>
          </Field>
          {/* Single accent CTA on Creative Queue main view */}
          <Button variant="accent" size="sm" onClick={handleCreateCustomItem} disabled={busy || !newTitle.trim()}>
            Create Brief
          </Button>
        </div>

        {items.length === 0 ? (
          <EmptyState message="No content items in the queue yet. Generate a pilot batch from Strategy or create a brief above." />
        ) : (
          <Table>
            <Thead>
              <Th>Content Piece</Th>
              <Th>Workflow</Th>
              <Th>Channels</Th>
              <Th>QA Gate</Th>
              <Th>State</Th>
              <Th align="right">Actions</Th>
            </Thead>
            <tbody>
              {items.map((item) => (
                <Tr key={item.id} onClick={() => void openItemDrawer(item.id)}>
                  <Td>
                    <div className="font-medium text-ink">{item.title}</div>
                    <div className="text-xs text-muted">{item.pillar_name} · v{item.version}</div>
                  </Td>
                  <Td>
                    <span className="font-mono text-xs text-ink">{item.workflow_type.replace(/_/g, ' ')}</span>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {(item.target_channels || []).map((c: string) => (
                        <Badge key={c} tone="muted">{c}</Badge>
                      ))}
                    </div>
                  </Td>
                  <Td>
                    {typeof item.validation_report?.score === 'number' ? (
                      <Badge tone={item.validation_report.passed ? 'positive' : 'danger'}>
                        {item.validation_report.score}/100
                      </Badge>
                    ) : (
                      <span className="font-mono text-xs text-muted">Pending</span>
                    )}
                  </Td>
                  <Td>
                    <Badge tone={stateBadgeTone(item.lifecycle_state)}>
                      {item.lifecycle_state.replace(/_/g, ' ')}
                    </Badge>
                  </Td>
                  <Td align="right">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void openItemDrawer(item.id)}
                    >
                      Configure & Generate
                    </Button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* Parameterized Creative Brief & Workflow Drawer */}
      <Drawer
        open={Boolean(selectedId && detail)}
        onClose={() => { setSelectedId(null); setDetail(null); }}
        wide
        title={detail?.item?.title || 'Creative Brief'}
        subtitle={detail ? `Workflow: ${detail.item.workflow_type} · Model Router: ${detail.brief?.selected_provider}:${detail.brief?.selected_model}` : ''}
        footer={
          detail && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={handleSaveBriefControls} disabled={busy}>
                  Update Estimate
                </Button>
                <Button variant="ghost" size="sm" onClick={() => handleOpenInPostEditor(detail.item)}>
                  Open in Post Editor
                </Button>
              </div>
              <Button variant="primary" onClick={() => void handleExecuteWorkflow()} disabled={busy}>
                {busy ? 'Executing Workflow…' : `Execute ${detail.item.workflow_type.replace(/_/g, ' ')}`}
              </Button>
            </div>
          )
        }
      >
        {detail && (
          <div className="space-y-6">
            {/* Dual Cost & Cap Bar */}
            <div className="grid gap-3 rounded-xl border border-line bg-sunken p-4 sm:grid-cols-3">
              <div>
                <Eyebrow>EST. 3RD-PARTY PROVIDER USD</Eyebrow>
                <div className="mt-1 font-mono text-lg font-medium text-ink">
                  ${Number(costEstimate?.estimated_provider_cost_usd ?? detail.brief?.estimated_provider_cost_usd ?? 0).toFixed(3)} USD
                </div>
                <div className="text-[11px] text-muted">Cap: ${spendLimitUsd.toFixed(2)} USD</div>
              </div>
              <div>
                <Eyebrow>INTERNAL WORKSPACE CREDITS</Eyebrow>
                <div className="mt-1 font-mono text-lg font-medium text-ink">
                  {costEstimate?.estimated_internal_credits ?? detail.brief?.estimated_credits ?? 0} cr
                </div>
                <div className="text-[11px] text-muted">Ceiling: {creditCeiling} cr (separate from USD)</div>
              </div>
              <div>
                <Eyebrow>TASK-ROUTED MODEL</Eyebrow>
                <div className="mt-1 font-mono text-xs font-medium text-ink">
                  {costEstimate?.selected_provider ?? detail.brief?.selected_provider}:{costEstimate?.selected_model ?? detail.brief?.selected_model}
                </div>
                <div className="text-[11px] text-muted">{models.length} registered models active</div>
              </div>
            </div>

            {costEstimate?.blocking_reason && (
              <Notice tone="danger" title="Pre-Flight Cost Cap Block">
                {costEstimate.blocking_reason}
              </Notice>
            )}

            {/* Creative Mode + Independent Controls */}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Creative Mode" hint="Factual integrity & consent gates remain active in ALL modes">
                <select className="w-full rounded-[10px] border border-line bg-white px-3 py-2 text-xs text-ink" value={creativeMode} onChange={(e) => setCreativeMode(e.target.value as any)}>
                  <option value="strict_brand">Strict Brand (approved palette & layout only)</option>
                  <option value="brand_inspired">Brand-Inspired (brand anchor + storytelling depth)</option>
                  <option value="creative_freedom">Creative Freedom (expressive visuals, factual guardrails enforced)</option>
                </select>
              </Field>
              <Field label="Independent Logo Control" hint="Never redrawn by generative pixels">
                <select className="w-full rounded-[10px] border border-line bg-white px-3 py-2 text-xs text-ink" value={logoPolicy} onChange={(e) => setLogoPolicy(e.target.value as any)}>
                  <option value="contextual">Contextual (cover/end cards)</option>
                  <option value="always">Always apply deterministic logo master</option>
                  <option value="never">Never apply logo on this asset</option>
                </select>
              </Field>
              <Field label="Text-in-Image Policy">
                <select className="w-full rounded-[10px] border border-line bg-white px-3 py-2 text-xs text-ink" value={textInImage} onChange={(e) => setTextInImage(e.target.value as any)}>
                  <option value="avoid">Avoid in pixels — deterministic typography overlay (Recommended)</option>
                  <option value="minimal">Minimal tack-sharp label</option>
                  <option value="allowed">Allowed (routes to Nano Banana Pro / GPT Image 1)</option>
                </select>
              </Field>
              <Field label="Media Source Mode">
                <select className="w-full rounded-[10px] border border-line bg-white px-3 py-2 text-xs text-ink" value={mediaSourceMode} onChange={(e) => setMediaSourceMode(e.target.value as any)}>
                  <option value="ai_generated">AI Visual + Deterministic Brand Layer</option>
                  <option value="real_screenshot">Real Product Screenshot (0% hallucinated UI)</option>
                  <option value="real_photography">Customer Photography + Deterministic Layout</option>
                  <option value="hybrid">Hybrid Multi-Scene</option>
                </select>
              </Field>
              <Field label="Reference Fidelity">
                <select className="w-full rounded-[10px] border border-line bg-white px-3 py-2 text-xs text-ink" value={referenceFidelity} onChange={(e) => setReferenceFidelity(e.target.value as any)}>
                  <option value="strict">Strict lock</option>
                  <option value="balanced">Balanced</option>
                  <option value="exploratory">Exploratory</option>
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Spend Cap (USD)">
                  <input type="number" step={0.25} min={0.05} className="w-full rounded-[10px] border border-line bg-white px-3 py-2 font-mono text-xs text-ink" value={spendLimitUsd} onChange={(e) => setSpendLimitUsd(Number(e.target.value))} />
                </Field>
                <Field label="Credit Ceiling">
                  <input type="number" step={5} min={1} className="w-full rounded-[10px] border border-line bg-white px-3 py-2 font-mono text-xs text-ink" value={creditCeiling} onChange={(e) => setCreditCeiling(Number(e.target.value))} />
                </Field>
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-ink">
              <input type="checkbox" checked={preferDraftCost} onChange={(e) => setPreferDraftCost(e.target.checked)} />
              Use low-cost draft pass first before full-resolution render
            </label>

            {detail.item.workflow_type === 'product_demo' && (
              <Field label="Authentic Product Screen Capture / Video URL (Required for Workflow D)" hint="Autopilot refuses to fabricate fake software UI screens">
                <input
                  className="w-full rounded-[10px] border border-line bg-white px-3.5 py-2 font-mono text-xs text-ink"
                  value={demoCaptureUrl}
                  onChange={(e) => setDemoCaptureUrl(e.target.value)}
                  placeholder="https://.../real-product-screen.png or select from Brand Studio Vault"
                />
              </Field>
            )}

            {/* Aspect Ratio & Safe-Area Controls */}
            <div className="rounded-xl border border-line bg-white p-3.5 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Eyebrow>COMPOSITION ASPECT RATIO & SAFE-AREA GUIDES</Eyebrow>
                <div className="flex gap-1.5">
                  {(['1:1', '4:5', '9:16'] as const).map((ratio) => (
                    <button
                      key={ratio}
                      type="button"
                      onClick={() => setAspectRatio(ratio)}
                      className={`rounded-[8px] border px-2.5 py-1 font-mono text-xs transition ${
                        aspectRatio === ratio
                          ? 'border-ink bg-ink text-white'
                          : 'border-line bg-sunken text-muted hover:text-ink'
                      }`}
                    >
                      {ratio} {ratio === '1:1' ? 'Square' : ratio === '4:5' ? 'Portrait' : 'Vertical'}
                    </button>
                  ))}
                </div>
              </div>
              {aspectRatio === '9:16' && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 p-2 text-[11px] text-amber-800">
                  <strong>Vertical 9:16 Safe-Zone Overlay Active:</strong> Verify that titles and brand assets avoid the top 15% (header/profile) and bottom 20% (caption/actions).
                </div>
              )}
            </div>

            {/* Targeted Creative Actions Bar */}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="secondary" size="sm" onClick={handleRegenerateCaptionOnly} disabled={busy}>
                Regenerate Caption Only
              </Button>
              <Button variant="secondary" size="sm" onClick={() => void handleExecuteWorkflow()} disabled={busy}>
                Regenerate Visual Layer
              </Button>
              {detail.item.storyboard?.length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => void handleExecuteWorkflow(1)} disabled={busy}>
                  Regenerate Scene 1
                </Button>
              )}
            </div>

            {/* Deterministic Raster Preview + Slide / Storyboard Breakdown */}
            {detail.item.deterministic_overlay?.preview_raster_data_url && (
              <div className="rounded-xl border border-line bg-sunken p-4">
                <Eyebrow>DETERMINISTIC COMPOSITOR PREVIEW & CONTRAST CHECK</Eyebrow>
                <div className="mt-3 flex flex-wrap items-start gap-4">
                  <div className={`relative overflow-hidden rounded-[10px] border border-line bg-white ${
                    aspectRatio === '9:16' ? 'aspect-[9/16] w-40' : aspectRatio === '1:1' ? 'aspect-square w-44' : 'aspect-[4/5] w-44'
                  }`}>
                    <img
                      src={detail.item.deterministic_overlay.preview_raster_data_url}
                      alt={detail.item.alt_text || detail.item.title}
                      className="h-full w-full object-contain"
                    />
                    {aspectRatio === '9:16' && (
                      <>
                        <div className="absolute top-0 inset-x-0 h-[15%] border-b border-dashed border-red-500/70 bg-red-500/10 flex items-center justify-center text-[8px] font-mono text-red-600 font-bold">
                          TOP SAFE (15%)
                        </div>
                        <div className="absolute bottom-0 inset-x-0 h-[20%] border-t border-dashed border-red-500/70 bg-red-500/10 flex items-center justify-center text-[8px] font-mono text-red-600 font-bold">
                          BOTTOM SAFE (20%)
                        </div>
                        <div className="absolute top-[15%] bottom-[20%] right-0 w-[12%] border-l border-dashed border-amber-500/70 bg-amber-500/10" />
                      </>
                    )}
                  </div>
                  <div className="flex-1 space-y-1.5 text-xs">
                    <div>
                      <strong>Contrast Ratio:</strong>{' '}
                      <span className="font-mono">{detail.item.deterministic_overlay.palette_applied?.contrast_ratio}:1</span> (WCAG AA &ge; 4.5:1)
                    </div>
                    <div>
                      <strong>Typography:</strong>{' '}
                      <span className="font-mono">{detail.item.deterministic_overlay.typography?.heading_font}</span>
                    </div>
                    <div>
                      <strong>Logo Lockup:</strong>{' '}
                      <span className="font-mono">
                        {detail.item.deterministic_overlay.logo_layer?.enabled
                          ? `Enabled (${detail.item.deterministic_overlay.logo_layer.variant})`
                          : `Disabled (${detail.item.deterministic_overlay.logo_layer?.policy})`}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Video Storyboard Selective Scene Regeneration (Workflow B) */}
            {detail.item.storyboard?.length > 0 && (
              <div className="space-y-2">
                <Eyebrow>STORYBOARD SCENES (SELECTIVE SCENE REGENERATION)</Eyebrow>
                {detail.item.storyboard.map((sc: any) => (
                  <div key={sc.scene_number} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-white p-3 text-xs">
                    <div className="min-w-0">
                      <div className="font-medium text-ink">
                        Scene {sc.scene_number} ({sc.duration_sec}s · {sc.source_type})
                      </div>
                      <div className="text-muted">{sc.visual_description}</div>
                      <div className="mt-0.5 font-mono text-[11px] text-ink">Caption: "{sc.caption_text}"</div>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      onClick={() => void handleExecuteWorkflow(sc.scene_number)}
                    >
                      Regen Scene {sc.scene_number}
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {/* Carousel Slides (Workflow C) */}
            {detail.item.slides?.length > 0 && (
              <div className="space-y-2">
                <Eyebrow>CAROUSEL SLIDES (1 MAIN IDEA PER SLIDE)</Eyebrow>
                <div className="grid gap-2 sm:grid-cols-2">
                  {detail.item.slides.map((sl: any) => (
                    <div key={sl.slide_number} className="rounded-xl border border-line bg-white p-3 text-xs">
                      <div className="font-mono text-[11px] text-muted">SLIDE {sl.slide_number}/{detail.item.slides.length}</div>
                      <div className="mt-1 font-medium text-ink">{sl.heading}</div>
                      <div className="mt-0.5 text-muted">{sl.body}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* QA & Policy Gate Report */}
            {detail.item.validation_report?.checked_at && (
              <div className="rounded-xl border border-line bg-white p-4">
                <div className="flex items-center justify-between">
                  <Eyebrow>QA, FACTUAL, REGULATORY & ACCESSIBILITY GATE</Eyebrow>
                  <Badge tone={detail.item.validation_report.passed ? 'positive' : 'danger'}>
                    {detail.item.validation_report.passed ? 'PASSED' : 'BLOCKED'} · {detail.item.validation_report.score}/100
                  </Badge>
                </div>
                {(detail.item.validation_report.issues || []).length === 0 ? (
                  <p className="mt-2 text-xs text-muted">Zero policy blockers or warnings detected.</p>
                ) : (
                  <ul className="mt-2 space-y-1.5 text-xs">
                    {detail.item.validation_report.issues.map((iss: any, idx: number) => (
                      <li key={idx} className="rounded-[10px] border border-line bg-sunken px-3 py-2">
                        <strong className={iss.severity === 'blocker' ? 'text-danger-text' : 'text-warn-text'}>
                          [{iss.severity.toUpperCase()} · {iss.code}]
                        </strong>{' '}
                        {iss.message} <span className="text-muted">Fix: {iss.remediation}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </Drawer>

      {/* Model Provider Spend Confirmation Modal */}
      <Modal
        open={confirmSpendModalOpen}
        onClose={() => setConfirmSpendModalOpen(false)}
        title="Model Provider Spend Confirmation"
        subtitle="Estimated third-party provider fees exceed the $2.00 confirmation threshold."
      >
        <div className="space-y-4 text-xs">
          <div className="rounded-xl border border-line bg-sunken p-4 space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-muted">Estimated Provider Cost:</span>
              <span className="font-mono text-base font-bold text-ink">
                ${(costEstimate?.estimated_provider_cost_usd ?? spendLimitUsd).toFixed(2)} USD
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted">Internal Workspace Credits:</span>
              <span className="font-mono text-ink">
                {costEstimate?.estimated_internal_credits ?? creditCeiling} cr
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted">Targeted Model:</span>
              <span className="font-mono text-ink">
                {costEstimate?.selected_provider ?? 'default'}:{costEstimate?.selected_model ?? 'task-routed'}
              </span>
            </div>
          </div>
          <p className="text-muted">
            This generation will invoke external model providers with real billing impact. Confirm to execute.
          </p>
          <div className="flex justify-end gap-2 pt-2 border-t border-line">
            <Button variant="secondary" size="sm" onClick={() => setConfirmSpendModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setConfirmSpendModalOpen(false);
                void handleExecuteWorkflow(undefined, true);
              }}
            >
              Confirm Spend & Execute
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
