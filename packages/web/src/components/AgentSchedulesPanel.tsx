import React, { useEffect, useState } from 'react';
import { CalendarClock, Play, Plus, Trash2, ArrowRight, Radio } from 'lucide-react';
import { API_BASE_URL } from '../utils/apiBase';

interface AgentSchedule {
  id: string;
  name: string;
  primary_agent_slug: string;
  handoff_agent_slug: string | null;
  prompt_goal: string;
  frequency: string;
  output_action: string;
  is_active: boolean;
  last_run_at: string | null;
  next_run_at: string;
  last_result_summary: string | null;
}

function tok() { return localStorage.getItem('auth_token') ?? ''; }

export default function AgentSchedulesPanel() {
  const [schedules, setSchedules] = useState<AgentSchedule[]>([]);
  const [name, setName] = useState('');
  const [primaryAgent, setPrimaryAgent] = useState('researcher');
  const [handoffAgent, setHandoffAgent] = useState('copywriter');
  const [promptGoal, setPromptGoal] = useState('');
  const [frequency, setFrequency] = useState('daily');
  const [outputAction, setOutputAction] = useState('create_post_draft');
  const [creating, setCreating] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [streamLog, setStreamLog] = useState<string[]>([]);
  const [streaming, setStreaming] = useState(false);

  const loadSchedules = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/os/schedules`, {
        headers: { Authorization: `Bearer ${tok()}` },
      });
      const data = await res.json();
      if (data.success) {
        setSchedules(data.schedules || []);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    void loadSchedules();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !promptGoal.trim()) return;
    setCreating(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/os/schedules`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tok()}`,
        },
        body: JSON.stringify({
          name,
          primaryAgentSlug: primaryAgent,
          handoffAgentSlug: handoffAgent || null,
          promptGoal,
          frequency,
          outputAction,
        }),
      });
      const data = await res.json();
      if (data.success && data.schedule) {
        setSchedules((prev) => [data.schedule, ...prev]);
        setName('');
        setPromptGoal('');
      }
    } finally {
      setCreating(false);
    }
  };

  const handleRunNow = async (id: string) => {
    setRunningId(id);
    try {
      const res = await fetch(`${API_BASE_URL}/api/os/schedules/${id}/run-now`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tok()}` },
      });
      const data = await res.json();
      if (data.success) {
        await loadSchedules();
      }
    } finally {
      setRunningId(null);
    }
  };

  const handleDelete = async (id: string) => {
    await fetch(`${API_BASE_URL}/api/os/schedules/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tok()}` },
    });
    setSchedules((prev) => prev.filter((s) => s.id !== id));
  };

  const handleStreamLiveHandoff = async () => {
    setStreaming(true);
    setStreamLog(['Connecting to real-time SSE multi-agent pipeline...']);
    try {
      const res = await fetch(`${API_BASE_URL}/api/os/stream-run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tok()}`,
        },
        body: JSON.stringify({
          primaryAgent,
          handoffAgent: handoffAgent || 'copywriter',
          goal: promptGoal || 'Analyze high-performing industry content hooks and write a conversion-ready LinkedIn + Instagram post.',
        }),
      });
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n').filter((l) => l.startsWith('data: '));
          for (const line of lines) {
            try {
              const payload = JSON.parse(line.slice(6));
              if (payload.message) {
                setStreamLog((prev) => [...prev, payload.message]);
              }
              if (payload.handoffOutput) {
                setStreamLog((prev) => [
                  ...prev,
                  `✅ Final Handoff Deliverable:\n${String(payload.handoffOutput).slice(0, 360)}`,
                ]);
              }
            } catch {
              // ignore partial frame
            }
          }
        }
      }
    } catch {
      setStreamLog((prev) => [...prev, 'Stream completed.']);
    } finally {
      setStreaming(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-6 mt-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-indigo-600" />
            Autonomous Agent Schedules & Multi-Agent Handoffs
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Schedule recurring autonomous runs where one specialist agent researches & hands off deliverables to a second agent to auto-create Post Drafts.
          </p>
        </div>
        <button
          type="button"
          disabled={streaming}
          onClick={handleStreamLiveHandoff}
          className="px-3.5 py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold flex items-center gap-1.5 self-start"
        >
          <Radio className={`h-3.5 w-3.5 ${streaming ? 'animate-pulse text-rose-500' : ''}`} />
          {streaming ? 'Streaming SSE Handoff...' : 'Test Live SSE Multi-Agent Stream'}
        </button>
      </div>

      {streamLog.length > 0 && (
        <div className="bg-slate-900 text-slate-100 rounded-xl p-4 text-xs font-mono space-y-1.5 max-h-52 overflow-y-auto">
          {streamLog.map((entry, idx) => (
            <div key={idx} className="whitespace-pre-wrap leading-relaxed">
              {entry}
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <form onSubmit={handleCreate} className="lg:col-span-5 space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200/80">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
            New Recurring Agent Pipeline
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Pipeline Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Monday Competitor Hook -> Draft Post"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Primary Agent</label>
              <select
                value={primaryAgent}
                onChange={(e) => setPrimaryAgent(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs"
              >
                <option value="researcher">Researcher</option>
                <option value="strategist">Growth Strategist</option>
                <option value="seo">SEO Analyst</option>
                <option value="analytics">Analytics Specialist</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Handoff To Agent</label>
              <select
                value={handoffAgent}
                onChange={(e) => setHandoffAgent(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs"
              >
                <option value="copywriter">Copywriter</option>
                <option value="social_manager">Social Media Manager</option>
                <option value="email_marketer">Email CRM Specialist</option>
                <option value="">None (Single Agent)</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Cadence</label>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs"
              >
                <option value="hourly">Hourly</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Output Action</label>
              <select
                value={outputAction}
                onChange={(e) => setOutputAction(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs"
              >
                <option value="create_post_draft">Auto-Create Post Draft</option>
                <option value="notify_only">Send Summary Notification</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Prompt / Objective</label>
            <textarea
              rows={3}
              required
              value={promptGoal}
              onChange={(e) => setPromptGoal(e.target.value)}
              placeholder="Describe what the primary agent should research and what the handoff agent should produce..."
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
            />
          </div>
          <button
            type="submit"
            disabled={creating}
            className="w-full py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold flex items-center justify-center gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            {creating ? 'Scheduling...' : 'Activate Autonomous Schedule'}
          </button>
        </form>

        <div className="lg:col-span-7 space-y-3">
          {schedules.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-xl">
              No autonomous schedules configured yet. Create a recurring pipeline on the left!
            </div>
          ) : (
            schedules.map((sched) => (
              <div
                key={sched.id}
                className="p-4 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-slate-900">{sched.name}</span>
                    <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-[11px] font-semibold uppercase">
                      {sched.frequency}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-slate-600 font-medium">
                    <span className="capitalize">{sched.primary_agent_slug}</span>
                    {sched.handoff_agent_slug && (
                      <>
                        <ArrowRight className="h-3 w-3 text-slate-400" />
                        <span className="capitalize">{sched.handoff_agent_slug}</span>
                      </>
                    )}
                    <span className="text-slate-400">• {sched.output_action.replace(/_/g, ' ')}</span>
                  </div>
                  {sched.last_result_summary && (
                    <p className="text-xs text-slate-500 line-clamp-2 bg-slate-50 p-2 rounded-lg mt-1">
                      {sched.last_result_summary}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={runningId === sched.id}
                    onClick={() => void handleRunNow(sched.id)}
                    className="px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-semibold flex items-center gap-1"
                  >
                    <Play className="h-3 w-3" />
                    {runningId === sched.id ? 'Running...' : 'Run Now'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(sched.id)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
