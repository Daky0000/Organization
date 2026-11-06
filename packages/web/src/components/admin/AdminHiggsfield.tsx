import { useEffect, useState } from 'react';
import {
  Check,
  ChevronDown,
  Download,
  ExternalLink,
  Film,
  Image,
  RefreshCw,
  Trash2,
  Wand2,
} from 'lucide-react';
import { API_BASE_URL } from '../../utils/apiBase';

const IMAGE_MODEL_SUGGESTIONS = [
  'higgsfield-ai/soul/standard',
  'reve/text-to-image',
];

const VIDEO_MODEL_SUGGESTIONS = [
  'higgsfield-ai/dop/standard',
  'higgsfield-ai/dop/preview',
  'bytedance/seedance/v1/pro/image-to-video',
  'kling-video/v2.1/pro/image-to-video',
];

const ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9'];
const RESOLUTIONS = ['480p', '720p', '1080p'];

type Generation = {
  id: string;
  type: 'image' | 'video';
  model: string;
  prompt: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result_url: string | null;
  error: string | null;
  created_at: string;
};

type ConnectionStatus = {
  connected: boolean;
  username?: string;
  credits?: number | null;
  error?: string;
};

export default function AdminHiggsfield() {
  const [tab, setTab] = useState<'image' | 'video' | 'history'>('image');

  // API credentials state
  const [apiId, setApiId] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [baseUrl, setBaseUrl] = useState('https://api.higgsfield.ai');
  const [showBaseUrl, setShowBaseUrl] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);

  // Image generation state
  const [imgPrompt, setImgPrompt] = useState('');
  const [imgModel, setImgModel] = useState('higgsfield-ai/soul/standard'); // confirmed model ID from docs
  const [imgAspect, setImgAspect] = useState('1:1');
  const [imgResolution, setImgResolution] = useState('720p');
  const [generatingImg, setGeneratingImg] = useState(false);
  const [imgResult, setImgResult] = useState<{ url: string | null; error: string | null } | null>(null);

  // Video generation state
  const [vidPrompt, setVidPrompt] = useState('');
  const [vidModel, setVidModel] = useState('higgsfield-ai/dop/standard');
  const [vidAspect, setVidAspect] = useState('16:9');
  const [vidResolution, setVidResolution] = useState('720p');
  const [vidImageUrl, setVidImageUrl] = useState('');
  const [generatingVid, setGeneratingVid] = useState(false);
  const [vidResult, setVidResult] = useState<{ url: string | null; error: string | null } | null>(null);

  // History state
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);


  const tok = () => localStorage.getItem('auth_token') ?? '';
  const authHeader = () => ({ Authorization: `Bearer ${tok()}` });

  const loadConfig = async () => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/admin/platform-configs/higgsfield`, {
        headers: authHeader(),
      });
      if (r.ok) {
        const data = await r.json() as { config?: { config?: { apiId?: string; apiSecret?: string; baseUrl?: string } } };
        const cfg = data.config?.config;
        if (cfg?.apiId) setApiId(cfg.apiId);
        if (cfg?.apiSecret) setApiSecret(cfg.apiSecret);
        if (cfg?.baseUrl) setBaseUrl(cfg.baseUrl);
      }
    } catch { /* ignore */ }
  };

  const checkStatus = async () => {
    setCheckingStatus(true);
    try {
      const r = await fetch(`${API_BASE_URL}/api/admin/higgsfield/status`, {
        headers: authHeader(),
      });
      const data = await r.json() as ConnectionStatus;
      setStatus(data);
    } catch {
      setStatus({ connected: false, error: 'Network error' });
    } finally {
      setCheckingStatus(false);
    }
  };

  const saveApiKey = async () => {
    if (!apiId.trim() || !apiSecret.trim()) return;
    setSavingKey(true);
    setSaveError(null);
    try {
      const r = await fetch(`${API_BASE_URL}/api/admin/platform-configs/higgsfield`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ config: { apiId: apiId.trim(), apiSecret: apiSecret.trim(), baseUrl: baseUrl.trim() }, enabled: true }),
      });
      const data = await r.json().catch(() => ({})) as { error?: string };
      if (!r.ok) {
        setSaveError(data.error ?? `Server error ${r.status}`);
        return;
      }
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
      await checkStatus();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSavingKey(false);
    }
  };

  const generateImage = async () => {
    if (!imgPrompt.trim()) return;
    setGeneratingImg(true);
    setImgResult(null);
    try {
      const r = await fetch(`${API_BASE_URL}/api/admin/higgsfield/generate/image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({
          prompt: imgPrompt,
          model: imgModel,
          aspect_ratio: imgAspect,
          resolution: imgResolution,
        }),
      });
      const data = await r.json() as { url?: string | null; error?: string };
      if (!r.ok) {
        setImgResult({ url: null, error: data.error ?? `Error ${r.status}` });
      } else {
        setImgResult({ url: data.url ?? null, error: null });
        void loadHistory();
      }
    } catch (e) {
      setImgResult({ url: null, error: e instanceof Error ? e.message : 'Request failed' });
    } finally {
      setGeneratingImg(false);
    }
  };

  const generateVideo = async () => {
    if (!vidPrompt.trim()) return;
    setGeneratingVid(true);
    setVidResult(null);
    try {
      const r = await fetch(`${API_BASE_URL}/api/admin/higgsfield/generate/video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({
          prompt: vidPrompt,
          model: vidModel,
          aspect_ratio: vidAspect,
          resolution: vidResolution,
          image_url: vidImageUrl || undefined,
        }),
      });
      const data = await r.json() as { url?: string | null; error?: string };
      if (!r.ok) {
        setVidResult({ url: null, error: data.error ?? `Error ${r.status}` });
      } else {
        setVidResult({ url: data.url ?? null, error: null });
        void loadHistory();
      }
    } catch (e) {
      setVidResult({ url: null, error: e instanceof Error ? e.message : 'Request failed' });
    } finally {
      setGeneratingVid(false);
    }
  };

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const r = await fetch(`${API_BASE_URL}/api/admin/higgsfield/generations`, {
        headers: authHeader(),
      });
      const data = await r.json() as { generations: Generation[] };
      setGenerations(data.generations ?? []);
    } finally {
      setLoadingHistory(false);
    }
  };

  const deleteGeneration = async (id: string) => {
    await fetch(`${API_BASE_URL}/api/admin/higgsfield/generations/${id}`, {
      method: 'DELETE',
      headers: authHeader(),
    });
    setGenerations((prev) => prev.filter((g) => g.id !== id));
  };

  useEffect(() => {
    void loadConfig();
    void checkStatus();
    void loadHistory();
  }, []);

  const statusColor = status?.connected ? 'text-emerald-600' : 'text-slate-400';

  return (
    <div className="space-y-5">

      {/* Connection card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100">
              <Wand2 size={18} className="text-violet-600" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900">Higgsfield AI</p>
              <p className={`text-xs font-medium ${statusColor}`}>
                {status?.connected
                  ? `Connected${status.username ? ` · ${status.username}` : ''}${typeof status.credits === 'number' ? ` · ${status.credits} credits` : ''}`
                  : status?.error
                    ? status.error
                    : 'Not connected — enter your API key below'}
              </p>
            </div>
          </div>
          {status?.connected && typeof status.credits === 'number' && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-right">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Credits</p>
              <p className="text-lg font-black text-slate-900">{status.credits}</p>
            </div>
          )}
        </div>

        <div className="mt-4 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-widest text-slate-400">API ID</label>
              <input
                type="text"
                value={apiId}
                onChange={(e) => setApiId(e.target.value)}
                placeholder="your-api-id"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-300"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-widest text-slate-400">Secret</label>
              <input
                type="password"
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                placeholder="your-api-secret"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-300"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void saveApiKey()}
              disabled={savingKey || !apiId.trim() || !apiSecret.trim()}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-bold transition-colors ${
                saveSuccess ? 'bg-emerald-600 text-white' : 'bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-40'
              }`}
            >
              {saveSuccess ? <Check size={14} /> : savingKey ? '…' : 'Save Credentials'}
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
        </div>

        {/* Advanced: custom base URL */}
        <button
          type="button"
          onClick={() => setShowBaseUrl((v) => !v)}
          className="mt-3 flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600"
        >
          <ChevronDown size={12} className={`transition-transform ${showBaseUrl ? 'rotate-180' : ''}`} />
          Advanced
        </button>
        {showBaseUrl && (
          <div className="mt-2">
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-widest text-slate-400">
              API Base URL
            </label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-300"
            />
            <p className="mt-1 text-[10px] text-slate-400">
              Change only if Higgsfield provides a custom endpoint.
            </p>
          </div>
        )}

        {saveError && (
          <p className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{saveError}</p>
        )}
        <p className="mt-2 text-[11px] text-slate-400">
          Get your credentials at{' '}
          <span className="font-semibold text-slate-600">cloud.higgsfield.ai/api-keys</span>
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 rounded-2xl border border-slate-200 bg-white p-1.5">
        {([
          { id: 'image', label: 'Generate Image', icon: Image },
          { id: 'video', label: 'Generate Video', icon: Film },
          { id: 'history', label: 'History', icon: RefreshCw },
        ] as const).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => { setTab(id); if (id === 'history') void loadHistory(); }}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-semibold transition-colors ${
              tab === id ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      {/* ── Image tab ── */}
      {tab === 'image' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Model</label>
                <a
                  href="https://docs.higgsfield.ai/docs"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-[11px] text-violet-600 hover:text-violet-800 font-semibold"
                >
                  <ExternalLink size={11} /> Higgsfield docs →
                </a>
              </div>
              <select
                value={imgModel}
                onChange={(e) => setImgModel(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-300"
              >
                {IMAGE_MODEL_SUGGESTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                Prompt
              </label>
              <textarea
                value={imgPrompt}
                onChange={(e) => setImgPrompt(e.target.value)}
                rows={4}
                placeholder="A cinematic portrait of a woman in golden hour light, fashion photography, bokeh background…"
                className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-300"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                  Aspect Ratio
                </label>
                <select
                  value={imgAspect}
                  onChange={(e) => setImgAspect(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-300"
                >
                  {ASPECT_RATIOS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                  Resolution
                </label>
                <select
                  value={imgResolution}
                  onChange={(e) => setImgResolution(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-300"
                >
                  {RESOLUTIONS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void generateImage()}
              disabled={generatingImg || !imgPrompt.trim() || !status?.connected}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 py-3 text-sm font-bold text-white transition-colors hover:bg-violet-700 disabled:opacity-40"
            >
              <Wand2 size={15} />
              {generatingImg ? 'Generating…' : 'Generate Image'}
            </button>

            {!status?.connected && (
              <p className="text-center text-xs text-slate-400">Configure your API key above to enable generation</p>
            )}
          </div>

          {imgResult && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <p className="mb-3 text-sm font-bold text-slate-900">Result</p>
              {imgResult.error ? (
                <div className="space-y-2">
                  <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {imgResult.error}
                  </div>
                  {imgResult.error.toLowerCase().includes('credit') && (
                    <p className="text-[11px] text-slate-500">
                      Higgsfield separates <strong>dashboard credits</strong> (web UI) from <strong>API credits</strong> (programmatic access). Check your API plan at{' '}
                      <span className="font-semibold">cloud.higgsfield.ai</span> — you may need to purchase API credits separately.
                    </p>
                  )}
                </div>
              ) : imgResult.url ? (
                <div className="space-y-3">
                  <img
                    src={imgResult.url}
                    alt="Generated"
                    className="w-full rounded-xl object-cover"
                  />
                  <a
                    href={imgResult.url}
                    download
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Download size={14} /> Download
                  </a>
                </div>
              ) : (
                <p className="text-sm text-slate-500">Generation queued — check History tab for result.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Video tab ── */}
      {tab === 'video' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                Model
              </label>
              <select
                value={vidModel}
                onChange={(e) => setVidModel(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-300"
              >
                {VIDEO_MODEL_SUGGESTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                Prompt
              </label>
              <textarea
                value={vidPrompt}
                onChange={(e) => setVidPrompt(e.target.value)}
                rows={4}
                placeholder="A woman walks through a neon-lit Tokyo street at night, cinematic slow-motion…"
                className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-300"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                  Aspect Ratio
                </label>
                <select
                  value={vidAspect}
                  onChange={(e) => setVidAspect(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-300"
                >
                  {ASPECT_RATIOS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                  Resolution
                </label>
                <select
                  value={vidResolution}
                  onChange={(e) => setVidResolution(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-300"
                >
                  {RESOLUTIONS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                Image URL (optional — for image-to-video)
              </label>
              <input
                type="text"
                value={vidImageUrl}
                onChange={(e) => setVidImageUrl(e.target.value)}
                placeholder="https://…"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-300"
              />
            </div>

            <button
              type="button"
              onClick={() => void generateVideo()}
              disabled={generatingVid || !vidPrompt.trim() || !status?.connected}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 py-3 text-sm font-bold text-white transition-colors hover:bg-violet-700 disabled:opacity-40"
            >
              <Film size={15} />
              {generatingVid ? 'Generating…' : 'Generate Video'}
            </button>

            {!status?.connected && (
              <p className="text-center text-xs text-slate-400">Configure your API key above to enable generation</p>
            )}
          </div>

          {vidResult && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <p className="mb-3 text-sm font-bold text-slate-900">Result</p>
              {vidResult.error ? (
                <div className="space-y-2">
                  <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {vidResult.error}
                  </div>
                  {vidResult.error.toLowerCase().includes('credit') && (
                    <p className="text-[11px] text-slate-500">
                      Higgsfield separates <strong>dashboard credits</strong> (web UI) from <strong>API credits</strong> (programmatic access). Check your API plan at{' '}
                      <span className="font-semibold">cloud.higgsfield.ai</span> — you may need to purchase API credits separately.
                    </p>
                  )}
                </div>
              ) : vidResult.url ? (
                <div className="space-y-3">
                  <video src={vidResult.url} controls className="w-full rounded-xl" />
                  <a
                    href={vidResult.url}
                    download
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Download size={14} /> Download
                  </a>
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}

      {/* ── History tab ── */}
      {tab === 'history' && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <p className="text-sm font-bold text-slate-900">Generation History</p>
            <button
              type="button"
              onClick={() => void loadHistory()}
              className="flex items-center gap-1.5 text-[12px] text-slate-500 hover:text-slate-800"
            >
              <RefreshCw size={12} className={loadingHistory ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>

          {loadingHistory ? (
            <div className="px-5 py-10 text-center text-sm text-slate-400">Loading…</div>
          ) : generations.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <Wand2 size={28} className="mx-auto mb-3 text-slate-300" />
              <p className="text-sm font-semibold text-slate-500">No generations yet</p>
              <p className="mt-1 text-xs text-slate-400">Generated images and videos will appear here.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {generations.map((gen) => (
                <div key={gen.id} className="flex items-center gap-3 px-5 py-4">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-50">
                    {gen.type === 'video'
                      ? <Film size={16} className="text-violet-500" />
                      : <Image size={16} className="text-violet-500" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">{gen.prompt}</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {gen.model} · {gen.type} · {new Date(gen.created_at).toLocaleString()}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${
                      gen.status === 'completed'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : gen.status === 'failed'
                          ? 'border-red-200 bg-red-50 text-red-700'
                          : gen.status === 'processing'
                            ? 'border-blue-200 bg-blue-50 text-blue-700'
                            : 'border-slate-200 bg-slate-50 text-slate-500'
                    }`}
                  >
                    {gen.status}
                  </span>
                  {gen.result_url && gen.status === 'completed' && (
                    <a
                      href={gen.result_url}
                      download
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50"
                      title="Download"
                    >
                      <Download size={13} />
                    </a>
                  )}
                  {gen.error && (
                    <span className="shrink-0 max-w-[120px] truncate text-[11px] text-red-500" title={gen.error}>
                      {gen.error}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => void deleteGeneration(gen.id)}
                    className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Info banner */}
      <div className="rounded-2xl border border-violet-100 bg-violet-50 px-5 py-4">
        <p className="text-xs font-semibold text-violet-700">About Higgsfield AI</p>
        <p className="mt-1 text-[11px] text-violet-600 leading-relaxed">
          Higgsfield provides 30+ models for professional image and video generation including Soul 2.0, Seedance 2.0, Kling 3.0 and more. API access may require a Pro plan or direct API key from Higgsfield. Visit{' '}
          <span className="font-semibold">higgsfield.ai</span> to get started.
        </p>
      </div>
    </div>
  );
}
