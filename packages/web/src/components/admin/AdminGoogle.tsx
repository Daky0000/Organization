import { useState, useEffect } from 'react';
import { Key, CheckCircle2, XCircle, Loader2, Image, Video, Clapperboard } from 'lucide-react';
import { getApiBaseUrl } from '../../utils/apiBase';

const tok = () => localStorage.getItem('auth_token') ?? '';

const GOOGLE_IMAGE_MODELS = [
  { id: 'google-imagen-4-fast',   label: 'Imagen 4 Fast',        tier: 'Fast',    credits: 4,  desc: 'Best speed / quality balance'       },
  { id: 'google-imagen-4',        label: 'Imagen 4',             tier: 'Quality', credits: 6,  desc: 'High-quality photorealistic images'  },
  { id: 'google-imagen-4-ultra',  label: 'Imagen 4 Ultra',       tier: 'Premium', credits: 10, desc: 'Maximum quality, finest detail'      },
  { id: 'google-gemini-flash',    label: 'Gemini Flash Image',   tier: 'Fast',    credits: 3,  desc: 'Fast multimodal image generation'    },
  { id: 'google-gemini-nano-2',   label: 'Nano Banana 2',        tier: 'Quality', credits: 5,  desc: 'Creative image generation (Gen 3)'   },
  { id: 'google-gemini-nano-pro', label: 'Nano Banana Pro',      tier: 'Premium', credits: 8,  desc: 'Pro-grade creative generation'       },
];

const GOOGLE_VIDEO_MODELS = [
  { id: 'google-veo-3-fast', label: 'Veo 3.1 Fast', credits: 25, desc: 'Fast high-quality video generation' },
  { id: 'google-veo-3',      label: 'Veo 3.1',      credits: 40, desc: 'Flagship Google video model'        },
];

const tierColor: Record<string, string> = {
  Premium: 'bg-purple-50 text-purple-700',
  Quality: 'bg-indigo-50 text-indigo-700',
  Fast:    'bg-sky-50 text-sky-700',
};

type Generation = {
  id: string; user_email: string; type: string; model: string;
  prompt: string; status: string; result_url: string | null;
  error: string | null; created_at: string; credits_used: number;
};

