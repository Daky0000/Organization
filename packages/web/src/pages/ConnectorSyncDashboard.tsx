import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw, Play, Plus, Trash2, ToggleLeft, ToggleRight,
  CheckCircle2, XCircle, Clock, Loader2, ArrowLeft,
  BarChart2, Database, AlertTriangle, ChevronDown, ChevronUp,
  Filter
} from 'lucide-react';

const API = '/api/connectors';
const tok = () => localStorage.getItem('auth_token') ?? '';
const authHeaders = () => ({ Authorization: `Bearer ${tok()}` });
const jsonHeaders = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` });

interface SyncJob {
  id: string;
  domain_slug: string;
  provider_slug: string;
  name: string;
  sync_type: string;
  direction: 'inbound' | 'outbound' | 'both';
  frequency: string;
  filter_config: Record<string, unknown>;
  active: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  run_count: string;
  last_run: SyncRun | null;
}

interface SyncRun {
  id: string;
  job_id: string;
  domain_slug: string;
  provider_slug: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  records_pulled: number;
  records_created: number;
  records_updated: number;
  records_skipped: number;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
  job_name?: string;
  sync_type?: string;
  frequency?: string;
}

interface SyncStats {
  completed_runs: string;
  failed_runs: string;
  running_runs: string;
  total_created: string;
  total_updated: string;
  last_run_at: string | null;
  active_jobs: number;
}

const STATUS_CONFIG = {
  completed: { icon: CheckCircle2, color: 'text-emerald-500', bg: 'bg-emerald-50', label: 'Completed' },
  failed:    { icon: XCircle,      color: 'text-red-500',     bg: 'bg-red-50',     label: 'Failed' },
  running:   { icon: Loader2,      color: 'text-[#2563EB]',   bg: 'bg-indigo-50',  label: 'Running' },
  cancelled: { icon: XCircle,      color: 'text-gray-400',    bg: 'bg-gray-50',    label: 'Cancelled' },
};

const FREQ_LABELS: Record<string, string> = {
  manual: 'Manual',
  hourly: 'Every hour',
  '6h': 'Every 6 hours',
  daily: 'Daily',
  weekly: 'Weekly',
};

function fmt(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000)  return 'just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return d.toLocaleDateString();
}

function StatusBadge({ status }: { status: SyncRun['status'] }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.cancelled;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.color}`}>
      <Icon className={`w-3 h-3 ${status === 'running' ? 'animate-spin' : ''}`} />
      {cfg.label}
    </span>
  );
}

