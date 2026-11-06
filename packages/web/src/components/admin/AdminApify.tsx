import { useEffect, useState } from 'react';
import { Activity, Check, Database, Eye, Play, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { API_BASE_URL } from '../../utils/apiBase';

const SUGGESTED_ACTORS = [
  { id: 'apify/website-content-crawler', name: 'Website Content Crawler', description: 'Extract structured text from any website — great for brand memory', tag: 'Web' },
  { id: 'apify/instagram-scraper', name: 'Instagram Scraper', description: 'Scrape Instagram profiles, posts, and hashtags', tag: 'Social' },
  { id: 'apify/linkedin-profile-scraper', name: 'LinkedIn Profile Scraper', description: 'Extract LinkedIn profile data for audience research', tag: 'Social' },
  { id: 'apify/twitter-scraper', name: 'Twitter / X Scraper', description: 'Fetch tweets, profiles, and follower data from X', tag: 'Social' },
  { id: 'apify/google-search-scraper', name: 'Google Search Scraper', description: 'Scrape Google results for brand monitoring', tag: 'Search' },
  { id: 'apify/facebook-pages-scraper', name: 'Facebook Pages Scraper', description: 'Scrape Facebook business pages and posts', tag: 'Social' },
];

const ACTOR_INPUT_TEMPLATES: Record<string, object> = {
  'apify/website-content-crawler': {
    startUrls: [{ url: 'https://example.com' }],
    maxCrawlDepth: 1,
    maxCrawlPages: 10,
  },
  'apify/instagram-scraper': {
    directUrls: ['https://www.instagram.com/username/'],
    resultsLimit: 20,
  },
  'apify/linkedin-profile-scraper': {
    profileUrls: ['https://www.linkedin.com/in/username/'],
  },
  'apify/twitter-scraper': {
    searchTerms: ['your keyword here'],
    maxItems: 20,
  },
  'apify/google-search-scraper': {
    queries: ['your search term'],
    maxPagesPerQuery: 1,
    resultsPerPage: 10,
  },
  'apify/facebook-pages-scraper': {
    startUrls: [{ url: 'https://www.facebook.com/pagename' }],
    maxPosts: 20,
  },
};

type Actor = {
  id: string;
  actor_id: string;
  name: string;
  description: string;
  tag: string;
  created_at: string;
};

type Run = {
  id: string;
  actor_name: string;
  apify_run_id: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  dataset_id: string | null;
};

type ConnectionStatus = {
  connected: boolean;
  username?: string;
  plan?: string;
  creditBalance?: number;
};

const STATUS_COLORS: Record<string, string> = {
  SUCCEEDED: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  RUNNING: 'text-blue-700 bg-blue-50 border-blue-200',
  READY: 'text-gray-600 bg-gray-50 border-gray-200',
  FAILED: 'text-red-700 bg-red-50 border-red-200',
  'TIMED-OUT': 'text-amber-700 bg-amber-50 border-amber-200',
  ABORTED: 'text-gray-500 bg-gray-50 border-gray-200',
};

const TAGS = ['Custom', 'Web', 'Social', 'Search', 'E-commerce', 'Data'];

export default function AdminApify() {
  const [tab, setTab] = useState<'actors' | 'runs' | 'datasets'>('actors');
  const [apiKey, setApiKey] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [actors, setActors] = useState<Actor[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loadingActors, setLoadingActors] = useState(false);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addActorId, setAddActorId] = useState('');
  const [addActorName, setAddActorName] = useState('');
  const [addActorDesc, setAddActorDesc] = useState('');
  const [addActorTag, setAddActorTag] = useState('Custom');
  const [addingActor, setAddingActor] = useState(false);
  const [runModalActor, setRunModalActor] = useState<Actor | null>(null);
  const [runInput, setRunInput] = useState('{}');
  const [triggeringRun, setTriggeringRun] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const tok = () => localStorage.getItem('auth_token') ?? '';

  const loadConfig = async () => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/admin/platform-configs/apify`, {
        headers: { Authorization: `Bearer ${tok()}` },
      });
      if (r.ok) {
        // GET returns { success, config: { platform, config: { apiKey }, enabled } }
        const data = await r.json() as { config?: { config?: { apiKey?: string } } };
        const key = data.config?.config?.apiKey;
        if (key) setApiKey(key);
      }
    } catch { /* ignore */ }
  };

  const checkStatus = async () => {
    setCheckingStatus(true);
    try {
      const r = await fetch(`${API_BASE_URL}/api/admin/apify/status`, {
        headers: { Authorization: `Bearer ${tok()}` },
      });
      const data = await r.json() as ConnectionStatus;
      setStatus(data);
    } catch {
      setStatus({ connected: false });
    } finally {
      setCheckingStatus(false);
    }
  };

  const saveApiKey = async () => {
    if (!apiKey.trim()) return;
    setSavingKey(true);
    setSaveError(null);
    try {
      const r = await fetch(`${API_BASE_URL}/api/admin/platform-configs/apify`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
        body: JSON.stringify({ config: { apiKey: apiKey.trim() }, enabled: true }),
      });
      const data = await r.json().catch(() => ({})) as { error?: string; success?: boolean };
      if (!r.ok) {
        setSaveError(data.error ?? `Server error ${r.status}`);
        return;
      }
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
      await checkStatus();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save API key');
    } finally {
      setSavingKey(false);
    }
  };

  const loadActors = async () => {
    setLoadingActors(true);
    try {
      const r = await fetch(`${API_BASE_URL}/api/admin/apify/actors`, {
        headers: { Authorization: `Bearer ${tok()}` },
      });
      const data = await r.json() as { actors: Actor[] };
      setActors(data.actors ?? []);
    } finally {
      setLoadingActors(false);
    }
  };

  const loadRuns = async () => {
    setLoadingRuns(true);
    try {
      const r = await fetch(`${API_BASE_URL}/api/admin/apify/runs`, {
        headers: { Authorization: `Bearer ${tok()}` },
      });
      const data = await r.json() as { runs: Run[] };
      setRuns(data.runs ?? []);
    } finally {
      setLoadingRuns(false);
    }
  };

  const addActor = async (suggested?: (typeof SUGGESTED_ACTORS)[0]) => {
    const actorId = suggested ? suggested.id : addActorId.trim();
    const name = suggested ? suggested.name : addActorName.trim();
    const desc = suggested ? suggested.description : addActorDesc.trim();
    const tag = suggested ? suggested.tag : addActorTag;
    if (!actorId || !name) return;
    setAddingActor(true);
    try {
      await fetch(`${API_BASE_URL}/api/admin/apify/actors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
        body: JSON.stringify({ actor_id: actorId, name, description: desc, tag }),
      });
      await loadActors();
      setShowAddForm(false);
      setAddActorId('');
      setAddActorName('');
      setAddActorDesc('');
      setAddActorTag('Custom');
    } finally {
      setAddingActor(false);
    }
  };

  const removeActor = async (id: string) => {
    await fetch(`${API_BASE_URL}/api/admin/apify/actors/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tok()}` },
    });
    setActors((prev) => prev.filter((a) => a.id !== id));
  };

  const triggerRun = async () => {
    if (!runModalActor) return;
    setTriggeringRun(true);
    setRunError(null);
    try {
      let parsedInput: Record<string, unknown> = {};
      try { parsedInput = JSON.parse(runInput) as Record<string, unknown>; } catch { /* use empty */ }
      const r = await fetch(`${API_BASE_URL}/api/admin/apify/actors/${runModalActor.id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
        body: JSON.stringify({ input: parsedInput }),
      });
      const data = await r.json().catch(() => ({})) as { error?: string };
      if (!r.ok) {
        setRunError(data.error ?? `Error ${r.status}`);
        return;
      }
      setRunModalActor(null);
      setRunInput('{}');
      setTab('runs');
      await loadRuns();
    } catch (e) {
      setRunError(e instanceof Error ? e.message : 'Failed to start run');
    } finally {
      setTriggeringRun(false);
    }
  };

  useEffect(() => {
    void loadConfig();
    void checkStatus();
    void loadActors();
    void loadRuns();
  }, []);

  const alreadyAdded = new Set(actors.map((a) => a.actor_id));

  return (
    <div className="space-y-5">

      {/* Connection card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#00D26A]/10">
              <span className="text-[17px] font-black text-[#00D26A]">A</span>
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900">Apify Connection</p>
              {status?.connected ? (
                <p className="text-xs font-medium text-emerald-600">
                  Connected · {status.username ?? ''}{status.plan ? ` · ${status.plan}` : ''}
                </p>
              ) : (
                <p className="text-xs text-slate-400">Not connected — enter your API key below</p>
              )}
            </div>
          </div>
          {status?.connected && typeof status.creditBalance === 'number' && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-right">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Credit Balance</p>
              <p className="text-lg font-black text-slate-900">${Number(status.creditBalance).toFixed(2)}</p>
            </div>
          )}
        </div>

        <div className="mt-4 flex gap-2">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="apify_api_xxxxxxxxxxxxxxxxxx"
            className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 font-mono text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
          <button
            type="button"
            onClick={() => void saveApiKey()}
            disabled={savingKey || !apiKey.trim()}
            className={`flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-bold transition-colors ${
              saveSuccess ? 'bg-emerald-600 text-white' : 'bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-40'
            }`}
          >
            {saveSuccess ? <Check size={14} /> : savingKey ? '…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => void checkStatus()}
            disabled={checkingStatus}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
          >
            <RefreshCw size={13} className={checkingStatus ? 'animate-spin' : ''} />
            Test
          </button>
        </div>
        {saveError && (
          <p className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{saveError}</p>
        )}
        <p className="mt-2 text-[11px] text-slate-400">
          Find your API key at <span className="font-semibold text-slate-600">console.apify.com → Settings → Integrations</span>
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 rounded-2xl border border-slate-200 bg-white p-1.5">
        {(['actors', 'runs', 'datasets'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 rounded-xl py-2 text-sm font-semibold capitalize transition-colors ${
              tab === t ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── Actors tab ── */}
      {tab === 'actors' && (
        <div className="space-y-4">
          {/* Saved actors */}
          {actors.length > 0 && (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
                <p className="text-sm font-bold text-slate-900">Your Actors ({actors.length})</p>
              </div>
              {loadingActors ? (
                <div className="px-5 py-8 text-center text-sm text-slate-400">Loading…</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {actors.map((actor) => (
                    <div key={actor.id} className="flex items-center gap-3 px-5 py-3.5">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-xs font-black text-indigo-600">
                        {(actor.tag ?? 'A')[0]}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900">{actor.name}</p>
                        <p className="truncate text-xs text-slate-400">{actor.actor_id}</p>
                      </div>
                      <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">
                        {actor.tag}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const template = ACTOR_INPUT_TEMPLATES[actor.actor_id];
                          setRunModalActor(actor);
                          setRunInput(template ? JSON.stringify(template, null, 2) : '{}');
                          setRunError(null);
                        }}
                        className="flex shrink-0 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-[12px] font-bold text-white transition-colors hover:bg-indigo-700"
                      >
                        <Play size={11} /> Run
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeActor(actor.id)}
                        className="shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Suggested actors */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <p className="text-sm font-bold text-slate-900">Suggested Actors</p>
              <button
                type="button"
                onClick={() => setShowAddForm((v) => !v)}
                className="flex items-center gap-1.5 text-[12px] font-semibold text-indigo-600 transition-colors hover:text-indigo-800"
              >
                <Plus size={12} /> Add custom
              </button>
            </div>

            {/* Custom add form */}
            {showAddForm && (
              <div className="space-y-3 border-b border-slate-100 bg-slate-50/60 px-5 py-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                      Actor ID
                    </label>
                    <input
                      value={addActorId}
                      onChange={(e) => setAddActorId(e.target.value)}
                      placeholder="username/actor-name"
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                      Display Name
                    </label>
                    <input
                      value={addActorName}
                      onChange={(e) => setAddActorName(e.target.value)}
                      placeholder="My Scraper"
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                      Description
                    </label>
                    <input
                      value={addActorDesc}
                      onChange={(e) => setAddActorDesc(e.target.value)}
                      placeholder="What this actor does…"
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                      Tag
                    </label>
                    <select
                      value={addActorTag}
                      onChange={(e) => setAddActorTag(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    >
                      {TAGS.map((t) => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowAddForm(false)}
                    className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void addActor()}
                    disabled={addingActor || !addActorId.trim() || !addActorName.trim()}
                    className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-700 disabled:opacity-40"
                  >
                    {addingActor ? '…' : 'Add Actor'}
                  </button>
                </div>
              </div>
            )}

            <div className="divide-y divide-slate-100">
              {SUGGESTED_ACTORS.map((a) => {
                const added = alreadyAdded.has(a.id);
                return (
                  <div key={a.id} className="flex items-center gap-3 px-5 py-4">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#00D26A]/10 text-xs font-black text-[#00D26A]">
                      {a.tag[0]}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-900">{a.name}</p>
                      <p className="mt-0.5 text-xs text-slate-400">{a.description}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">
                      {a.tag}
                    </span>
                    <button
                      type="button"
                      onClick={() => !added && void addActor(a)}
                      disabled={added || addingActor}
                      className={`shrink-0 rounded-lg px-3 py-1.5 text-[12px] font-bold transition-colors ${
                        added
                          ? 'bg-emerald-50 text-emerald-600'
                          : 'bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-40'
                      }`}
                    >
                      {added ? <Check size={12} /> : 'Add'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Runs tab ── */}
      {tab === 'runs' && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <p className="text-sm font-bold text-slate-900">Recent Runs</p>
            <button
              type="button"
              onClick={() => void loadRuns()}
              className="flex items-center gap-1.5 text-[12px] text-slate-500 hover:text-slate-800"
            >
              <RefreshCw size={12} className={loadingRuns ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
          {loadingRuns ? (
            <div className="px-5 py-10 text-center text-sm text-slate-400">Loading…</div>
          ) : runs.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <Activity size={28} className="mx-auto mb-3 text-slate-300" />
              <p className="text-sm font-semibold text-slate-500">No runs yet</p>
              <p className="mt-1 text-xs text-slate-400">Add actors in the Actors tab, then click Run.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {runs.map((run) => (
                <div key={run.id} className="flex items-center gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">{run.actor_name}</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {run.apify_run_id} · {new Date(run.started_at).toLocaleString()}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${STATUS_COLORS[run.status] ?? 'border-gray-200 bg-gray-50 text-gray-500'}`}
                  >
                    {run.status}
                  </span>
                  {run.dataset_id && (
                    <a
                      href={`https://console.apify.com/storage/datasets/${run.dataset_id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      <Eye size={11} /> Results
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Datasets tab ── */}
      {tab === 'datasets' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
          <Database size={28} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm font-semibold text-slate-500">Datasets appear here after runs complete</p>
          <p className="mt-1 text-xs text-slate-400">
            Successful runs with output are linked to datasets you can view on Apify Console.
          </p>
        </div>
      )}

      {/* ── Run modal ── */}
      {runModalActor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-base font-bold text-slate-900">Run Actor</p>
                <p className="mt-0.5 text-xs text-slate-400">{runModalActor.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setRunModalActor(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
              >
                <X size={16} />
              </button>
            </div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-slate-400">
              Input JSON
            </label>
            <textarea
              value={runInput}
              onChange={(e) => setRunInput(e.target.value)}
              rows={9}
              spellCheck={false}
              className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
            <p className="mt-1 text-[11px] text-slate-400">
              Provide the actor's input as JSON. See the actor's docs on Apify Console.
            </p>
            {runError && (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {runError}
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRunModalActor(null)}
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void triggerRun()}
                disabled={triggeringRun}
                className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-40"
              >
                <Play size={13} /> {triggeringRun ? 'Starting…' : 'Start Run'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
