import { useEffect, useState, useCallback } from 'react';
import {
  CheckCircle, Loader2, RefreshCw, Save, Settings, Wrench,
  GitBranch, Plus, Trash2, ChevronUp, ChevronDown, X, Info,
  ArrowLeft, ToggleLeft, ToggleRight, Edit2,
  Activity, Play, SlidersHorizontal, Shield, Bell, Zap,
  AlertTriangle, AlertCircle,
} from 'lucide-react';
import { getApiBaseUrl } from '../../utils/apiBase';

// ── Shared helpers ─────────────────────────────────────────────────────────────

function tok() { return localStorage.getItem('auth_token') ?? ''; }
const BASE = () => getApiBaseUrl();

// ── Admin Platform Agent types ─────────────────────────────────────────────────

type AdminPlatformAgent = {
  id: string;
  key: string;
  name: string;
  role: string;
  tier: 'strategic' | 'operational' | 'tactical';
  model: string;
  icon: string;
  color: string;
  system_prompt: string;
  autonomy_config: Record<string, any>;
  status: 'idle' | 'running' | 'error';
  last_run_at: string | null;
  updated_at: string;
};

type AdminAgentRun = {
  id: string;
  agent_key: string;
  trigger: 'scheduled' | 'manual' | 'escalation';
  summary: string;
  decisions_made: number;
  status: 'completed' | 'failed' | 'partial';
  created_at: string;
};

type AdminNotification = {
  id: string;
  agent_key: string;
  title: string;
  body: string;
  severity: 'info' | 'warning' | 'critical';
  is_read: boolean;
  created_at: string;
};

// ── User-agents types (existing) ───────────────────────────────────────────────

type AgentTemplate = {
  id: string;
  agent_key: string;
  name: string;
  role: string;
  icon: string;
  color: string;
  base_prompt: string;
  memory_keywords: string[];
  updated_at: string;
};

type AgentTool = {
  id: string;
  key: string;
  name: string;
  description: string;
  type: 'builtin' | 'mcp' | 'api';
  config: Record<string, any>;
  enabled: boolean;
};

type WorkflowStep = {
  id: string;
  name: string;
  tool: string;
  description: string;
  prompt_template: string;
  params: Record<string, any>;
};

type AgentWorkflow = {
  id: string;
  agent_key: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  is_active: boolean;
  updated_at: string;
};

type UserAgentTabKey = 'prompt' | 'tools' | 'workflow';

// ── Constants ──────────────────────────────────────────────────────────────────

const TIER_BADGES: Record<string, string> = {
  strategic:   'bg-slate-900 text-white',
  operational: 'bg-indigo-100 text-indigo-700',
  tactical:    'bg-teal-100 text-teal-700',
};

const MODEL_LABELS: Record<string, string> = {
  'claude-opus-4-8':            'Opus 4.8',
  'claude-sonnet-5':            'Sonnet 5',
  'claude-opus-4-7':            'Opus 4.7',
  'claude-sonnet-4-6':          'Sonnet 4.6',
  'claude-haiku-4-5':           'Haiku 4.5',
  'claude-haiku-4-5-20251001':  'Haiku 4.5',
};

const MODEL_BADGES: Record<string, string> = {
  'claude-opus-4-8':            'bg-purple-50 text-purple-700',
  'claude-sonnet-5':            'bg-indigo-50 text-indigo-700',
  'claude-opus-4-7':            'bg-purple-50 text-purple-700',
  'claude-sonnet-4-6':          'bg-indigo-50 text-indigo-700',
  'claude-haiku-4-5':           'bg-teal-50 text-teal-700',
  'claude-haiku-4-5-20251001':  'bg-teal-50 text-teal-700',
};

const TOOL_TYPE_BADGE: Record<string, string> = {
  builtin: 'bg-indigo-50 text-indigo-600',
  mcp:     'bg-purple-50 text-purple-600',
  api:     'bg-emerald-50 text-emerald-600',
};

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN AGENTS SECTION
// ══════════════════════════════════════════════════════════════════════════════