function RunRow({ run }: { run: SyncRun }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr
        className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <td className="py-3 px-4 text-sm text-gray-700">{run.job_name || run.domain_slug}</td>
        <td className="py-3 px-4">
          <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{run.domain_slug}</span>
        </td>
        <td className="py-3 px-4 text-xs text-gray-400">{run.provider_slug}</td>
        <td className="py-3 px-4"><StatusBadge status={run.status} /></td>
        <td className="py-3 px-4 text-xs text-gray-500">{fmt(run.started_at)}</td>
        <td className="py-3 px-4 text-xs text-gray-400">
          {run.completed_at
            ? `${Math.round((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000)}s`
            : '—'}
        </td>
        <td className="py-3 px-4 text-xs text-gray-500">
          {run.records_created > 0 && <span className="text-emerald-600">+{run.records_created} </span>}
          {run.records_updated > 0 && <span className="text-[#2563EB]">~{run.records_updated} </span>}
          {run.records_pulled > 0 && <span className="text-gray-400">{run.records_pulled} pulled</span>}
          {!run.records_created && !run.records_updated && !run.records_pulled && '—'}
        </td>
        <td className="py-3 px-4 text-gray-300 text-xs">
          {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </td>
      </tr>
      {open && run.error_message && (
        <tr className="bg-red-50">
          <td colSpan={8} className="py-2 px-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <code className="text-xs text-red-700 font-mono whitespace-pre-wrap">{run.error_message}</code>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function ConnectorSyncDashboard({ onBack }: { onBack?: () => void }) {
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [stats, setStats] = useState<SyncStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState<string | null>(null);
  const [domainFilter, setDomainFilter] = useState('');
  const [showNewJob, setShowNewJob] = useState(false);
  const [savingJob, setSavingJob] = useState(false);
  const [newJob, setNewJob] = useState({
    name: '',
    domain_slug: '',
    provider_slug: '',
    sync_type: 'contacts',
    direction: 'inbound',
    frequency: 'daily',
  });

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [jobsR, runsR, statsR] = await Promise.all([
        fetch(`${API}/sync/jobs`, { headers: authHeaders() }),
        fetch(`${API}/sync/runs?limit=50`, { headers: authHeaders() }),
        fetch(`${API}/sync/stats`, { headers: authHeaders() }),
      ]);
      if (jobsR.ok) setJobs(await jobsR.json());
      if (runsR.ok) setRuns(await runsR.json());
      if (statsR.ok) setStats(await statsR.json());
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadAll(); }, []);

  const triggerRun = async (jobId: string) => {
    setTriggering(jobId);
    try {
      const r = await fetch(`${API}/sync/jobs/${jobId}/run`, { method: 'POST', headers: authHeaders() });
      if (r.ok) {
        setTimeout(loadAll, 800);
      } else {
        const body = await r.json().catch(() => null);
        alert(body?.error || 'Sync could not be started.');
      }
    } finally { setTriggering(null); }
  };

  const toggleJob = async (job: SyncJob) => {
    await fetch(`${API}/sync/jobs/${job.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ active: !job.active }),
    });
    setJobs(prev => prev.map(j => j.id === job.id ? { ...j, active: !j.active } : j));
  };

  const deleteJob = async (id: string) => {
    if (!confirm('Delete this sync job?')) return;
    await fetch(`${API}/sync/jobs/${id}`, { method: 'DELETE', headers: authHeaders() });
    setJobs(prev => prev.filter(j => j.id !== id));
  };

  const createJob = async () => {
    if (!newJob.name.trim() || !newJob.domain_slug || !newJob.provider_slug) return;
    setSavingJob(true);
    try {
      const r = await fetch(`${API}/sync/jobs`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify(newJob),
      });
      if (r.ok) {
        setShowNewJob(false);
        setNewJob({ name: '', domain_slug: '', provider_slug: '', sync_type: 'contacts', direction: 'inbound', frequency: 'daily' });
        loadAll();
      } else {
        const err = await r.json();
        alert(err.error || 'Failed to create job');
      }
    } finally { setSavingJob(false); }
  };

  const filteredRuns = domainFilter ? runs.filter(r => r.domain_slug === domainFilter) : runs;
  const domains = [...new Set(runs.map(r => r.domain_slug))];

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-8 py-5">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            {onBack && (
              <button onClick={onBack} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <div>
              <h1 className="text-xl font-bold text-gray-900">Sync Dashboard</h1>
              <p className="text-xs text-gray-400 mt-0.5">Monitor and manage data sync jobs across all connectors.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadAll}
              disabled={loading}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => setShowNewJob(v => !v)}
              className="flex items-center gap-2 px-4 py-2 bg-[#2563EB] text-white rounded-lg text-sm font-medium hover:bg-[#4a5be8] transition-colors"
            >
              <Plus className="w-4 h-4" /> New Job
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8 space-y-6">

        {/* Stats cards */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {[
              { label: 'Active Jobs',    value: stats.active_jobs,                      icon: Play,         color: 'text-[#2563EB]', bg: 'bg-indigo-50' },
              { label: 'Completed Runs', value: parseInt(stats.completed_runs),          icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50' },
              { label: 'Failed Runs',    value: parseInt(stats.failed_runs),             icon: XCircle,      color: 'text-red-500',    bg: 'bg-red-50' },
              { label: 'Running Now',    value: parseInt(stats.running_runs),            icon: Loader2,      color: 'text-amber-500',  bg: 'bg-amber-50' },
              { label: 'Records Created',value: parseInt(stats.total_created),          icon: Database,     color: 'text-emerald-600', bg: 'bg-emerald-50' },
              { label: 'Records Updated',value: parseInt(stats.total_updated),          icon: BarChart2,    color: 'text-[#2563EB]', bg: 'bg-indigo-50' },
            ].map(s => {
              const Icon = s.icon;
              return (
                <div key={s.label} className="bg-white rounded-xl border border-gray-100 p-4">
                  <div className={`w-8 h-8 rounded-lg ${s.bg} flex items-center justify-center mb-3`}>
                    <Icon className={`w-4 h-4 ${s.color}`} />
                  </div>
                  <div className="text-xl font-bold text-gray-900">{s.value.toLocaleString()}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{s.label}</div>
                </div>
              );
            })}
          </div>
        )}

        {/* New job form */}
        {showNewJob && (
          <div className="bg-white rounded-2xl border border-gray-100 p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Create Sync Job</h2>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="col-span-2">
                <label className="text-xs text-gray-500 mb-1 block">Job name</label>
                <input
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#2563EB]"
                  placeholder="e.g. HubSpot contact sync"
                  value={newJob.name}
                  onChange={e => setNewJob(j => ({ ...j, name: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Domain</label>
                <select
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#2563EB] bg-white"
                  value={newJob.domain_slug}
                  onChange={e => setNewJob(j => ({ ...j, domain_slug: e.target.value }))}
                >
                  <option value="">Select domain…</option>
                  {['email', 'crm', 'social', 'messaging', 'analytics', 'calendar'].map(d => (
                    <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Provider slug</label>
                <input
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#2563EB]"
                  placeholder="e.g. hubspot"
                  value={newJob.provider_slug}
                  onChange={e => setNewJob(j => ({ ...j, provider_slug: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Sync type</label>
                <select
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#2563EB] bg-white"
                  value={newJob.sync_type}
                  onChange={e => setNewJob(j => ({ ...j, sync_type: e.target.value }))}
                >
                  {['contacts', 'deals', 'companies', 'emails', 'events', 'posts', 'messages'].map(t => (
                    <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Direction</label>
                <select
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#2563EB] bg-white"
                  value={newJob.direction}
                  onChange={e => setNewJob(j => ({ ...j, direction: e.target.value }))}
                >
                  <option value="inbound">Inbound (pull from provider)</option>
                  <option value="outbound">Outbound (push to provider)</option>
                  <option value="both">Bidirectional</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Frequency</label>
                <select
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-[#2563EB] bg-white"
                  value={newJob.frequency}
                  onChange={e => setNewJob(j => ({ ...j, frequency: e.target.value }))}
                >
                  {Object.entries(FREQ_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowNewJob(false)} className="text-sm px-4 py-2 text-gray-500 hover:text-gray-700 transition-colors">
                Cancel
              </button>
              <button
                onClick={createJob}
                disabled={savingJob || !newJob.name.trim() || !newJob.domain_slug || !newJob.provider_slug}
                className="text-sm px-4 py-2 bg-[#2563EB] text-white rounded-lg hover:bg-[#4a5be8] disabled:opacity-50 transition-colors"
              >
                {savingJob ? 'Creating…' : 'Create job'}
              </button>
            </div>
          </div>
        )}

        {/* Jobs list */}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-50">
            <h2 className="font-semibold text-gray-900">Sync Jobs</h2>
            <span className="text-xs text-gray-400">{jobs.length} job{jobs.length !== 1 ? 's' : ''}</span>
          </div>

          {loading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map(i => <div key={i} className="h-14 bg-gray-100 rounded-xl animate-pulse" />)}
            </div>
          ) : jobs.length === 0 ? (
            <div className="text-center py-12">
              <RefreshCw className="w-10 h-10 text-gray-200 mx-auto mb-3" />
              <p className="text-sm text-gray-400">No sync jobs yet.</p>
              <button
                onClick={() => setShowNewJob(true)}
                className="mt-3 text-sm text-[#2563EB] hover:underline"
              >
                Create your first sync job
              </button>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {jobs.map(job => (
                <div key={job.id} className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50 transition-colors">
                  <button
                    onClick={() => toggleJob(job)}
                    className={`flex-shrink-0 transition-colors ${job.active ? 'text-[#2563EB]' : 'text-gray-300'}`}
                    title={job.active ? 'Disable' : 'Enable'}
                  >
                    {job.active ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-medium text-gray-800 truncate">{job.name}</span>
                      <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full flex-shrink-0">{job.domain_slug}</span>
                      <span className="text-xs text-gray-400 flex-shrink-0">{job.provider_slug}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-400">
                      <span>{FREQ_LABELS[job.frequency] || job.frequency}</span>
                      <span>·</span>
                      <span>{job.sync_type}</span>
                      <span>·</span>
                      <span>{job.direction}</span>
                      {job.last_run && (
                        <>
                          <span>·</span>
                          <span>Last: {fmt(job.last_run.started_at)}</span>
                          <StatusBadge status={job.last_run.status} />
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {job.next_run_at && job.frequency !== 'manual' && (
                      <span className="text-xs text-gray-400 hidden sm:block">
                        Next: {fmt(job.next_run_at)}
                      </span>
                    )}
                    <button
                      onClick={() => triggerRun(job.id)}
                      disabled={triggering === job.id}
                      title="Run now"
                      className="p-1.5 text-gray-400 hover:text-[#2563EB] hover:bg-indigo-50 rounded-lg transition-colors"
                    >
                      {triggering === job.id
                        ? <Loader2 className="w-4 h-4 animate-spin text-[#2563EB]" />
                        : <Play className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => deleteJob(job.id)}
                      className="p-1.5 text-gray-300 hover:text-red-400 hover:bg-red-50 rounded-lg transition-colors"
                      title="Delete job"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Run history */}
        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-50">
            <h2 className="font-semibold text-gray-900">Run History</h2>
            <div className="flex items-center gap-2">
              {domains.length > 1 && (
                <div className="flex items-center gap-1.5 text-xs text-gray-400">
                  <Filter className="w-3.5 h-3.5" />
                  <select
                    className="border-0 bg-transparent text-xs text-gray-600 focus:outline-none"
                    value={domainFilter}
                    onChange={e => setDomainFilter(e.target.value)}
                  >
                    <option value="">All domains</option>
                    {domains.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              )}
              <span className="text-xs text-gray-400">{filteredRuns.length} run{filteredRuns.length !== 1 ? 's' : ''}</span>
            </div>
          </div>

          {loading ? (
            <div className="p-6 space-y-2">
              {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />)}
            </div>
          ) : filteredRuns.length === 0 ? (
            <div className="text-center py-12">
              <Clock className="w-10 h-10 text-gray-200 mx-auto mb-3" />
              <p className="text-sm text-gray-400">No sync runs yet.</p>
              <p className="text-xs text-gray-300 mt-1">Trigger a job above to see run history here.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-gray-50">
                    {['Job', 'Domain', 'Provider', 'Status', 'Started', 'Duration', 'Records', ''].map(h => (
                      <th key={h} className="py-2.5 px-4 text-xs font-medium text-gray-400">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRuns.map(run => <RunRow key={run.id} run={run} />)}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
