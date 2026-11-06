import { useCallback, useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Drawer,
  EmptyState,
  Field,
  Loading,
  Modal,
  Notice,
  RelativeTime,
  SectionHeading,
  Table,
  Td,
  Th,
  Thead,
  Tr,
} from '../ui';
import { autopilotService } from '../../services/autopilotService';
import { API_BASE_URL } from '../../utils/apiBase';

interface Props {
  onRefreshOverview: () => void;
}

export default function PublishingActivityTab({ onRefreshOverview }: Props) {
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [publications, setPublications] = useState<any[]>([]);
  const [auditEvents, setAuditEvents] = useState<any[]>([]);
  const [legacyLogs, setLegacyLogs] = useState<any[]>([]);
  const [attemptsDrawer, setAttemptsDrawer] = useState<{ pub: any; attempts: any[] } | null>(null);

  // Reschedule & Purge Modal States
  const [reschedulePubId, setReschedulePubId] = useState<string | null>(null);
  const [rescheduleIso, setRescheduleIso] = useState('');
  const [purgeModalOpen, setPurgeModalOpen] = useState(false);
  const [purgeConfirmationInput, setPurgeConfirmationInput] = useState('');
  const [purging, setPurging] = useState(false);
  const [exporting, setExporting] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pubRes, auditRes, legRes] = await Promise.all([
        autopilotService.listPublications(),
        autopilotService.listAuditEvents().catch(() => ({ events: [] })),
        fetch(`${API_BASE_URL}/api/automation/logs`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('auth_token') || ''}` },
        })
          .then((r) => r.json())
          .catch(() => ({ logs: [] })),
      ]);
      setPublications(pubRes.publications || []);
      setAuditEvents(auditRes.events || []);
      setLegacyLogs(legRes.logs || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load publishing activity');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handlePublish = async (pubId: string, isRetry: boolean) => {
    setBusyId(pubId);
    setError(null);
    setNote(null);
    try {
      const res = isRetry
        ? await autopilotService.retryPublication(pubId)
        : await autopilotService.publishNow(pubId);
      if (res.deduplicated) {
        setNote(`Idempotency guard prevented duplicate post — existing remote_post_id "${res.publication.remote_post_id}" preserved.`);
      } else if (res.publication.status === 'published') {
        setNote(`Published to ${res.publication.channel} (${res.publication.platform_media_type}) · ID ${res.publication.remote_post_id}.`);
      } else {
        setError(res.publication.error_message || 'Publish failed');
      }
      await loadAll();
      onRefreshOverview();
    } catch (e: any) {
      setError(e.message || 'Publish execution failed');
    } finally {
      setBusyId(null);
    }
  };

  const handleInspectAttempts = async (pubId: string) => {
    try {
      const res = await autopilotService.getPublicationAttempts(pubId);
      setAttemptsDrawer({ pub: res.publication, attempts: res.attempts || [] });
    } catch (e: any) {
      setError(e.message || 'Failed to load attempt ledger');
    }
  };

  const handlePausePublication = async (pubId: string) => {
    setBusyId(pubId);
    try {
      await autopilotService.pausePublication(pubId);
      setNote('Publication held in queue (paused).');
      await loadAll();
    } catch (e: any) {
      setError(e.message || 'Failed to pause publication');
    } finally {
      setBusyId(null);
    }
  };

  const handleResumePublication = async (pubId: string) => {
    setBusyId(pubId);
    try {
      await autopilotService.resumePublication(pubId);
      setNote('Publication resumed and scheduled for delivery.');
      await loadAll();
    } catch (e: any) {
      setError(e.message || 'Failed to resume publication');
    } finally {
      setBusyId(null);
    }
  };

  const handleRescheduleSubmit = async () => {
    if (!reschedulePubId || !rescheduleIso) return;
    setBusyId(reschedulePubId);
    try {
      const iso = new Date(rescheduleIso).toISOString();
      await autopilotService.reschedulePublication(reschedulePubId, iso);
      setNote('Publication slot rescheduled.');
      setReschedulePubId(null);
      await loadAll();
    } catch (e: any) {
      setError(e.message || 'Failed to reschedule publication');
    } finally {
      setBusyId(null);
    }
  };

  const handleExportData = async () => {
    setExporting(true);
    try {
      const res = await autopilotService.exportTenantData();
      const blob = new Blob([JSON.stringify(res.export, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `autopilot-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setNote('Exported complete tenant autopilot records to JSON file.');
    } catch (e: any) {
      setError(e.message || 'Failed to export tenant data');
    } finally {
      setExporting(false);
    }
  };

  const handlePurgeData = async () => {
    if (purgeConfirmationInput !== 'PURGE') return;
    setPurging(true);
    try {
      await autopilotService.purgeTenantData();
      setPurgeModalOpen(false);
      setPurgeConfirmationInput('');
      setNote('Successfully purged all workspace autopilot data, profiles, and publications.');
      await loadAll();
      onRefreshOverview();
    } catch (e: any) {
      setError(e.message || 'Failed to purge tenant data');
    } finally {
      setPurging(false);
    }
  };

  if (loading) {
    return <Loading label="Loading publishing & idempotency ledger" rows={4} />;
  }

  return (
    <div className="space-y-6">
      {error && <Notice tone="danger" title="Publishing Alert">{error}</Notice>}
      {note && <Notice tone="positive" title="Publishing Update">{note}</Notice>}

      <Card>
        <SectionHeading
          title="Multi-Channel Publications & Idempotent Delivery"
          hint="Each channel schedule executes with deterministic idempotency keys, transient vs permanent error classification, and zero duplicate live posts on retry."
          action={
            <Button variant="secondary" size="sm" onClick={() => void loadAll()}>
              Refresh Ledger
            </Button>
          }
        />

        {publications.length === 0 ? (
          <EmptyState message="No scheduled or completed channel publications yet. Approve an item in the Approval Queue and assign a slot." />
        ) : (
          <Table>
            <Thead>
              <Th>Channel & Format</Th>
              <Th>Named Slot & Timezone</Th>
              <Th>Status</Th>
              <Th>Remote Post / Remediation</Th>
              <Th align="right">Actions</Th>
            </Thead>
            <tbody>
              {publications.map((p) => (
                <Tr key={p.id}>
                  <Td>
                    <div className="font-medium capitalize text-ink">{p.channel}</div>
                    <div className="font-mono text-[11px] text-muted">{p.platform_media_type}</div>
                  </Td>
                  <Td>
                    <div className="text-xs text-ink">{p.slot_name || 'Scheduled'}</div>
                    <div className="font-mono text-[11px] text-muted">
                      {p.scheduled_at ? new Date(p.scheduled_at).toLocaleString() : '—'} ({p.timezone})
                    </div>
                  </Td>
                  <Td>
                    <div className="flex flex-col gap-1 items-start">
                      <Badge
                        tone={
                          p.status === 'published'
                            ? 'positive'
                            : p.status === 'publish_failed'
                              ? 'danger'
                              : p.status === 'scheduled'
                                ? 'info'
                                : 'muted'
                        }
                      >
                        {p.status}
                      </Badge>
                      {p.paused && <Badge tone="warn">Paused</Badge>}
                      {p.reconcile_required && <Badge tone="danger">Reconcile Required</Badge>}
                    </div>
                  </Td>
                  <Td>
                    {p.remote_post_id ? (
                      <span className="font-mono text-xs text-ink">{p.remote_post_id}</span>
                    ) : p.error_message ? (
                      <span className="text-xs text-danger-text">{p.error_message}</span>
                    ) : (
                      <span className="text-xs text-muted">Awaiting execution</span>
                    )}
                  </Td>
                  <Td align="right">
                    <div className="flex justify-end gap-1.5">
                      <Button variant="ghost" size="sm" onClick={() => void handleInspectAttempts(p.id)}>
                        Attempts
                      </Button>
                      {p.status === 'scheduled' && !p.paused && (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={busyId === p.id}
                          onClick={() => void handlePausePublication(p.id)}
                        >
                          Pause
                        </Button>
                      )}
                      {p.status === 'scheduled' && p.paused && (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={busyId === p.id}
                          onClick={() => void handleResumePublication(p.id)}
                        >
                          Resume
                        </Button>
                      )}
                      {p.status === 'scheduled' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busyId === p.id}
                          onClick={() => {
                            setReschedulePubId(p.id);
                            setRescheduleIso(
                              p.scheduled_at
                                ? new Date(p.scheduled_at).toISOString().slice(0, 16)
                                : new Date(Date.now() + 86400000).toISOString().slice(0, 16),
                            );
                          }}
                        >
                          Reschedule
                        </Button>
                      )}
                      {p.status === 'scheduled' && !p.paused && (
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={busyId === p.id}
                          onClick={() => void handlePublish(p.id, false)}
                        >
                          Publish Now
                        </Button>
                      )}
                      {p.status === 'publish_failed' && (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={busyId === p.id}
                          onClick={() => void handlePublish(p.id, true)}
                        >
                          Idempotent Retry
                        </Button>
                      )}
                      {(p.status === 'scheduled' || p.status === 'pending') && (
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={busyId === p.id}
                          onClick={async () => {
                            await autopilotService.cancelPublication(p.id);
                            await loadAll();
                          }}
                        >
                          Cancel
                        </Button>
                      )}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* Audit Trail */}
      <Card>
        <SectionHeading
          title="Workspace Audit Trail"
          hint="Server-recorded history of brand scans, strategy approvals, cost-cap blocks, human sign-offs, and publishing events."
        />
        {auditEvents.length === 0 ? (
          <EmptyState message="Audit events will appear here as actions run in this workspace." />
        ) : (
          <Table>
            <Thead>
              <Th>Event</Th>
              <Th>Resource</Th>
              <Th>Role</Th>
              <Th>When</Th>
            </Thead>
            <tbody>
              {auditEvents.slice(0, 20).map((ev) => (
                <Tr key={ev.id}>
                  <Td><span className="font-mono text-xs text-ink">{ev.event_type}</span></Td>
                  <Td><span className="font-mono text-xs text-muted">{ev.resource_type}:{String(ev.resource_id).slice(0, 8)}</span></Td>
                  <Td><Badge tone="muted">{ev.actor_role || 'user'}</Badge></Td>
                  <Td><RelativeTime value={ev.created_at} /></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {/* Legacy Blog/Social Distribution Logs (preserved for continuity) */}
      {legacyLogs.length > 0 && (
        <Card>
          <SectionHeading title="Legacy Blog Distribution Logs" hint="Historical social distribution runs from Blog Posts." />
          <Table>
            <Thead>
              <Th>Post</Th>
              <Th>Platform</Th>
              <Th>Status</Th>
              <Th>Time</Th>
            </Thead>
            <tbody>
              {legacyLogs.slice(0, 15).map((log: any) => (
                <Tr key={log.id}>
                  <Td>{log.post_title || log.post_id?.slice(0, 8)}</Td>
                  <Td className="capitalize">{log.platform}</Td>
                  <Td><Badge tone={log.status === 'published' ? 'positive' : log.status === 'failed' ? 'danger' : 'muted'}>{log.status}</Badge></Td>
                  <Td><RelativeTime value={log.created_at} /></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {/* Idempotent Attempts Drawer */}
      <Drawer
        open={Boolean(attemptsDrawer)}
        onClose={() => setAttemptsDrawer(null)}
        title="Idempotent Publication Attempts"
        subtitle={attemptsDrawer ? `${attemptsDrawer.pub.channel} · ${attemptsDrawer.pub.platform_media_type}` : ''}
      >
        {attemptsDrawer && (
          <div className="space-y-3">
            {attemptsDrawer.attempts.length === 0 ? (
              <p className="text-xs text-muted">No attempts executed yet.</p>
            ) : (
              attemptsDrawer.attempts.map((a) => (
                <div key={a.id} className="rounded-xl border border-line bg-sunken p-4 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-medium text-ink">Attempt #{a.attempt_number}</span>
                    <Badge tone={a.status === 'succeeded' ? 'positive' : a.retryable ? 'warn' : 'danger'}>
                      {a.status}
                    </Badge>
                  </div>
                  <div className="mt-1.5 font-mono text-[11px] text-muted">
                    Idempotency-Key: {a.idempotency_key}
                  </div>
                  {a.error_message && <div className="mt-1 text-danger-text">{a.error_message}</div>}
                  {a.next_retry_at && (
                    <div className="mt-1 font-mono text-[11px] text-muted">
                      Next exponential backoff window: {new Date(a.next_retry_at).toLocaleString()}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </Drawer>

      {/* Tenant Autopilot Data Governance (Export & GDPR Purge) */}
      <Card>
        <SectionHeading
          title="Tenant Autopilot Data Governance"
          hint="Export complete workspace autopilot records in machine-readable JSON format, or request GDPR tenant data deletion."
        />
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <div className="text-xs text-muted">
            All brand tokens, creative briefs, media asset records, publications, and audit trail events.
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={handleExportData} disabled={exporting}>
              {exporting ? 'Exporting…' : 'Export Autopilot Data (JSON)'}
            </Button>
            <Button variant="danger" size="sm" onClick={() => setPurgeModalOpen(true)}>
              Purge Workspace Data
            </Button>
          </div>
        </div>
      </Card>

      {/* Reschedule Publication Modal */}
      <Modal
        open={Boolean(reschedulePubId)}
        onClose={() => setReschedulePubId(null)}
        title="Reschedule Publication"
        subtitle="Pick a new named calendar slot or execution timestamp."
      >
        <div className="space-y-4 text-xs">
          <Field label="New Publication Timestamp">
            <input
              type="datetime-local"
              className="w-full rounded-[10px] border border-line bg-white px-3 py-2 font-mono text-xs text-ink"
              value={rescheduleIso}
              onChange={(e) => setRescheduleIso(e.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2 border-t border-line">
            <Button variant="secondary" size="sm" onClick={() => setReschedulePubId(null)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={handleRescheduleSubmit} disabled={!rescheduleIso}>
              Save New Slot
            </Button>
          </div>
        </div>
      </Modal>

      {/* GDPR Data Purge Confirmation Modal */}
      <Modal
        open={purgeModalOpen}
        onClose={() => setPurgeModalOpen(false)}
        title="Purge Workspace Autopilot Data"
        subtitle="Irreversible action: Permanently deletes all brand profiles, tokens, briefs, items, publications, and ledger entries for this tenant."
      >
        <div className="space-y-4 text-xs">
          <Notice tone="danger" title="PERMANENT DELETION WARNING">
            This will wipe all Autopilot tables for this tenant. To confirm this action, type <strong>PURGE</strong> below.
          </Notice>
          <Field label='Type "PURGE" to confirm'>
            <input
              className="w-full rounded-[10px] border border-line bg-white px-3 py-2 font-mono text-xs text-ink uppercase"
              value={purgeConfirmationInput}
              onChange={(e) => setPurgeConfirmationInput(e.target.value)}
              placeholder="PURGE"
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2 border-t border-line">
            <Button variant="secondary" size="sm" onClick={() => setPurgeModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handlePurgeData}
              disabled={purging || purgeConfirmationInput !== 'PURGE'}
            >
              {purging ? 'Purging…' : 'Permanently Purge Data'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