function AdminAgentCard({
  agent,
  onConfigure,
}: {
  agent: AdminPlatformAgent;
  onConfigure: () => void;
}) {
  const canKeys = Object.entries(agent.autonomy_config)
    .filter(([k, v]) => k.startsWith('can_') && v === true)
    .map(([k]) => k.replace('can_', '').replace(/_/g, ' '));

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start gap-4">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-2xl font-black select-none"
          style={{ background: `${agent.color}18`, color: agent.color }}
        >
          {agent.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-black text-xl tracking-tight" style={{ color: agent.color }}>
              {agent.name}
            </span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${TIER_BADGES[agent.tier]}`}>
              {agent.tier}
            </span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${MODEL_BADGES[agent.model] ?? 'bg-slate-100 text-slate-600'}`}>
              {MODEL_LABELS[agent.model] ?? agent.model}
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-0.5">{agent.role}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <div
            className={`h-2 w-2 rounded-full ${
              agent.status === 'running' ? 'bg-amber-400 animate-pulse' :
              agent.status === 'error'   ? 'bg-red-400' :
                                           'bg-emerald-400'
            }`}
          />
          <span className="text-[11px] font-semibold text-slate-500 capitalize">{agent.status}</span>
        </div>
      </div>

      {canKeys.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {canKeys.map((k) => (
            <span key={k} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-semibold text-slate-600">
              {k}
            </span>
          ))}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between">
        <p className="text-[11px] text-slate-400">
          {agent.last_run_at
            ? `Last run ${new Date(agent.last_run_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
            : 'Never run'}
        </p>
        <button
          type="button"
          onClick={onConfigure}
          className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
        >
          <Settings size={12} /> Configure
        </button>
      </div>
    </div>
  );
}

function AdminAgentConfigModal({
  agent,
  onClose,
  onSaved,
}: {
  agent: AdminPlatformAgent;
  onClose: () => void;
  onSaved: (updated: AdminPlatformAgent) => void;
}) {
  type ConfigTab = 'prompt' | 'runs' | 'settings';
  const [tab, setTab] = useState<ConfigTab>('prompt');
  const [prompt, setPrompt] = useState(agent.system_prompt);
  const [model, setModel] = useState(agent.model);
  const [runs, setRuns] = useState<AdminAgentRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (tab !== 'runs') return;
    setRunsLoading(true);
    fetch(`${BASE()}/api/admin/platform-agents/${agent.key}/runs`, {
      headers: { Authorization: `Bearer ${tok()}` },
    })
      .then((r) => r.json())
      .then((d) => { if (d.success) setRuns(d.runs ?? []); })
      .catch(() => {})
      .finally(() => setRunsLoading(false));
  }, [tab, agent.key]);

  const save = async () => {
    setSaving(true); setSaved(false); setError(null);
    try {
      const res = await fetch(`${BASE()}/api/admin/platform-agents/${agent.key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
        body: JSON.stringify({ system_prompt: prompt, model }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error ?? 'Save failed');
      onSaved(d.agent);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const triggerRun = async () => {
    setTriggering(true); setError(null);
    try {
      const res = await fetch(`${BASE()}/api/admin/platform-agents/${agent.key}/run`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tok()}` },
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error ?? 'Run failed');
      setTab('runs');
      // Reload runs
      setRunsLoading(true);
      fetch(`${BASE()}/api/admin/platform-agents/${agent.key}/runs`, {
        headers: { Authorization: `Bearer ${tok()}` },
      })
        .then((r) => r.json())
        .then((rd) => { if (rd.success) setRuns(rd.runs ?? []); })
        .finally(() => setRunsLoading(false));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setTriggering(false);
    }
  };

  const TABS: { key: ConfigTab; label: string; icon: React.ReactNode }[] = [
    { key: 'prompt',   label: 'System Prompt',  icon: <Settings size={13} /> },
    { key: 'runs',     label: 'Decision Log',   icon: <Activity size={13} /> },
    { key: 'settings', label: 'Settings',       icon: <SlidersHorizontal size={13} /> },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="relative flex w-full max-w-2xl flex-col rounded-2xl bg-white shadow-xl max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4 shrink-0">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-2xl font-black select-none"
            style={{ background: `${agent.color}18`, color: agent.color }}
          >
            {agent.icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-black text-slate-900 text-base" style={{ color: agent.color }}>{agent.name}</p>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${TIER_BADGES[agent.tier]}`}>
                {agent.tier}
              </span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${MODEL_BADGES[agent.model] ?? 'bg-slate-100 text-slate-600'}`}>
                {MODEL_LABELS[agent.model] ?? agent.model}
              </span>
            </div>
            <p className="text-xs text-slate-500">{agent.role}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-slate-100 px-5 pt-3 shrink-0">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-xs font-semibold transition-colors ${
                tab === t.key ? 'border-b-2 text-slate-900' : 'text-slate-500 hover:text-slate-800'
              }`}
              style={tab === t.key ? { borderColor: agent.color, color: agent.color } : {}}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">

          {tab === 'prompt' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">
                Core identity and instruction set for {agent.name}. This prompt defines the agent's goals, authority, and behavior. Changes take effect on the next run.
              </p>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={13}
                className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-800 leading-relaxed outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-300 font-mono"
                placeholder="Enter agent system prompt…"
              />
              {error && <p className="text-xs text-red-600">{error}</p>}
              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={saving}
                  onClick={save}
                  className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white transition-colors disabled:opacity-50"
                  style={{ background: saved ? '#10B981' : agent.color }}
                >
                  {saving ? <><RefreshCw size={12} className="animate-spin" /> Saving…</> :
                   saved   ? <><CheckCircle size={12} /> Saved</> :
                             <><Save size={12} /> Save Prompt</>}
                </button>
              </div>
            </div>
          )}

          {tab === 'runs' && (
            <div className="space-y-3">
              {runsLoading ? (
                <div className="flex items-center justify-center py-10 text-slate-400">
                  <Loader2 size={16} className="animate-spin mr-2" /> Loading runs…
                </div>
              ) : runs.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 py-14 text-center">
                  <Activity size={28} className="mx-auto text-slate-300 mb-3" />
                  <p className="text-sm font-semibold text-slate-400">No runs yet</p>
                  <p className="text-xs text-slate-400 mt-1">Trigger a manual run to generate the first digest.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {runs.map((run) => (
                    <div key={run.id} className="rounded-xl border border-slate-200 bg-white p-4">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                          run.status === 'completed' ? 'bg-emerald-50 text-emerald-600' :
                          run.status === 'failed'    ? 'bg-red-50 text-red-600' :
                                                       'bg-amber-50 text-amber-600'
                        }`}>{run.status}</span>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                          run.trigger === 'manual'     ? 'bg-blue-50 text-blue-600' :
                          run.trigger === 'escalation' ? 'bg-orange-50 text-orange-600' :
                                                         'bg-slate-100 text-slate-500'
                        }`}>{run.trigger}</span>
                        {run.decisions_made > 0 && (
                          <span className="text-[10px] font-semibold text-slate-500">
                            {run.decisions_made} decision{run.decisions_made !== 1 ? 's' : ''}
                          </span>
                        )}
                        <span className="ml-auto text-[10px] text-slate-400">
                          {new Date(run.created_at).toLocaleString(undefined, {
                            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">{run.summary}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'settings' && (
            <div className="space-y-5">
              <div>
                <p className="text-xs font-bold text-slate-700 mb-2">AI Model</p>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'claude-opus-4-7',           label: 'Opus 4.7',   desc: 'Strategic decisions' },
                    { id: 'claude-sonnet-4-6',          label: 'Sonnet 4.6', desc: 'Daily operations' },
                    { id: 'claude-haiku-4-5-20251001',  label: 'Haiku 4.5',  desc: 'Monitoring loops' },
                  ].map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setModel(m.id)}
                      className={`flex flex-col items-start rounded-xl border p-3 text-left transition-colors ${
                        model === m.id
                          ? 'border-indigo-300 bg-indigo-50'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <p className="text-xs font-bold text-slate-900">{m.label}</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">{m.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-bold text-slate-700 mb-3">Autonomy Configuration</p>
                <div className="space-y-2.5">
                  {Object.entries(agent.autonomy_config).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between">
                      <p className="text-xs text-slate-600 font-mono">{k}</p>
                      <p className={`text-xs font-bold ${typeof v === 'boolean' && v ? 'text-emerald-600' : typeof v === 'boolean' ? 'text-slate-400' : 'text-slate-700'}`}>
                        {typeof v === 'boolean' ? (v ? 'Enabled' : 'Disabled') : String(v)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {error && <p className="text-xs text-red-600">{error}</p>}
              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={saving}
                  onClick={save}
                  className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white transition-colors disabled:opacity-50"
                  style={{ background: saved ? '#10B981' : agent.color }}
                >
                  {saving ? <><RefreshCw size={12} className="animate-spin" /> Saving…</> :
                   saved   ? <><CheckCircle size={12} /> Saved</> :
                             <><Save size={12} /> Save Settings</>}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-100 px-5 py-3 flex items-center justify-between shrink-0">
          <p className="text-[11px] text-slate-400">
            {agent.last_run_at
              ? `Last run: ${new Date(agent.last_run_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
              : 'Never run'}
          </p>
          <button
            type="button"
            disabled={triggering}
            onClick={triggerRun}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
          >
            {triggering
              ? <><Loader2 size={11} className="animate-spin" /> Running…</>
              : <><Play size={11} /> Run Now</>}
          </button>
        </div>
      </div>
    </div>
  );
}

function AdminAgentsPanel() {
  const [agents, setAgents] = useState<AdminPlatformAgent[]>([]);
  const [notifications, setNotifications] = useState<AdminNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminPlatformAgent | null>(null);
  const [runningAll, setRunningAll] = useState(false);
  const [runAllStatus, setRunAllStatus] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch(`${BASE()}/api/admin/platform-agents`, { headers: { Authorization: `Bearer ${tok()}` } }).then((r) => r.json()),
      fetch(`${BASE()}/api/admin/platform-agents/notifications`, { headers: { Authorization: `Bearer ${tok()}` } }).then((r) => r.json()),
    ])
      .then(([ad, nd]) => {
        if (!ad.success) throw new Error(ad.error ?? 'Failed to load agents');
        setAgents(ad.agents);
        setNotifications(nd.success ? (nd.notifications ?? []) : []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const reloadNotifications = () => {
    fetch(`${BASE()}/api/admin/platform-agents/notifications`, { headers: { Authorization: `Bearer ${tok()}` } })
      .then((r) => r.json())
      .then((d) => { if (d.success) setNotifications(d.notifications ?? []); })
      .catch(() => {});
  };

  const runAllAgents = async () => {
    setRunningAll(true);
    setRunAllStatus('Starting full C-suite run…');
    const keys = agents.map((a) => a.key);
    let done = 0;
    for (const key of keys) {
      const agent = agents.find((a) => a.key === key);
      setRunAllStatus(`Running ${agent?.name ?? key} (${done + 1}/${keys.length})…`);
      try {
        await fetch(`${BASE()}/api/admin/platform-agents/${key}/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
          body: JSON.stringify({ trigger: 'manual' }),
        });
      } catch { /* continue to next */ }
      done++;
    }
    setRunAllStatus(null);
    setRunningAll(false);
    load(); // reload agents + notifications
  };

  if (loading) {
    return (
      <div className="flex items-center gap-3 py-16 justify-center text-slate-500">
        <Loader2 size={18} className="animate-spin" /> Loading admin agents…
      </div>
    );
  }
  if (error) {
    return <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">{error}</div>;
  }

  const strategic   = agents.filter((a) => a.tier === 'strategic');
  const operational = agents.filter((a) => a.tier === 'operational');
  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <div className="space-y-7">
      {/* Header row */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-lg font-black text-slate-950 tracking-[-0.02em]">Admin Agents</h3>
          <p className="text-sm text-slate-500 mt-0.5">AI-powered C-suite running Dakyworld Hub autonomously</p>
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <div className="flex items-center gap-1.5 rounded-full bg-orange-50 px-3 py-1.5 text-xs font-bold text-orange-700">
              <Bell size={12} />
              {unreadCount} alert{unreadCount !== 1 ? 's' : ''}
            </div>
          )}
          <div className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700">
            <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {agents.length} Active
          </div>
          <button
            type="button"
            disabled={runningAll}
            onClick={runAllAgents}
            className="flex items-center gap-1.5 rounded-xl bg-slate-950 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 transition-colors disabled:opacity-60"
          >
            {runningAll
              ? <><Loader2 size={12} className="animate-spin" /> Running…</>
              : <><Zap size={12} /> Run All Agents</>}
          </button>
        </div>
      </div>

      {/* Run-all progress */}
      {runAllStatus && (
        <div className="flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-xs font-semibold text-indigo-700">
          <Loader2 size={13} className="animate-spin shrink-0" />
          {runAllStatus}
        </div>
      )}

      {/* Strategic tier */}
      {strategic.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Strategic Leadership</span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {strategic.map((agent) => (
              <AdminAgentCard key={agent.key} agent={agent} onConfigure={() => setSelected(agent)} />
            ))}
          </div>
        </div>
      )}

      {/* Operational tier */}
      {operational.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Operations & Revenue</span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {operational.map((agent) => (
              <AdminAgentCard key={agent.key} agent={agent} onConfigure={() => setSelected(agent)} />
            ))}
          </div>
        </div>
      )}

      {/* Notifications feed */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-px w-8 bg-slate-200" />
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Agent Activity Feed</span>
          </div>
          <button
            type="button"
            onClick={reloadNotifications}
            className="flex items-center gap-1 text-[11px] font-semibold text-slate-400 hover:text-slate-700 transition-colors"
          >
            <RefreshCw size={11} /> Refresh
          </button>
        </div>

        {notifications.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 py-10 text-center">
            <Bell size={24} className="mx-auto text-slate-300 mb-2" />
            <p className="text-sm text-slate-400">No agent activity yet.</p>
            <p className="text-xs text-slate-400 mt-1">Run agents to generate notifications and decision logs.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {notifications.slice(0, 15).map((n) => {
              const Icon = n.severity === 'critical' ? AlertCircle : n.severity === 'warning' ? AlertTriangle : Bell;
              const colors = n.severity === 'critical'
                ? 'border-red-200 bg-red-50'
                : n.severity === 'warning'
                  ? 'border-amber-200 bg-amber-50'
                  : 'border-slate-200 bg-white';
              const iconColor = n.severity === 'critical' ? 'text-red-500' : n.severity === 'warning' ? 'text-amber-500' : 'text-slate-400';
              const agentObj = agents.find((a) => a.key === n.agent_key);
              return (
                <div key={n.id} className={`flex items-start gap-3 rounded-xl border p-4 ${colors}`}>
                  <Icon size={15} className={`${iconColor} mt-0.5 shrink-0`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-sm font-semibold text-slate-900">{n.title}</p>
                      {agentObj && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                          style={{ background: `${agentObj.color}18`, color: agentObj.color }}>
                          {agentObj.name}
                        </span>
                      )}
                    </div>
                    {n.body && <p className="text-xs text-slate-600 leading-relaxed">{n.body}</p>}
                    <p className="text-[10px] text-slate-400 mt-1">
                      {new Date(n.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Autonomy notice */}
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
        <div className="flex items-start gap-3">
          <Shield size={16} className="text-emerald-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-bold text-emerald-800 mb-1.5">Phase 2+3 — Live Intelligence & Autonomous Actions</p>
            <ul className="space-y-1.5 text-xs text-emerald-700">
              <li>• Agents analyze real platform data (users, revenue, integrations) using Claude AI.</li>
              <li>• Autonomous actions execute immediately — pricing changes, user management, content moderation.</li>
              <li>• Every decision is logged in each agent's Decision Log for full transparency.</li>
              <li>• Use "Run All Agents" for a full C-suite platform review.</li>
            </ul>
          </div>
        </div>
      </div>

      {selected && (
        <AdminAgentConfigModal
          agent={selected}
          onClose={() => setSelected(null)}
          onSaved={(updated) => {
            setAgents((prev) => prev.map((a) => a.key === updated.key ? updated : a));
            setSelected(updated);
            reloadNotifications();
          }}
        />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// USER AGENTS SECTION (existing functionality, preserved)
// ══════════════════════════════════════════════════════════════════════════════

function StepRow({
  step, index, total, tools, onChange, onDelete, onMoveUp, onMoveDown,
}: {
  step: WorkflowStep; index: number; total: number; tools: AgentTool[];
  onChange: (u: WorkflowStep) => void; onDelete: () => void;
  onMoveUp: () => void; onMoveDown: () => void;
}) {
  const [expanded, setExpanded] = useState(index === 0);
  const set = (patch: Partial<WorkflowStep>) => onChange({ ...step, ...patch });

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none hover:bg-slate-50 transition"
        onClick={() => setExpanded((p) => !p)}
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-500">
          {index + 1}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-900 truncate">{step.name || 'Unnamed step'}</p>
          <p className="text-xs text-slate-400 truncate">{tools.find((t) => t.key === step.tool)?.name ?? step.tool}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button type="button" disabled={index === 0} onClick={(e) => { e.stopPropagation(); onMoveUp(); }}
            className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-25 transition">
            <ChevronUp size={14} />
          </button>
          <button type="button" disabled={index === total - 1} onClick={(e) => { e.stopPropagation(); onMoveDown(); }}
            className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-25 transition">
            <ChevronDown size={14} />
          </button>
          <button type="button" onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="p-1 rounded text-red-400 hover:text-red-600 hover:bg-red-50 transition">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-100 px-4 py-4 space-y-3 bg-slate-50/50">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">Step Name</label>
              <input value={step.name} onChange={(e) => set({ name: e.target.value })}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-300"
                placeholder="e.g. Search Designs" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-500 mb-1">Tool</label>
              <select value={step.tool} onChange={(e) => set({ tool: e.target.value })}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-300">
                <option value="">— select tool —</option>
                {tools.filter((t) => t.enabled).map((t) => (
                  <option key={t.key} value={t.key}>{t.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Description</label>
            <input value={step.description} onChange={(e) => set({ description: e.target.value })}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-300"
              placeholder="What this step does…" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">
              Prompt Template
              <span className="ml-2 font-normal text-slate-400">
                Variables: {'{input}'} {'{brand.niche}'} {'{brand.tone}'} {'{brand.audience}'} {'{step_X.result}'}
              </span>
            </label>
            <textarea value={step.prompt_template} onChange={(e) => set({ prompt_template: e.target.value })}
              rows={4}
              className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-700 outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-300 leading-relaxed"
              placeholder="Claude instruction or query template…" />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Params (JSON)</label>
            <textarea
              value={JSON.stringify(step.params, null, 2)}
              onChange={(e) => { try { set({ params: JSON.parse(e.target.value) }); } catch { /* ignore */ } }}
              rows={2}
              className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-600 outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-300" />
          </div>
        </div>
      )}
    </div>
  );
}

function WorkflowStepEditor({
  workflow, tools, agentColor, onBack, onSaved, onDeleted,
}: {
  workflow: AgentWorkflow; tools: AgentTool[]; agentColor: string;
  onBack: () => void;
  onSaved: (updated: AgentWorkflow) => void;
  onDeleted: (id: string) => void;
}) {
  const [steps, setSteps] = useState<WorkflowStep[]>(workflow.steps);
  const [name, setName] = useState(workflow.name);
  const [description, setDescription] = useState(workflow.description);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true); setSaved(false); setError(null);
    try {
      const res = await fetch(
        `${BASE()}/api/admin/agent-workflows/${workflow.agent_key}/${workflow.id}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
          body: JSON.stringify({ name, description, steps, is_active: workflow.is_active }),
        }
      );
      const d = await res.json();
      if (!d.success) throw new Error(d.error ?? 'Save failed');
      onSaved(d.workflow);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteWorkflow = async () => {
    if (!confirm(`Delete workflow "${workflow.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await fetch(`${BASE()}/api/admin/agent-workflows/${workflow.agent_key}/${workflow.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${tok()}` },
      });
      onDeleted(workflow.id);
    } catch (e: any) {
      setError(e.message);
      setDeleting(false);
    }
  };

  const addStep = () => {
    setSteps((prev) => [
      ...prev,
      { id: `step_${Date.now()}`, name: 'New Step', tool: 'claude_synthesize', description: '', prompt_template: '', params: {} },
    ]);
  };

  const updateStep = (i: number, u: WorkflowStep) =>
    setSteps((prev) => { const next = [...prev]; next[i] = u; return next; });
  const deleteStep = (i: number) => setSteps((prev) => prev.filter((_, j) => j !== i));
  const moveStep = (i: number, dir: -1 | 1) =>
    setSteps((prev) => {
      const next = [...prev]; const t = i + dir;
      if (t < 0 || t >= next.length) return next;
      [next[i], next[t]] = [next[t], next[i]]; return next;
    });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onBack}
          className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800 transition">
          <ArrowLeft size={13} /> All Workflows
        </button>
      </div>

      <div className="space-y-2">
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1">Workflow Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800 outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-300" />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 mb-1">Description</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-300"
            placeholder="What this workflow accomplishes…" />
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-xl bg-slate-50 border border-slate-200 p-3">
        <Info size={14} className="text-slate-400 mt-0.5 shrink-0" />
        <p className="text-xs text-slate-500">
          Steps run top-to-bottom. Results from earlier steps are available as{' '}
          <code className="bg-slate-200 px-1 rounded">{'{step_id.result}'}</code> in later templates.
          Credit-consuming tools (Freepik, Video) check balance before generating.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      )}

      <div className="space-y-2">
        {steps.map((step, i) => (
          <StepRow key={step.id} step={step} index={i} total={steps.length} tools={tools}
            onChange={(u) => updateStep(i, u)} onDelete={() => deleteStep(i)}
            onMoveUp={() => moveStep(i, -1)} onMoveDown={() => moveStep(i, 1)} />
        ))}
      </div>

      <button type="button" onClick={addStep}
        className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 py-3 text-xs font-semibold text-slate-500 hover:border-indigo-300 hover:text-indigo-600 transition">
        <Plus size={14} /> Add Step
      </button>

      <div className="flex items-center justify-between pt-1">
        <button type="button" disabled={deleting} onClick={deleteWorkflow}
          className="flex items-center gap-1.5 rounded-xl border border-red-200 px-3 py-2 text-xs font-semibold text-red-500 hover:bg-red-50 transition disabled:opacity-50">
          {deleting ? <><Loader2 size={12} className="animate-spin" /> Deleting…</> : <><Trash2 size={12} /> Delete Workflow</>}
        </button>
        <button type="button" disabled={saving} onClick={save}
          className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white transition disabled:opacity-50"
          style={{ background: saved ? '#10B981' : agentColor }}>
          {saving ? <><RefreshCw size={12} className="animate-spin" /> Saving…</> :
           saved   ? <><CheckCircle size={12} /> Saved</> :
                     <><Save size={12} /> Save Workflow</>}
        </button>
      </div>
    </div>
  );
}

function WorkflowListView({
  agentKey, agentColor, tools,
}: {
  agentKey: string; agentColor: string; tools: AgentTool[];
}) {
  const [workflows, setWorkflows] = useState<AgentWorkflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AgentWorkflow | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creatingBusy, setCreatingBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`${BASE()}/api/admin/agent-workflows/${agentKey}`, {
      headers: { Authorization: `Bearer ${tok()}` },
    })
      .then((r) => r.json())
      .then((d) => { if (d.success) setWorkflows(d.workflows ?? []); else setError(d.error); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [agentKey]);

  useEffect(() => { load(); }, [load]);

  const toggleActive = async (wf: AgentWorkflow) => {
    try {
      const res = await fetch(`${BASE()}/api/admin/agent-workflows/${agentKey}/${wf.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
        body: JSON.stringify({ is_active: !wf.is_active }),
      });
      const d = await res.json();
      if (d.success) setWorkflows((prev) => prev.map((w) => w.id === wf.id ? d.workflow : w));
    } catch { /* ignore */ }
  };

  const createWorkflow = async () => {
    if (!newName.trim()) return;
    setCreatingBusy(true);
    try {
      const res = await fetch(`${BASE()}/api/admin/agent-workflows/${agentKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
        body: JSON.stringify({ name: newName.trim(), description: newDesc.trim(), steps: [] }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error);
      setWorkflows((prev) => [...prev, d.workflow]);
      setNewName(''); setNewDesc(''); setCreating(false);
      setEditing(d.workflow);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreatingBusy(false);
    }
  };

  const resetDefaults = async () => {
    if (!confirm('Reset all workflows for this agent to defaults? This will delete any custom workflows.')) return;
    setResetting(true); setError(null);
    try {
      const res = await fetch(`${BASE()}/api/admin/agent-workflows/${agentKey}/reset`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tok()}` },
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error ?? 'Reset failed');
      setWorkflows(d.workflows ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setResetting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-slate-400">
        <Loader2 size={18} className="animate-spin mr-2" /> Loading workflows…
      </div>
    );
  }

  if (editing) {
    return (
      <WorkflowStepEditor
        workflow={editing}
        tools={tools}
        agentColor={agentColor}
        onBack={() => setEditing(null)}
        onSaved={(updated) => {
          setWorkflows((prev) => prev.map((w) => w.id === updated.id ? updated : w));
          setEditing(updated);
        }}
        onDeleted={(id) => {
          setWorkflows((prev) => prev.filter((w) => w.id !== id));
          setEditing(null);
        }}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-xl bg-slate-50 border border-slate-200 p-3">
        <Info size={14} className="text-slate-400 mt-0.5 shrink-0" />
        <p className="text-xs text-slate-500">
          Each workflow is a named sequence of steps this agent follows for a specific task.
          Add, edit, or remove workflows. Toggle active/inactive to control which workflows are available.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div>
      )}

      {workflows.length === 0 && !creating ? (
        <div className="rounded-xl border border-dashed border-slate-200 py-8 text-center">
          <p className="text-sm text-slate-400">No workflows yet.</p>
          <p className="text-xs text-slate-400 mt-1">Add a workflow or reset to defaults.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {workflows.map((wf) => (
            <div key={wf.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 hover:shadow-sm transition">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-slate-800 truncate">{wf.name}</p>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${wf.is_active ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                    {wf.is_active ? 'Active' : 'Off'}
                  </span>
                </div>
                {wf.description && (
                  <p className="text-xs text-slate-500 truncate mt-0.5">{wf.description}</p>
                )}
                <p className="text-[10px] text-slate-400 mt-0.5">{wf.steps.length} step{wf.steps.length !== 1 ? 's' : ''}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button type="button" onClick={() => toggleActive(wf)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition" title={wf.is_active ? 'Deactivate' : 'Activate'}>
                  {wf.is_active ? <ToggleRight size={16} className="text-emerald-500" /> : <ToggleLeft size={16} />}
                </button>
                <button type="button" onClick={() => setEditing(wf)}
                  className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition">
                  <Edit2 size={11} /> Edit
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {creating ? (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/30 p-4 space-y-3">
          <p className="text-xs font-bold text-slate-700">New Workflow</p>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Workflow Name <span className="text-red-400">*</span></label>
            <input value={newName} onChange={(e) => setNewName(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800 outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-300"
              placeholder="e.g. Brand Identity Visual" autoFocus />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">Description</label>
            <input value={newDesc} onChange={(e) => setNewDesc(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-300"
              placeholder="What this workflow accomplishes…" />
          </div>
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => { setCreating(false); setNewName(''); setNewDesc(''); }}
              className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition">
              Cancel
            </button>
            <button type="button" disabled={!newName.trim() || creatingBusy} onClick={createWorkflow}
              className="flex items-center gap-1.5 rounded-xl px-4 py-1.5 text-xs font-bold text-white transition disabled:opacity-50"
              style={{ background: agentColor }}>
              {creatingBusy ? <><Loader2 size={11} className="animate-spin" /> Creating…</> : 'Create & Edit Steps'}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setCreating(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 py-3 text-xs font-semibold text-slate-500 hover:border-indigo-300 hover:text-indigo-600 transition">
          <Plus size={14} /> Add Workflow
        </button>
      )}

      <div className="flex justify-start pt-1">
        <button type="button" disabled={resetting} onClick={resetDefaults}
          className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:border-slate-300 hover:bg-slate-50 transition disabled:opacity-50">
          {resetting ? <><RefreshCw size={12} className="animate-spin" /> Resetting…</> : <><RefreshCw size={12} /> Reset to Defaults</>}
        </button>
      </div>
    </div>
  );
}

function UserAgentModal({
  template, tools, onClose, onTemplateUpdated,
}: {
  template: AgentTemplate; tools: AgentTool[];
  onClose: () => void; onTemplateUpdated: (t: AgentTemplate) => void;
}) {
  const [tab, setTab] = useState<UserAgentTabKey>('prompt');
  const [promptText, setPromptText] = useState(template.base_prompt);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [savedPrompt, setSavedPrompt] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);

  const savePrompt = async () => {
    setSavingPrompt(true); setSavedPrompt(false); setPromptError(null);
    try {
      const res = await fetch(`${BASE()}/api/admin/agent-templates/${template.agent_key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
        body: JSON.stringify({ base_prompt: promptText }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error ?? 'Save failed');
      onTemplateUpdated(d.template);
      setSavedPrompt(true);
      setTimeout(() => setSavedPrompt(false), 2000);
    } catch (e: any) {
      setPromptError(e.message);
    } finally {
      setSavingPrompt(false);
    }
  };

  const TABS: { key: UserAgentTabKey; label: string; icon: React.ReactNode }[] = [
    { key: 'prompt',   label: 'Prompt',    icon: <Settings size={14} /> },
    { key: 'tools',    label: 'Tools',     icon: <Wrench size={14} /> },
    { key: 'workflow', label: 'Workflows', icon: <GitBranch size={14} /> },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="relative flex w-full max-w-2xl flex-col rounded-2xl bg-white shadow-xl max-h-[90vh]">
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4 shrink-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl text-lg"
            style={{ background: `${template.color}18`, color: template.color }}>
            {template.icon}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-black text-slate-900" style={{ color: template.color }}>{template.name}</p>
            <p className="text-xs text-slate-500">{template.role}</p>
          </div>
          <button type="button" onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition">
            <X size={16} />
          </button>
        </div>

        <div className="flex gap-1 border-b border-slate-100 px-5 pt-3 shrink-0">
          {TABS.map((t) => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-xs font-semibold transition ${
                tab === t.key ? 'border-b-2 text-indigo-600' : 'text-slate-500 hover:text-slate-800'
              }`}
              style={tab === t.key ? { borderColor: template.color, color: template.color } : {}}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {tab === 'prompt' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">
                This system prompt is injected every time the agent responds. User-specific compiled skills are layered on top at runtime.
              </p>
              <textarea value={promptText} onChange={(e) => setPromptText(e.target.value)} rows={10}
                className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-800 leading-relaxed outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-300 font-mono"
                placeholder="Enter agent system prompt…" />
              {promptError && (
                <p className="text-xs text-red-600">{promptError}</p>
              )}
              <div className="flex justify-end">
                <button type="button" disabled={savingPrompt} onClick={savePrompt}
                  className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white transition disabled:opacity-50"
                  style={{ background: savedPrompt ? '#10B981' : template.color }}>
                  {savingPrompt ? <><RefreshCw size={12} className="animate-spin" /> Saving…</> :
                   savedPrompt  ? <><CheckCircle size={12} /> Saved</> :
                                  <><Save size={12} /> Save Prompt</>}
                </button>
              </div>
            </div>
          )}

          {tab === 'tools' && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 rounded-xl bg-slate-50 border border-slate-200 p-3">
                <Info size={14} className="text-slate-400 mt-0.5 shrink-0" />
                <p className="text-xs text-slate-500">
                  These are the tools available to <strong>{template.name}</strong> during workflow execution.
                  Tools marked <span className="font-semibold text-emerald-600">api</span> consume credits per call.
                </p>
              </div>
              {tools.length === 0 ? (
                <p className="text-sm text-slate-400 py-4 text-center">No tools registered.</p>
              ) : (
                <div className="space-y-2">
                  {tools.map((tool) => (
                    <div key={tool.key} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3">
                      <div className="mt-0.5">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${TOOL_TYPE_BADGE[tool.type] ?? 'bg-slate-100 text-slate-500'}`}>
                          {tool.type}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800">{tool.name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{tool.description}</p>
                        <p className="text-[10px] text-slate-400 font-mono mt-1">key: {tool.key}</p>
                        {tool.config?.credits && (
                          <p className="text-[10px] text-amber-600 font-semibold mt-0.5">{tool.config.credits} credits/call</p>
                        )}
                      </div>
                      <div className={`mt-1 h-2 w-2 rounded-full shrink-0 ${tool.enabled ? 'bg-emerald-400' : 'bg-slate-300'}`}
                        title={tool.enabled ? 'Enabled' : 'Disabled'} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'workflow' && (
            <WorkflowListView
              agentKey={template.agent_key}
              agentColor={template.color}
              tools={tools}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function UserAgentsPanel() {
  const [templates, setTemplates] = useState<AgentTemplate[]>([]);
  const [tools, setTools] = useState<AgentTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AgentTemplate | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch(`${BASE()}/api/admin/agent-templates`, { headers: { Authorization: `Bearer ${tok()}` } }).then((r) => r.json()),
      fetch(`${BASE()}/api/admin/agent-tools`,     { headers: { Authorization: `Bearer ${tok()}` } }).then((r) => r.json()),
    ])
      .then(([td, tl]) => {
        if (!td.success) throw new Error(td.error ?? 'Failed to load');
        setTemplates(td.templates);
        setTools(tl.success ? tl.tools : []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center gap-3 py-16 justify-center text-slate-500">
        <Loader2 size={18} className="animate-spin" /> Loading user agents…
      </div>
    );
  }
  if (error) {
    return <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">{error}</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-black text-slate-950 tracking-[-0.02em]">User Agents</h3>
        <p className="text-sm text-slate-500 mt-0.5">
          Configure each agent's system prompt, available tools, and named workflows. These agents power each user's social media team.
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-1 xl:grid-cols-2">
        {templates.map((t) => (
          <div key={t.agent_key} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md transition">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xl font-bold"
                style={{ background: `${t.color}18`, color: t.color }}>
                {t.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-black text-slate-900" style={{ color: t.color }}>{t.name}</p>
                <p className="text-xs text-slate-500">{t.role}</p>
              </div>
              {t.memory_keywords.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {t.memory_keywords.slice(0, 3).map((k) => (
                    <span key={k} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">{k}</span>
                  ))}
                </div>
              )}
            </div>
            <p className="text-xs text-slate-500 line-clamp-2 mb-4">{t.base_prompt.slice(0, 160)}…</p>
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-slate-400">
                Updated {new Date(t.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
              <button type="button" onClick={() => setSelected(t)}
                className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition">
                <Settings size={12} /> Configure
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <p className="text-xs font-bold text-slate-600 mb-2">How user agents work</p>
        <ul className="space-y-1.5 text-xs text-slate-500">
          <li>• Each agent has named workflows — ordered step sequences it follows for specific tasks.</li>
          <li>• Nova uses Freepik AI (5 credits/image) and Magnific AI for image and video generation.</li>
          <li>• Credit balance is checked before any generation step — insufficient credits halt the workflow.</li>
          <li>• Agents are recompiled automatically when users update their brand memory.</li>
          <li>• User agents propose actions for user approval — they do not act autonomously.</li>
        </ul>
      </div>

      {selected && (
        <UserAgentModal
          template={selected}
          tools={tools}
          onClose={() => setSelected(null)}
          onTemplateUpdated={(updated) => {
            setTemplates((prev) => prev.map((t) => t.agent_key === updated.agent_key ? updated : t));
            setSelected(updated);
          }}
        />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ROOT EXPORT — dual-tab Agent Team page
// ══════════════════════════════════════════════════════════════════════════════

type AgentTeamTab = 'admin' | 'user';

export default function AdminAgents() {
  const [activeTab, setActiveTab] = useState<AgentTeamTab>('admin');

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h2 className="text-2xl font-black tracking-[-0.03em] text-slate-950">Agent Team</h2>
        <p className="mt-1.5 text-sm text-slate-500">
          Admin agents run the platform autonomously. User agents power each customer's social media team.
        </p>
      </div>

      {/* Top-level tab switcher */}
      <div className="flex gap-1 rounded-2xl bg-slate-100 p-1 w-fit">
        {([
          { key: 'admin', label: 'Admin Agents', desc: 'C-Suite AI' },
          { key: 'user',  label: 'User Agents',  desc: 'Marketing Team' },
        ] as { key: AgentTeamTab; label: string; desc: string }[]).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActiveTab(t.key)}
            className={`flex flex-col items-start rounded-xl px-5 py-2.5 text-left transition-colors ${
              activeTab === t.key
                ? 'bg-white shadow-sm text-slate-950'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <span className={`text-sm font-bold ${activeTab === t.key ? 'text-slate-950' : ''}`}>{t.label}</span>
            <span className="text-[10px] font-medium text-slate-400">{t.desc}</span>
          </button>
        ))}
      </div>

      {/* Panel */}
      {activeTab === 'admin' ? <AdminAgentsPanel /> : <UserAgentsPanel />}
    </div>
  );
}