export default function AdminGoogle() {
  const [apiKey, setApiKey]         = useState('');
  const [imgbbKey, setImgbbKey]     = useState('');
  const [maskedKey, setMaskedKey]   = useState('');
  const [hasKey, setHasKey]         = useState(false);
  const [saving, setSaving]         = useState(false);
  const [saveMsg, setSaveMsg]       = useState('');
  const [testing, setTesting]       = useState(false);
  const [testResult, setTestResult] = useState<'ok' | 'fail' | null>(null);
  const [testError, setTestError]   = useState('');
  const [testModels, setTestModels] = useState<string[]>([]);
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [loadingGens, setLoadingGens] = useState(false);

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` };

  useEffect(() => { fetchConfig(); fetchGenerations(); }, []);

  async function fetchConfig() {
    try {
      const r = await fetch(`${getApiBaseUrl()}/api/admin/google/config`, { headers });
      const d = await r.json();
      if (d.success) { setHasKey(d.hasKey); setMaskedKey(d.maskedKey ?? ''); }
    } catch { /* ignore */ }
  }

  async function saveKeys() {
    if (!apiKey.trim() && !imgbbKey.trim()) return;
    setSaving(true); setSaveMsg('');
    try {
      const r = await fetch(`${getApiBaseUrl()}/api/admin/google/config`, {
        method: 'PUT', headers,
        body: JSON.stringify({ apiKey: apiKey.trim() || undefined, imgbbKey: imgbbKey.trim() || undefined }),
      });
      const d = await r.json();
      if (d.success) { setSaveMsg('Saved!'); setApiKey(''); setImgbbKey(''); fetchConfig(); }
      else setSaveMsg(d.error ?? 'Save failed');
    } catch (e: any) { setSaveMsg(e.message); } finally { setSaving(false); }
  }

  async function testConnection() {
    setTesting(true); setTestResult(null); setTestError(''); setTestModels([]);
    try {
      const r = await fetch(`${getApiBaseUrl()}/api/admin/google/test`, { headers });
      const d = await r.json();
      if (d.success) { setTestResult('ok'); setTestModels(d.models ?? []); }
      else { setTestResult('fail'); setTestError(d.error ?? 'Connection failed'); }
    } catch (e: any) { setTestResult('fail'); setTestError(e.message); } finally { setTesting(false); }
  }

  async function fetchGenerations() {
    setLoadingGens(true);
    try {
      const r = await fetch(`${getApiBaseUrl()}/api/admin/google/generations`, { headers });
      const d = await r.json();
      if (d.success) setGenerations(d.generations ?? []);
    } catch { /* ignore */ } finally { setLoadingGens(false); }
  }

  const statusDot = (s: string) => {
    if (s === 'completed') return 'bg-emerald-500';
    if (s === 'failed')    return 'bg-rose-500';
    if (s === 'processing') return 'bg-amber-400';
    return 'bg-slate-300';
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-4xl font-black tracking-[-0.04em] text-slate-950">Google AI</h1>
        <p className="mt-2 text-base text-slate-500">
          Native Google Gemini API — Imagen 4 images, Gemini image models, and Veo 3.1 video.
          Get your API key at{' '}
          <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-indigo-600 underline">
            aistudio.google.com/app/apikey
          </a>
        </p>
      </div>

      {/* API Keys */}
      <div className="rounded-[28px] border border-slate-200 bg-white p-6">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100">
            <Key size={18} className="text-slate-600" />
          </div>
          <div>
            <div className="font-bold text-slate-900">API Keys</div>
            <div className="text-sm text-slate-500">
              Google API key required · imgbb key optional (for persistent image URLs)
            </div>
          </div>
          {hasKey && (
            <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
              <CheckCircle2 size={12} /> Configured
            </span>
          )}
        </div>

        {hasKey && maskedKey && (
          <div className="mb-4 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
            <div className="text-xs font-semibold text-slate-400">Google API Key</div>
            <div className="mt-1 font-mono text-sm text-slate-700">{maskedKey}</div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <input value={apiKey} onChange={(e) => setApiKey(e.target.value)}
            placeholder="Google / Gemini API Key (AIza...)"
            className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
          <input value={imgbbKey} onChange={(e) => setImgbbKey(e.target.value)}
            placeholder="imgbb API Key (optional — for persistent image URLs)"
            className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Without an imgbb key, generated images are stored as data URLs in the database (works but uses more storage).
          Get a free imgbb key at{' '}
          <a href="https://api.imgbb.com" target="_blank" rel="noreferrer" className="text-indigo-500 underline">api.imgbb.com</a>.
        </p>

        <div className="mt-4 flex items-center gap-3">
          <button onClick={() => void saveKeys()} disabled={saving || (!apiKey.trim() && !imgbbKey.trim())}
            className="rounded-2xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40">
            {saving ? 'Saving…' : 'Save Keys'}
          </button>
          {hasKey && (
            <button onClick={() => void testConnection()} disabled={testing}
              className="rounded-2xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-40">
              {testing ? <><Loader2 size={14} className="mr-1.5 inline animate-spin" />Testing…</> : 'Test Connection'}
            </button>
          )}
          {saveMsg && (
            <span className={`text-sm font-semibold ${saveMsg === 'Saved!' ? 'text-emerald-600' : 'text-rose-600'}`}>
              {saveMsg}
            </span>
          )}
        </div>

        {testResult && (
          <div className={`mt-4 flex items-start gap-3 rounded-2xl border p-4 ${testResult === 'ok' ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'}`}>
            {testResult === 'ok'
              ? <CheckCircle2 size={18} className="mt-0.5 text-emerald-600 shrink-0" />
              : <XCircle size={18} className="mt-0.5 text-rose-600 shrink-0" />}
            <div>
              {testResult === 'ok' ? (
                <>
                  <div className="font-semibold text-emerald-700">Connected</div>
                  {testModels.length > 0 && (
                    <div className="mt-1 text-xs text-emerald-600">
                      Available models (sample): {testModels.map((m) => m.replace('models/', '')).join(', ')}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="font-semibold text-rose-700">Failed</div>
                  <div className="mt-0.5 text-sm text-rose-600">{testError}</div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Models */}
      <div className="rounded-[28px] border border-slate-200 bg-white p-6">
        <div className="mb-5 font-bold text-slate-900">Supported Models</div>

        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-500">
          <Image size={14} /> Image Models
        </div>
        <div className="mb-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {GOOGLE_IMAGE_MODELS.map((m) => (
            <div key={m.id} className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
              <div>
                <div className="text-sm font-semibold text-slate-800">{m.label}</div>
                <div className="text-xs text-slate-400">{m.desc}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-3">
                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${tierColor[m.tier]}`}>{m.tier}</span>
                <span className="text-xs font-bold text-slate-500">✦{m.credits}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-500">
          <Video size={14} /> Video Models (Veo)
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {GOOGLE_VIDEO_MODELS.map((m) => (
            <div key={m.id} className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
              <div>
                <div className="text-sm font-semibold text-slate-800">{m.label}</div>
                <div className="text-xs text-slate-400">{m.desc}</div>
              </div>
              <span className="text-xs font-bold text-slate-500">✦{m.credits}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Generations */}
      <div className="rounded-[28px] border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
          <div className="flex items-center gap-2 font-bold text-slate-900">
            <Clapperboard size={16} /> Recent Generations
          </div>
          <button onClick={() => void fetchGenerations()}
            className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600">
            {loadingGens ? 'Loading…' : 'Refresh'}
          </button>
        </div>
        {generations.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-slate-400">No generations yet</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {generations.slice(0, 50).map((g) => (
              <div key={g.id} className="flex items-start gap-4 px-6 py-4">
                <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${statusDot(g.status)}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-500 uppercase">{g.type}</span>
                    <span className="text-xs text-slate-400">{g.model}</span>
                    <span className="ml-auto text-xs text-slate-400">{new Date(g.created_at).toLocaleDateString()}</span>
                  </div>
                  <div className="mt-0.5 truncate text-sm text-slate-700">{g.prompt}</div>
                  <div className="mt-0.5 text-xs text-slate-400">{g.user_email}</div>
                  {g.error && <div className="mt-1 text-xs text-rose-600">{g.error}</div>}
                  {g.result_url && !g.result_url.startsWith('data:') && (
                    <a href={g.result_url} target="_blank" rel="noreferrer" className="mt-1 text-xs text-indigo-600 underline">View result</a>
                  )}
                  {g.result_url?.startsWith('data:') && (
                    <span className="mt-1 text-xs text-slate-400 italic">Stored as data URL</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
