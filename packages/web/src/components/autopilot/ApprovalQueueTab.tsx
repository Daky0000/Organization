import { useCallback, useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CopyButton,
  EmptyState,
  Eyebrow,
  Field,
  Loading,
  Notice,
  SectionHeading,
} from '../ui';
import { PlatformPreviewTabs } from '../posts/PlatformPreviewTabs';
import { autopilotService } from '../../services/autopilotService';

interface Props {
  onRefreshOverview: () => void;
  onOpenPublishing: () => void;
}

export default function ApprovalQueueTab({ onRefreshOverview, onOpenPublishing }: Props) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [items, setItems] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [scheduleIso, setScheduleIso] = useState(() => {
    const d = new Date(Date.now() + 24 * 3600_000);
    return d.toISOString().slice(0, 16);
  });

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await autopilotService.listItems();
      const reviewable = (res.items || []).filter((i: any) =>
        ['review_required', 'draft_ready', 'approved', 'needs_changes'].includes(i.lifecycle_state),
      );
      setItems(reviewable);
      if (reviewable.length > 0 && (!selectedId || !reviewable.some((x: any) => x.id === selectedId))) {
        setSelectedId(reviewable[0].id);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to load Approval Queue');
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  const activeItem = items.find((i) => i.id === selectedId) || null;

  const handleDecision = async (action: 'approve' | 'changes' | 'reject') => {
    if (!activeItem) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      if (action === 'approve') {
        await autopilotService.approveItem(activeItem.id, reviewNotes);
        setNote(`Approved "${activeItem.title}". Ready for named-slot scheduling.`);
      } else if (action === 'changes') {
        await autopilotService.requestItemChanges(activeItem.id, reviewNotes);
        setNote(`Marked "${activeItem.title}" as Needs Changes.`);
      } else {
        await autopilotService.rejectItem(activeItem.id, reviewNotes);
        setNote(`Rejected "${activeItem.title}".`);
      }
      setReviewNotes('');
      await loadQueue();
      onRefreshOverview();
    } catch (e: any) {
      setError(e.message || 'Review action failed');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateClientLink = async () => {
    if (!activeItem) return;
    setBusy(true);
    setError(null);
    try {
      const res = await autopilotService.createShareReviewLink(activeItem.id);
      const fullUrl = `${window.location.origin}${res.review_path}`;
      setShareUrl(fullUrl);
    } catch (e: any) {
      setError(e.message || 'Failed to create external client sign-off link');
    } finally {
      setBusy(false);
    }
  };

  const handleScheduleApproved = async () => {
    if (!activeItem) return;
    setBusy(true);
    setError(null);
    try {
      const iso = new Date(scheduleIso).toISOString();
      const res = await autopilotService.scheduleItem(activeItem.id, {
        scheduled_at: iso,
      });
      setNote(`Scheduled "${activeItem.title}" across ${res.publications.length} channel publication(s).`);
      await loadQueue();
      onRefreshOverview();
      onOpenPublishing();
    } catch (e: any) {
      setError(e.message || 'Scheduling blocked');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <Loading label="Loading Approval Queue" rows={4} />;
  }

  return (
    <div className="space-y-6">
      {error && <Notice tone="danger" title="Approval Gate Blocked">{error}</Notice>}
      {note && <Notice tone="positive" title="Approval Queue Updated">{note}</Notice>}

      {items.length === 0 ? (
        <EmptyState message="No generated drafts or review items waiting right now. Execute a workflow in the Creative Queue first." />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          {/* Left Rail: Queue Items */}
          <Card flush className="divide-y divide-line self-start">
            <div className="p-4">
              <Eyebrow>HUMAN REVIEW & SIGN-OFF QUEUE ({items.length})</Eyebrow>
            </div>
            {items.map((item) => {
              const isSelected = item.id === activeItem?.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => { setSelectedId(item.id); setShareUrl(null); }}
                  className={`block w-full p-4 text-left transition ${
                    isSelected ? 'bg-sunken' : 'bg-white hover:bg-sunken/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <Badge
                      tone={
                        item.lifecycle_state === 'approved'
                          ? 'positive'
                          : item.lifecycle_state === 'needs_changes'
                            ? 'warn'
                            : 'info'
                      }
                    >
                      {item.lifecycle_state.replace(/_/g, ' ')}
                    </Badge>
                    <span className="font-mono text-[11px] text-muted">{item.format}</span>
                  </div>
                  <div className="mt-2 font-medium text-sm text-ink">{item.title}</div>
                  {item.risk_flags?.length > 0 && (
                    <div className="mt-1.5 text-[11px] text-warn-text">
                      {item.risk_flags.slice(0, 2).join(' · ')}
                    </div>
                  )}
                </button>
              );
            })}
          </Card>

          {/* Right Panel: Full Platform Preview, Policy Checks & Sign-Off Controls */}
          {activeItem && (
            <div className="space-y-6">
              <Card>
                <SectionHeading
                  title={activeItem.title}
                  hint={`Pillar: ${activeItem.pillar_name} · Channels: ${(activeItem.target_channels || []).join(', ')} · Version v${activeItem.version}`}
                  action={
                    <div className="flex flex-wrap gap-2">
                      <Button variant="secondary" size="sm" onClick={handleCreateClientLink} disabled={busy}>
                        Share External Sign-Off Link
                      </Button>
                    </div>
                  }
                />

                {shareUrl && (
                  <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-line bg-sunken px-4 py-3 text-xs">
                    <span className="truncate font-mono text-ink">{shareUrl}</span>
                    <CopyButton text={shareUrl} label="Copy Review URL" />
                  </div>
                )}

                {/* Stale Revision Alert */}
                {activeItem.approved_content_hash &&
                  activeItem.content_hash &&
                  activeItem.approved_content_hash !== activeItem.content_hash && (
                    <div className="mb-4">
                      <Notice tone="warn" title="STALE APPROVAL REVISION">
                        This post content was modified after human sign-off (Hash changed from{' '}
                        {activeItem.approved_content_hash.slice(0, 10)}… to {activeItem.content_hash.slice(0, 10)}…). Re-approval is required before scheduling.
                      </Notice>
                    </div>
                  )}

                {/* Risk & QA Summary */}
                <div className="mb-5 grid gap-3 rounded-xl border border-line bg-sunken p-4 sm:grid-cols-4">
                  <div>
                    <Eyebrow>QA GATE SCORE</Eyebrow>
                    <div className="mt-1 font-mono text-lg font-medium text-ink">
                      {activeItem.validation_report?.score ?? '—'}/100
                    </div>
                  </div>
                  <div>
                    <Eyebrow>CONTENT HASH & DESTINATION</Eyebrow>
                    <div className="mt-1 font-mono text-[11px] text-ink truncate" title={activeItem.content_hash}>
                      {activeItem.content_hash ? `SHA: ${activeItem.content_hash.slice(0, 12)}…` : 'Pending synthesis'}
                    </div>
                    <div className="text-[10px] text-muted truncate">
                      {activeItem.approved_destination ? `Bound to: ${activeItem.approved_destination}` : 'Unbound'}
                    </div>
                  </div>
                  <div>
                    <Eyebrow>ESCALATION FLAGS</Eyebrow>
                    <div className="mt-1 text-xs text-ink">
                      {activeItem.risk_flags?.length ? activeItem.risk_flags.join(', ') : 'Standard review'}
                    </div>
                  </div>
                  <div>
                    <Eyebrow>DISCLOSURES</Eyebrow>
                    <div className="mt-1 text-xs text-ink">
                      {activeItem.disclosures?.length ? activeItem.disclosures.join(' · ') : 'None required'}
                    </div>
                  </div>
                </div>

                {/* Live Multi-Platform Social Mockup & Constraint Validator */}
                <PlatformPreviewTabs
                  caption={activeItem.caption || ''}
                  selectedPlatforms={activeItem.target_channels?.length ? activeItem.target_channels : ['instagram']}
                  mediaUrls={(activeItem.media_assets || []).map((m: any) => m.url).filter(Boolean)}
                  onCaptionChange={async (nextCaption) => {
                    const res = await autopilotService.updateItem(activeItem.id, { caption: nextCaption });
                    setItems((prev) => prev.map((x) => (x.id === activeItem.id ? res.item : x)));
                  }}
                />

                {/* Full QA Policy Issues Breakdown */}
                {activeItem.validation_report?.issues && activeItem.validation_report.issues.length > 0 && (
                  <div className="mt-5 rounded-xl border border-line bg-sunken p-4 space-y-2">
                    <Eyebrow>QA GATE POLICY ISSUES & REMEDIATION</Eyebrow>
                    <div className="space-y-1.5">
                      {activeItem.validation_report.issues.map((iss: any, idx: number) => (
                        <div key={idx} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-line bg-white p-2.5 text-xs">
                          <div>
                            <span className="font-mono text-muted mr-1">[{iss.code || iss.rule_id || 'RULE'}]</span>
                            <span className="text-ink font-medium">{iss.message}</span>
                            {iss.remediation && (
                              <div className="text-muted text-[11px] mt-0.5">Remediation: {iss.remediation}</div>
                            )}
                          </div>
                          <Badge tone={iss.severity === 'blocker' || iss.severity === 'error' ? 'danger' : 'warn'}>
                            {iss.severity}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Reviewer Decision & Scheduling Bar */}
                <div className="mt-6 space-y-4 border-t border-line pt-5">
                  <Field label="Reviewer / Compliance Notes">
                    <input
                      className="w-full rounded-[10px] border border-line bg-white px-3.5 py-2 text-xs text-ink"
                      value={reviewNotes}
                      onChange={(e) => setReviewNotes(e.target.value)}
                      placeholder="Optional sign-off rationale or requested edits…"
                    />
                  </Field>

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap gap-2">
                      <Button variant="secondary" size="sm" onClick={() => void handleDecision('changes')} disabled={busy}>
                        Request Changes
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => void handleDecision('reject')} disabled={busy}>
                        Reject
                      </Button>
                    </div>

                    {activeItem.lifecycle_state !== 'approved' ? (
                      /* Single accent CTA when awaiting approval */
                      <Button variant="accent" onClick={() => void handleDecision('approve')} disabled={busy}>
                        Approve Content Item
                      </Button>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="datetime-local"
                          className="rounded-[10px] border border-line bg-white px-3 py-2 font-mono text-xs text-ink"
                          value={scheduleIso}
                          onChange={(e) => setScheduleIso(e.target.value)}
                        />
                        {/* Single accent CTA when approved & ready to schedule */}
                        <Button variant="accent" onClick={handleScheduleApproved} disabled={busy}>
                          Schedule Publications
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
