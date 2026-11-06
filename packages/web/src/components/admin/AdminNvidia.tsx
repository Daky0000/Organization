import { useEffect, useState } from 'react';
import { CheckCircle2, Cpu, Image as ImageIcon, Key, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { getApiBaseUrl } from '../../utils/apiBase';

// Admin → NVIDIA. The free NVIDIA models Dakyworld OS runs on, with the same
// per-job ladders: every one-shot generation (post copy, captions, plans,
// summaries) tries these in order before the paid key in AI Assistant, and
// content-plan images try FLUX before Gemini/OpenAI.

type CatalogueModel = { id: string; name: string; down?: string };
type Ladders = { text: string[]; fast: string[]; agent: string[]; image: string[] };
type Config = {
  hasKey: boolean; maskedKey: string; keySource: 'admin' | 'env' | 'os' | null; enabled: boolean;
  ladders: Ladders; defaults: Ladders;
  catalogue: { chat: CatalogueModel[]; image: CatalogueModel[] };
};
type TestResult = { model: string; ok: boolean; ms: number; reply?: string; error?: string };

const tok = () => localStorage.getItem('auth_token') ?? '';
const LADDER_INFO: Record<keyof Ladders, { label: string; note: string }> = {
  text: { label: 'Writing', note: 'Post copy, captions, campaign text — anything a customer reads.' },
  fast: { label: 'Quick tasks', note: 'Classifying, extracting, short structured answers. Small fast model first.' },
  agent: { label: 'Agents', note: 'The assistant chat, the AI team, Nova and the other agents. Every model here must call tools; after three failed tries the paid model takes over and continues.' },
  image: { label: 'Images', note: 'Content-plan featured images when Magnific is not set or fails. Only FLUX.2 Klein serves today.' },
};

export default function AdminNvidia() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [ladders, setLadders] = useState<Ladders | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [results, setResults] = useState<TestResult[] | null>(null);
  const [toolResults, setToolResults] = useState<TestResult[] | null>(null);
  const [liveLadders, setLiveLadders] = useState<Omit<Ladders, 'image'> | null>(null);
  const [imgTesting, setImgTesting] = useState(false);
  const [imgResult, setImgResult] = useState<{ ok: boolean; text: string; preview?: string } | null>(null);

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` };

  const apply = (d: any) => { if (d?.success) { setCfg(d); setLadders(d.ladders); } };

  useEffect(() => {
    fetch(`${getApiBaseUrl()}/api/admin/nvidia/config`, { headers }).then((r) => r.json()).then(apply).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(body: Record<string, unknown>, okText: string) {
    setSaving(true); setMsg(null);
    try {
      const r = await fetch(`${getApiBaseUrl()}/api/admin/nvidia/config`, { method: 'PUT', headers, body: JSON.stringify(body) });
      const d = await r.json();
      if (d.success) { apply(d); setMsg({ ok: true, text: okText }); setApiKey(''); }
      else setMsg({ ok: false, text: d.error ?? 'Save failed' });
    } catch (e: any) { setMsg({ ok: false, text: e.message }); } finally { setSaving(false); }
  }

  async function runTest() {
    setTesting(true); setResults(null); setToolResults(null); setLiveLadders(null);
    try {
      const r = await fetch(`${getApiBaseUrl()}/api/admin/nvidia/test`, { method: 'POST', headers });
      const d = await r.json();
      if (Array.isArray(d.results)) {
        // Working models first: the list is every candidate, and most of NVIDIA's catalogue comes and goes.
        const byOk = (a: TestResult, b: TestResult) => Number(b.ok) - Number(a.ok) || a.ms - b.ms;
        setResults([...d.results].sort(byOk));
        setToolResults(Array.isArray(d.toolResults) ? [...d.toolResults].sort(byOk) : null);
        setLiveLadders(d.liveLadders ?? null);
      }
      else setMsg({ ok: false, text: d.error ?? 'Test failed' });
    } catch (e: any) { setMsg({ ok: false, text: e.message }); } finally { setTesting(false); }
  }

  async function runImageTest() {
    setImgTesting(true); setImgResult(null);
    try {
      const r = await fetch(`${getApiBaseUrl()}/api/admin/nvidia/test-image`, { method: 'POST', headers });
      const d = await r.json();
      setImgResult(d.success
        ? { ok: true, text: `${d.model} drew it in ${(d.ms / 1000).toFixed(1)} s`, preview: d.preview }
        : { ok: false, text: d.error ?? 'Image test failed' });
    } catch (e: any) { setImgResult({ ok: false, text: e.message }); } finally { setImgTesting(false); }
  }

  if (!cfg || !ladders) return <div className="flex justify-center py-12"><Loader2 size={20} className="animate-spin text-slate-300" /></div>;

  const setRung = (job: keyof Ladders, index: number, value: string) => {
    const next = [...ladders[job]];
    next[index] = value;
    setLadders({ ...ladders, [job]: next.filter(Boolean) });
  };

  const inputCls = 'rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]/20';
  const btn = 'inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border-2 border-[#76B900]/40 bg-[#76B900]/5 p-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#76B900]/15"><Key size={18} className="text-[#4d7a00]" /></div>
          <div>
            <h2 className="text-base font-bold text-slate-900">NVIDIA free models</h2>
            <p className="text-xs text-slate-500">
              The same free models and job assignments as Dakyworld OS. Tried first for all writing and every agent; after three failed tries the paid key in AI Assistant takes over.
              One key works for every model — get it at <a className="underline" href="https://build.nvidia.com/settings/api-keys" target="_blank" rel="noreferrer">build.nvidia.com</a> (the same key the OS uses).
            </p>
          </div>
        </div>

        {cfg.hasKey && (
          <div className="flex items-center gap-2 mt-4 rounded-xl bg-white border border-slate-200 px-3 py-2.5">
            <CheckCircle2 size={14} className="text-green-500 shrink-0" />
            <span className="text-xs text-slate-600">Current key: <span className="font-mono font-semibold">{cfg.maskedKey}</span>{cfg.keySource === 'env' && ' (from NVIDIA_API_KEY — saving here replaces it)'}{cfg.keySource === 'os' && ' — the OS key, shared through the partner link (chat models only; paste a key here to use your own and get free images)'}</span>
          </div>
        )}
        <div className="flex gap-2 mt-4">
          <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
            placeholder={cfg.hasKey ? 'Enter new key to replace…' : 'nvapi-…'} className={`flex-1 ${inputCls}`} />
          <button type="button" disabled={!apiKey.trim() || saving} onClick={() => void save({ apiKey: apiKey.trim() }, 'Key saved.')}
            className={`${btn} bg-[#2563EB] text-white hover:bg-[#1D4ED8]`}>{saving ? <Loader2 size={14} className="animate-spin" /> : null}Save</button>
        </div>

        <label className="mt-4 flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={cfg.enabled} disabled={saving}
            onChange={(e) => void save({ enabled: e.target.checked }, e.target.checked ? 'Free models switched on.' : 'Free models switched off — everything uses the paid key.')} />
          <span className="text-sm font-semibold text-slate-700">Use the free models first</span>
        </label>

        {msg && <p className={`text-xs mt-3 ${msg.ok ? 'text-green-600' : 'text-red-500'}`}>{msg.text}</p>}

        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" disabled={testing || !cfg.hasKey} onClick={() => void runTest()} className={`${btn} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}>
            {testing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} {testing ? 'Checking every free model…' : 'Test every model'}
          </button>
          <button type="button" disabled={imgTesting || !cfg.hasKey} onClick={() => void runImageTest()} className={`${btn} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}>
            {imgTesting ? <Loader2 size={14} className="animate-spin" /> : <ImageIcon size={14} />} Test image
          </button>
        </div>
        {liveLadders && (
          <div className="mt-3 rounded-xl border border-[#76B900]/30 bg-white p-3 text-xs space-y-1">
            <p className="font-semibold text-slate-700">Now in use (only models that answered)</p>
            {(Object.keys(liveLadders) as Array<keyof typeof liveLadders>).map((job) => (
              <p key={job} className="text-slate-600"><span className="font-semibold">{LADDER_INFO[job].label}:</span>{' '}
                {liveLadders[job].length ? <span className="font-mono">{liveLadders[job].join(' → ')}</span> : <span className="text-red-500">none answered — the paid key is used</span>}</p>
            ))}
          </div>
        )}
        {results && (
          <div className="mt-3 space-y-1">
            {results.map((r) => (
              <div key={r.model} className="flex items-start gap-2 text-xs">
                {r.ok ? <CheckCircle2 size={13} className="mt-0.5 text-green-500 shrink-0" /> : <XCircle size={13} className="mt-0.5 text-red-500 shrink-0" />}
                <span className="font-mono text-slate-700">{r.model}</span>
                <span className="text-slate-400">{(r.ms / 1000).toFixed(1)} s</span>
                {!r.ok && <span className="text-red-500">{r.error}</span>}
              </div>
            ))}
          </div>
        )}
        {toolResults && (
          <div className="mt-3 space-y-1">
            <p className="text-xs font-semibold text-slate-600">Agents — tool calling</p>
            {toolResults.map((r) => (
              <div key={r.model} className="flex items-start gap-2 text-xs">
                {r.ok ? <CheckCircle2 size={13} className="mt-0.5 text-green-500 shrink-0" /> : <XCircle size={13} className="mt-0.5 text-red-500 shrink-0" />}
                <span className="font-mono text-slate-700">{r.model}</span>
                <span className="text-slate-400">{(r.ms / 1000).toFixed(1)} s</span>
                {!r.ok && <span className="text-red-500">{r.error}</span>}
              </div>
            ))}
          </div>
        )}
        {imgResult && (
          <div className="mt-3 text-xs">
            <p className={imgResult.ok ? 'text-green-600' : 'text-red-500'}>{imgResult.text}</p>
            {imgResult.preview && <img src={imgResult.preview} alt="NVIDIA test image" className="mt-2 h-32 w-32 rounded-lg border border-slate-200 object-cover" />}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex items-center gap-2 mb-1"><Cpu size={16} className="text-slate-500" /><h2 className="text-base font-bold text-slate-900">Which free model does which job</h2></div>
        <p className="text-xs text-slate-500 mb-4">Tried top to bottom, one attempt each; if all fail, the paid key takes over. Models marked “down” did not serve when last checked in the OS.</p>
        {(Object.keys(LADDER_INFO) as Array<keyof Ladders>).map((job) => {
          const options = job === 'image' ? cfg.catalogue.image : cfg.catalogue.chat;
          return (
            <div key={job} className="mb-5">
              <p className="text-sm font-semibold text-slate-800">{LADDER_INFO[job].label}</p>
              <p className="text-xs text-slate-500 mb-2">{LADDER_INFO[job].note}</p>
              <div className="grid gap-2 sm:grid-cols-3">
                {[0, 1, 2].map((i) => (
                  <select key={i} value={ladders[job][i] ?? ''} onChange={(e) => setRung(job, i, e.target.value)} className={inputCls}>
                    <option value="">{i === 0 ? 'Default' : '— none —'}</option>
                    {options.map((m) => <option key={m.id} value={m.id}>{i + 1}. {m.name}{m.down ? ' (down)' : ''}</option>)}
                  </select>
                ))}
              </div>
            </div>
          );
        })}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={saving} onClick={() => void save({ textModels: ladders.text, fastModels: ladders.fast, agentModels: ladders.agent, imageModels: ladders.image }, 'Model order saved.')}
            className={`${btn} bg-slate-950 text-white hover:bg-slate-800`}>{saving ? <Loader2 size={14} className="animate-spin" /> : null}Save model order</button>
          <button type="button" disabled={saving} onClick={() => void save({ textModels: [], fastModels: [], agentModels: [], imageModels: [] }, 'Restored the OS defaults.')}
            className={`${btn} border border-slate-200 text-slate-600 hover:bg-slate-50`}>Restore OS defaults</button>
        </div>
      </div>
    </div>
  );
}
