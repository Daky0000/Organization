import { useCallback, useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Card,
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
  Toggle,
  Tr,
} from '../ui';
import { autopilotService } from '../../services/autopilotService';

interface Props {
  onRefreshOverview: () => void;
}

export default function BrandStudioTab({ onRefreshOverview }: Props) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [scanUrl, setScanUrl] = useState('');
  const [preserveTokens, setPreserveTokens] = useState(true);
  const [scanWarnings, setScanWarnings] = useState<string[]>([]);
  const [brand, setBrand] = useState<any | null>(null);
  const [tokens, setTokens] = useState<any[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  const [versions, setVersions] = useState<any[]>([]);

  // Version Diff & Restore Modal State
  const [diffModalOpen, setDiffModalOpen] = useState(false);
  const [diffVersion1, setDiffVersion1] = useState(1);
  const [diffVersion2, setDiffVersion2] = useState(1);
  const [diffData, setDiffData] = useState<any | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [restoringVersion, setRestoringVersion] = useState(false);

  // Manual Brand System fields
  const [brandName, setBrandName] = useState('');
  const [positioning, setPositioning] = useState('');
  const [voiceAttributes, setVoiceAttributes] = useState('');
  const [avoidTerms, setAvoidTerms] = useState('');
  const [retiredColors, setRetiredColors] = useState('');
  const [approvedClaims, setApprovedClaims] = useState('');
  const [logoPolicyDefault, setLogoPolicyDefault] = useState<'always' | 'contextual' | 'never'>('contextual');

  // Custom color swatch input
  const [newColorName, setNewColorName] = useState('');
  const [newColorHex, setNewColorHex] = useState('#2563EB');
  const [newColorRole, setNewColorRole] = useState('accent');

  // Asset upload form
  const [assetName, setAssetName] = useState('');
  const [assetUrl, setAssetUrl] = useState('');
  const [assetType, setAssetType] = useState<'logo' | 'product_screenshot' | 'video_capture' | 'product_photo' | 'founder_footage' | 'style_reference'>('logo');
  const [assetVariant, setAssetVariant] = useState('lockup-on-light');
  const [rightsConfirmed, setRightsConfirmed] = useState(true);
  const [consentedLikeness, setConsentedLikeness] = useState(false);

  const hydrateBrand = useCallback((b: any) => {
    setBrand(b);
    if (!b) return;
    setBrandName(b.brand_name || '');
    setPositioning(b.identity?.positioning || '');
    setVoiceAttributes((b.voice?.attributes || []).join(', '));
    setAvoidTerms((b.voice?.avoid_terms || []).join(', '));
    setRetiredColors((b.visual?.retired_colors || []).join(', '));
    setApprovedClaims((b.identity?.approved_claims || []).join('\n'));
    setLogoPolicyDefault(b.content_rules?.logo_policy_default || 'contextual');
    if (b.source?.website_url && !scanUrl) setScanUrl(b.source.website_url);
  }, [scanUrl]);

  const loadStudio = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await autopilotService.getBrandStudio();
      hydrateBrand(res.brand);
      setTokens(res.tokens || []);
      setAssets(res.assets || []);
      setVersions(res.versions || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load Brand Studio');
    } finally {
      setLoading(false);
    }
  }, [hydrateBrand]);

  useEffect(() => {
    void loadStudio();
  }, [loadStudio]);

  const handleScanWebsite = async () => {
    if (!scanUrl.trim()) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await autopilotService.scanWebsiteBrand(scanUrl.trim(), preserveTokens);
      setScanWarnings(res.scan?.warnings || []);
      setNote(`Scanned ${res.scan?.pages_scanned?.length || 0} public page(s). Extracted ${res.scan?.candidate_tokens?.length || 0} candidate token(s) marked for review.`);
      await loadStudio();
      onRefreshOverview();
    } catch (e: any) {
      setError(e.message || 'Website scan failed');
    } finally {
      setBusy(false);
    }
  };

  const handleTokenAction = async (tokenId: string, status: 'approved' | 'ignored', confirmRights?: boolean) => {
    setBusy(true);
    try {
      await autopilotService.updateBrandToken(tokenId, {
        approval_status: status,
        ...(confirmRights !== undefined ? { rights_confirmed: confirmRights } : {}),
      });
      await loadStudio();
    } catch (e: any) {
      setError(e.message || 'Failed to update token');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteToken = async (tokenId: string) => {
    setBusy(true);
    try {
      await autopilotService.deleteBrandToken(tokenId);
      await loadStudio();
    } catch (e: any) {
      setError(e.message || 'Failed to delete token');
    } finally {
      setBusy(false);
    }
  };

  const handleOpenDiffModal = async () => {
    if (versions.length === 0) return;
    const latestV = brand?.current_version || versions[versions.length - 1].version;
    const prevV = versions.length > 1 ? versions[versions.length - 2].version : Math.max(1, latestV - 1);
    setDiffVersion1(prevV);
    setDiffVersion2(latestV);
    setDiffModalOpen(true);
    await fetchDiff(prevV, latestV);
  };

  const fetchDiff = async (v1: number, v2: number) => {
    setLoadingDiff(true);
    try {
      const res = await autopilotService.getBrandDiff(v1, v2);
      setDiffData(res.diff);
    } catch (e: any) {
      setError(e.message || 'Failed to compare brand versions');
    } finally {
      setLoadingDiff(false);
    }
  };

  const handleRestoreVersion = async (v: number) => {
    setRestoringVersion(true);
    try {
      const res = await autopilotService.restoreBrandVersion(v);
      hydrateBrand(res.brand);
      setNote(`Successfully restored Brand Profile to version v${v}.`);
      setDiffModalOpen(false);
      await loadStudio();
      onRefreshOverview();
    } catch (e: any) {
      setError(e.message || `Failed to restore brand version v${v}`);
    } finally {
      setRestoringVersion(false);
    }
  };

  const handleAddColorToken = async () => {
    if (!newColorName.trim() || !/^#[0-9A-Fa-f]{3,6}$/.test(newColorHex.trim())) return;
    setBusy(true);
    try {
      await autopilotService.createBrandToken({
        name: newColorName.trim(),
        category: 'color',
        sub_type: newColorRole,
        value: { hex: newColorHex.trim().toUpperCase() },
        approval_status: 'approved',
        rights_confirmed: true,
      });
      setNewColorName('');
      await loadStudio();
    } catch (e: any) {
      setError(e.message || 'Failed to add color token');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveBrandSystem = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await autopilotService.saveBrandProfile({
        brand_name: brandName.trim() || 'Workspace Brand',
        identity: {
          ...(brand?.identity ?? {}),
          positioning: positioning.trim(),
          approved_claims: approvedClaims.split('\n').map((s) => s.trim()).filter(Boolean),
        },
        visual: {
          ...(brand?.visual ?? {}),
          retired_colors: retiredColors.split(',').map((s) => s.trim()).filter(Boolean),
        },
        voice: {
          ...(brand?.voice ?? {}),
          attributes: voiceAttributes.split(',').map((s) => s.trim()).filter(Boolean),
          avoid_terms: avoidTerms.split(',').map((s) => s.trim()).filter(Boolean),
        },
        content_rules: {
          ...(brand?.content_rules ?? {}),
          logo_policy_default: logoPolicyDefault,
        },
        change_rationale: 'Updated Brand Studio rules, voice, and retired color bans',
        bump_version: true,
      });
      hydrateBrand(res.brand);
      setNote(`Saved Brand Profile v${res.brand.current_version}.`);
      await loadStudio();
      onRefreshOverview();
    } catch (e: any) {
      setError(e.message || 'Failed to save brand system');
    } finally {
      setBusy(false);
    }
  };

  const handleApproveBrand = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await autopilotService.approveBrandProfile('Approved Brand System tokens and palette for Autopilot workflows');
      hydrateBrand(res.brand);
      setNote(`Approved Brand System v${res.brand.current_version} for production workflows.`);
      await loadStudio();
      onRefreshOverview();
    } catch (e: any) {
      setError(e.message || 'Failed to approve brand profile');
    } finally {
      setBusy(false);
    }
  };

  const handleAddAsset = async () => {
    if (!assetUrl.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await autopilotService.addBrandAsset({
        name: assetName.trim() || assetType.replace(/_/g, ' '),
        url: assetUrl.trim(),
        asset_type: assetType,
        variant: assetVariant.trim() || 'default',
        mime_type: /\.(mp4|mov|webm)(\?|$)/i.test(assetUrl) ? 'video/mp4' : 'image/png',
        rights_confirmed: rightsConfirmed,
        consented_likeness: consentedLikeness,
      });
      setAssetName('');
      setAssetUrl('');
      await loadStudio();
    } catch (e: any) {
      setError(e.message || 'Failed to add brand asset');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <Loading label="Loading Brand Studio" rows={4} />;
  }

  return (
    <div className="space-y-6">
      {error && <Notice tone="danger" title="Brand Studio Error">{error}</Notice>}
      {note && <Notice tone="positive" title="Brand Studio">{note}</Notice>}
      {scanWarnings.map((w, i) => (
        <Notice key={i} tone="warn" title="Scanner Notice">{w}</Notice>
      ))}

      {/* Website Brand Intelligence Scanner */}
      <Card>
        <SectionHeading
          title="Website Brand Scanner"
          hint="Extracts candidate CSS variables, palette swatches, font families, logos, and structured metadata politely (respecting robots.txt & SSRF protections). Every extracted token stays a candidate until you approve it."
          action={
            brand && (
              <Badge tone={brand.approval_status === 'approved' ? 'positive' : 'warn'}>
                Brand v{brand.current_version} · {brand.approval_status}
              </Badge>
            )
          }
        />

        <div className="flex flex-wrap gap-3">
          <input
            className="min-w-[260px] flex-1 rounded-[10px] border border-line bg-white px-3.5 py-2.5 text-sm text-ink"
            value={scanUrl}
            onChange={(e) => setScanUrl(e.target.value)}
            placeholder="https://yourbusiness.com"
          />
          <Button variant="primary" onClick={handleScanWebsite} disabled={busy || !scanUrl.trim()}>
            {busy ? 'Scanning…' : 'Scan Public Website'}
          </Button>
          {brand && brand.approval_status !== 'approved' && (
            /* Single accent CTA on Brand Studio view */
            <Button variant="accent" onClick={handleApproveBrand} disabled={busy}>
              Approve Brand System
            </Button>
          )}
        </div>
        <div className="mt-2.5 flex items-center gap-2">
          <Toggle checked={preserveTokens} onChange={setPreserveTokens} label="Preserve previously approved tokens on re-scan" />
        </div>
      </Card>

      {/* Extracted & Custom Brand Tokens Table */}
      <Card>
        <SectionHeading
          title="Candidate & Approved Brand Tokens"
          hint="Review provenance, confidence score, and font/logo usage rights before promoting tokens into strict brand generation."
        />

        <div className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-line bg-sunken p-3.5">
          <Field label="Token Name">
            <input className="rounded-[10px] border border-line bg-white px-3 py-1.5 text-xs text-ink" value={newColorName} onChange={(e) => setNewColorName(e.target.value)} placeholder="e.g. Brand Navy" />
          </Field>
          <Field label="Hex">
            <input className="w-28 rounded-[10px] border border-line bg-white px-3 py-1.5 font-mono text-xs text-ink" value={newColorHex} onChange={(e) => setNewColorHex(e.target.value)} />
          </Field>
          <Field label="Role">
            <select className="rounded-[10px] border border-line bg-white px-3 py-1.5 text-xs text-ink" value={newColorRole} onChange={(e) => setNewColorRole(e.target.value)}>
              <option value="primary">primary</option>
              <option value="accent">accent</option>
              <option value="background">background</option>
              <option value="surface">surface</option>
              <option value="text">text</option>
              <option value="border">border</option>
            </select>
          </Field>
          <Button variant="secondary" size="sm" onClick={handleAddColorToken} disabled={busy}>
            Add Approved Color
          </Button>
        </div>

        {tokens.length === 0 ? (
          <EmptyState message="No brand tokens yet. Scan a public website or add your brand palette tokens manually above." />
        ) : (
          <Table>
            <Thead>
              <Th>Token</Th>
              <Th>Category</Th>
              <Th>Value</Th>
              <Th>Provenance & Confidence</Th>
              <Th>Status</Th>
              <Th align="right">Actions</Th>
            </Thead>
            <tbody>
              {tokens.map((t) => (
                <Tr key={t.id}>
                  <Td>
                    <div className="font-medium text-ink">{t.name}</div>
                    {t.notes && <div className="text-xs text-muted">{t.notes}</div>}
                    {!t.rights_confirmed && (
                      <span className="inline-block mt-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
                        Rights Unconfirmed
                      </span>
                    )}
                  </Td>
                  <Td>
                    <span className="font-mono text-xs text-muted">{t.category}/{t.sub_type}</span>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      {t.value?.hex && (
                        <span
                          className="inline-block h-4 w-4 rounded border border-line"
                          style={{ backgroundColor: t.value.hex }}
                        />
                      )}
                      <span className="font-mono text-xs text-ink">
                        {t.value?.hex || t.value?.family || t.value?.url || JSON.stringify(t.value).slice(0, 48)}
                      </span>
                    </div>
                  </Td>
                  <Td>
                    <div className="font-mono text-xs text-ink">{t.source_type} · {Math.round((t.confidence || 0) * 100)}%</div>
                    {t.source_url && <div className="max-w-[180px] truncate text-[11px] text-muted">{t.source_url}</div>}
                  </Td>
                  <Td>
                    <Badge tone={t.approval_status === 'approved' ? 'positive' : t.approval_status === 'ignored' ? 'muted' : 'warn'}>
                      {t.approval_status}
                    </Badge>
                  </Td>
                  <Td align="right">
                    <div className="flex justify-end gap-1.5">
                      {t.approval_status !== 'approved' && (
                        <Button variant="secondary" size="sm" onClick={() => handleTokenAction(t.id, 'approved', true)} disabled={busy}>
                          Approve
                        </Button>
                      )}
                      {t.approval_status !== 'ignored' && (
                        <Button variant="ghost" size="sm" onClick={() => handleTokenAction(t.id, 'ignored')} disabled={busy}>
                          Ignore
                        </Button>
                      )}
                      <Button variant="danger" size="sm" onClick={() => void handleDeleteToken(t.id)} disabled={busy}>
                        Delete
                      </Button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* Brand Identity, Voice & Guardrails */}
      <Card>
        <SectionHeading
          title="Brand Voice, Retired Colors & Factuality Rules"
          hint="Versioned rules enforced by the QA & Policy Gate across graphics, carousels, Reels, and product demos."
          action={
            <div className="flex flex-wrap items-center gap-2">
              {versions.length > 0 && (
                <Button variant="secondary" size="sm" onClick={handleOpenDiffModal} disabled={busy}>
                  Compare & Restore Versions
                </Button>
              )}
              <Button variant="primary" size="sm" onClick={handleSaveBrandSystem} disabled={busy}>
                Save Brand Version
              </Button>
            </div>
          }
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Brand Name">
            <input className="w-full rounded-[10px] border border-line bg-white px-3.5 py-2 text-sm text-ink" value={brandName} onChange={(e) => setBrandName(e.target.value)} />
          </Field>
          <Field label="Default Logo Policy" hint="Can be overridden per Creative Brief (always | contextual | never)">
            <select className="w-full rounded-[10px] border border-line bg-white px-3.5 py-2 text-sm text-ink" value={logoPolicyDefault} onChange={(e) => setLogoPolicyDefault(e.target.value as any)}>
              <option value="contextual">Contextual (cover/closing slides & branded graphics)</option>
              <option value="always">Always apply deterministic logo master</option>
              <option value="never">Never overlay logo by default</option>
            </select>
          </Field>
          <Field label="Brand Positioning" full>
            <input className="w-full rounded-[10px] border border-line bg-white px-3.5 py-2 text-sm text-ink" value={positioning} onChange={(e) => setPositioning(e.target.value)} placeholder="Concise statement of how your brand should be perceived" />
          </Field>
          <Field label="Voice Attributes (comma-separated)">
            <input className="w-full rounded-[10px] border border-line bg-white px-3.5 py-2 text-sm text-ink" value={voiceAttributes} onChange={(e) => setVoiceAttributes(e.target.value)} placeholder="Clear, Calmly authoritative, Practical" />
          </Field>
          <Field label="Prohibited Voice Phrases (comma-separated)" hint="Blocked automatically by Brand Compliance Gate">
            <input className="w-full rounded-[10px] border border-line bg-white px-3.5 py-2 text-sm text-ink" value={avoidTerms} onChange={(e) => setAvoidTerms(e.target.value)} placeholder="guaranteed viral, 10x overnight, secret hack" />
          </Field>
          <Field label="Retired Brand Colors (comma-separated hex or names)" hint="Blocked from re-entering prompts or overlays">
            <input className="w-full rounded-[10px] border border-line bg-white px-3.5 py-2 font-mono text-xs text-ink" value={retiredColors} onChange={(e) => setRetiredColors(e.target.value)} placeholder="e.g. #84CC16, lime, bronze" />
          </Field>
          <Field label="Approved Verifiable Claims (one per line)">
            <textarea rows={3} className="w-full rounded-[10px] border border-line bg-white px-3.5 py-2 text-xs text-ink" value={approvedClaims} onChange={(e) => setApprovedClaims(e.target.value)} placeholder="Only include factual claims backed by real product capabilities or verified evidence" />
          </Field>
        </div>

        {versions.length > 0 && (
          <div className="mt-4 border-t border-line pt-3 font-mono text-[11px] text-muted">
            Version history: {versions.map((v) => `v${v.version} (${v.change_rationale})`).join(' · ')}
          </div>
        )}
      </Card>

      {/* Brand Asset Vault (Logos, Real Product Screenshots, Consented Footage) */}
      <Card>
        <SectionHeading
          title="Approved Brand & Product Asset Vault"
          hint="Upload official logo masters (never redrawn by AI!), real product UI captures for Workflow D, and consented founder/product media."
        />

        <div className="mb-4 grid gap-3 rounded-xl border border-line bg-sunken p-4 sm:grid-cols-3">
          <Field label="Asset Type">
            <select className="w-full rounded-[10px] border border-line bg-white px-3 py-2 text-xs text-ink" value={assetType} onChange={(e) => setAssetType(e.target.value as any)}>
              <option value="logo">Official Logo Master</option>
              <option value="product_screenshot">Real Product Screenshot (Workflow D)</option>
              <option value="video_capture">Real Screen / Demo Video Capture</option>
              <option value="product_photo">Product Photography</option>
              <option value="founder_footage">Founder / Team Footage</option>
              <option value="style_reference">Visual Style Reference</option>
            </select>
          </Field>
          <Field label="Asset Name">
            <input className="w-full rounded-[10px] border border-line bg-white px-3 py-2 text-xs text-ink" value={assetName} onChange={(e) => setAssetName(e.target.value)} placeholder="e.g. Primary Lockup on Light" />
          </Field>
          <Field label="Variant / Context">
            <input className="w-full rounded-[10px] border border-line bg-white px-3 py-2 text-xs text-ink" value={assetVariant} onChange={(e) => setAssetVariant(e.target.value)} placeholder="lockup-on-light, dashboard-capture" />
          </Field>
          <Field label="Public HTTPS or Media Library URL" full>
            <input className="w-full rounded-[10px] border border-line bg-white px-3 py-2 font-mono text-xs text-ink" value={assetUrl} onChange={(e) => setAssetUrl(e.target.value)} placeholder="https://..." />
          </Field>
          <div className="flex flex-col justify-center gap-2">
            <Toggle checked={rightsConfirmed} onChange={setRightsConfirmed} label="Commercial rights confirmed" />
            {assetType === 'founder_footage' && (
              <Toggle checked={consentedLikeness} onChange={setConsentedLikeness} label="Human likeness consent confirmed" />
            )}
          </div>
          <div className="sm:col-span-3 flex justify-end">
            <Button variant="secondary" size="sm" onClick={handleAddAsset} disabled={busy || !assetUrl.trim()}>
              Add Asset to Vault
            </Button>
          </div>
        </div>

        {assets.length === 0 ? (
          <EmptyState message="No brand assets uploaded yet. Add logo masters or real product screenshots to ground workflows." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {assets.map((a) => (
              <div key={a.id} className="flex items-start justify-between gap-3 rounded-xl border border-line bg-white p-3.5">
                <div className="min-w-0">
                  <Badge tone="muted">{a.asset_type.replace(/_/g, ' ')}</Badge>
                  <div className="mt-1.5 truncate text-sm font-medium text-ink">{a.name}</div>
                  <div className="truncate font-mono text-[11px] text-muted">{a.url}</div>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    await autopilotService.deleteBrandAsset(a.id);
                    await loadStudio();
                  }}
                  className="text-xs text-muted hover:text-danger-text"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Brand Version Diff & Restore Modal */}
      <Modal
        open={diffModalOpen}
        onClose={() => setDiffModalOpen(false)}
        title="Brand System Version Diff & Rollback"
        subtitle="Compare historical brand profiles against the current baseline and restore earlier rules or palettes with audit tracking."
      >
        <div className="space-y-4 text-xs">
          <div className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-sunken p-3">
            <Field label="Version to Inspect / Restore">
              <select
                className="rounded-[10px] border border-line bg-white px-3 py-1.5 font-mono text-xs text-ink"
                value={diffVersion1}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setDiffVersion1(v);
                  void fetchDiff(v, diffVersion2);
                }}
              >
                {versions.map((ver) => (
                  <option key={ver.version} value={ver.version}>
                    v{ver.version} ({new Date(ver.created_at).toLocaleDateString()})
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Compare Against">
              <select
                className="rounded-[10px] border border-line bg-white px-3 py-1.5 font-mono text-xs text-ink"
                value={diffVersion2}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setDiffVersion2(v);
                  void fetchDiff(diffVersion1, v);
                }}
              >
                {versions.map((ver) => (
                  <option key={ver.version} value={ver.version}>
                    v{ver.version} ({new Date(ver.created_at).toLocaleDateString()})
                  </option>
                ))}
              </select>
            </Field>

            <Button
              variant="secondary"
              size="sm"
              onClick={() => void fetchDiff(diffVersion1, diffVersion2)}
              disabled={loadingDiff}
            >
              {loadingDiff ? 'Calculating Diff…' : 'Refresh Comparison'}
            </Button>
          </div>

          {loadingDiff ? (
            <Loading label="Computing version diff" rows={2} />
          ) : diffData ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-line bg-white p-3 space-y-2">
                <Eyebrow>IDENTITY & POSITIONING</Eyebrow>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded border border-line bg-sunken p-2">
                    <span className="font-mono text-[10px] text-muted">v{diffVersion1}:</span>
                    <div className="text-ink mt-0.5">{diffData.v1?.identity?.positioning || '(none)'}</div>
                  </div>
                  <div className="rounded border border-line bg-sunken p-2">
                    <span className="font-mono text-[10px] text-muted">v{diffVersion2}:</span>
                    <div className="text-ink mt-0.5">{diffData.v2?.identity?.positioning || '(none)'}</div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-line bg-white p-3 space-y-2">
                <Eyebrow>VOICE ATTRIBUTES & PROHIBITED TERMS</Eyebrow>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <span className="font-mono text-[10px] text-muted">Added in v{diffVersion2}:</span>
                    <div className="text-positive-text font-mono mt-0.5">
                      {diffData.voice_attributes_added?.length ? diffData.voice_attributes_added.join(', ') : 'None'}
                    </div>
                  </div>
                  <div>
                    <span className="font-mono text-[10px] text-muted">Removed in v{diffVersion2}:</span>
                    <div className="text-danger-text font-mono mt-0.5">
                      {diffData.voice_attributes_removed?.length ? diffData.voice_attributes_removed.join(', ') : 'None'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-line bg-white p-3 space-y-2">
                <Eyebrow>RETIRED COLOR BANS</Eyebrow>
                <div className="text-muted text-[11px]">
                  v{diffVersion1}: {(diffData.v1?.visual?.retired_colors || []).join(', ') || 'None'}
                </div>
                <div className="text-muted text-[11px]">
                  v{diffVersion2}: {(diffData.v2?.visual?.retired_colors || []).join(', ') || 'None'}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-muted text-center py-4">Select versions above to view diff.</div>
          )}

          <div className="flex items-center justify-between pt-3 border-t border-line">
            <Button variant="secondary" size="sm" onClick={() => setDiffModalOpen(false)}>
              Close
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleRestoreVersion(diffVersion1)}
              disabled={restoringVersion || (brand?.current_version === diffVersion1)}
            >
              {restoringVersion
                ? 'Restoring…'
                : brand?.current_version === diffVersion1
                  ? `v${diffVersion1} is Current Baseline`
                  : `Restore Version v${diffVersion1}`}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
