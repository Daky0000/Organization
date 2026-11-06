import { useState, useEffect } from 'react';
import { Key, CheckCircle2, XCircle, Loader2, RefreshCw, Sparkles, Video, Image, Edit3 } from 'lucide-react';
import { getApiBaseUrl } from '../../utils/apiBase';

const tok = () => localStorage.getItem('auth_token') ?? '';

const SUPPORTED_MODELS = [
  { id: 'magnific-one',           type: 'Image',   tier: 'Flagship', credits: 6,  label: 'Magnific One (4K & 8/16-Tile Contact Sheets)', badge: 'FLAGSHIP' },
  { id: 'mystic',                 type: 'Image',   tier: 'Premium',  credits: 8,  label: 'Mystic (Photorealism)' },
  { id: 'flux-kontext-pro',       type: 'Image',   tier: 'Quality',  credits: 5,  label: 'Flux Kontext Pro (Multi-Ref & Edit)' },
  { id: 'flux-2-pro',             type: 'Image',   tier: 'Quality',  credits: 5,  label: 'Flux 2 Pro' },
  { id: 'seedream-v5-lite',       type: 'Image',   tier: 'Fast',     credits: 4,  label: 'Seedream 5 Lite', badge: 'NEW' },
  { id: 'seedream-v4-5',          type: 'Image',   tier: 'Quality',  credits: 4,  label: 'Seedream 4.5' },
  { id: 'flux-2-turbo',           type: 'Image',   tier: 'Fast',     credits: 3,  label: 'Flux 2 Turbo' },
  { id: 'flux-2-klein',           type: 'Image',   tier: 'Fast',     credits: 3,  label: 'Flux 2 Klein' },
  { id: 'kling-v2-6-pro',         type: 'Video',   tier: 'Flagship', credits: 30, label: 'Kling 2.6 Pro (T2V/I2V + Native Audio)', badge: 'FLAGSHIP' },
  { id: 'ltx-2-pro',              type: 'Video',   tier: '4K Pro',   credits: 28, label: 'LTX 2 Pro (Up to 4K 50fps + Audio)', badge: '4K' },
  { id: 'wan-2-6-1080p',          type: 'Video',   tier: 'Quality',  credits: 25, label: 'WAN 2.6 (1080p Multi-Shot + Audio)' },
  { id: 'minimax-hailuo-2-3-1080p',type: 'Video',  tier: 'Quality',  credits: 25, label: 'Minimax Hailuo 2.3 (Camera Control)' },
  { id: 'runway-gen4-turbo',      type: 'Video',   tier: 'Quality',  credits: 25, label: 'Runway Gen-4 Turbo / Act-Two' },
  { id: 'wan-2-7-t2v',            type: 'Video',   tier: 'Quality',  credits: 25, label: 'WAN 2.7 T2V' },
  { id: 'omni-human-1-5',         type: 'LipSync', tier: 'Flagship', credits: 30, label: 'OmniHuman 1.5 (Portrait + Audio Lip-Sync)', badge: 'NEW' },
  { id: 'music-generation',       type: 'Audio',   tier: 'Tool',     credits: 6,  label: 'Magnific Music Generation (10–180s)', badge: 'NEW' },
  { id: 'sound-effects',          type: 'Audio',   tier: 'Tool',     credits: 3,  label: 'Magnific Sound Effects (Foley & Loops)', badge: 'NEW' },
  { id: 'audio-isolation',        type: 'Audio',   tier: 'Tool',     credits: 4,  label: 'SAM Audio Isolation (Stem Separation)', badge: 'NEW' },
  { id: 'upscale',                type: 'Edit',    tier: 'Tool',     credits: 5,  label: 'Upscaler Creative (HDR / Resemblance)' },
  { id: 'upscale-precision',      type: 'Edit',    tier: 'Tool',     credits: 5,  label: 'Upscaler Precision V2 (Logos / UI / Faces)' },
  { id: 'image-expand',           type: 'Edit',    tier: 'Tool',     credits: 5,  label: 'Image Expand / Outpaint (Flux Pro)' },
  { id: 'relight',                type: 'Edit',    tier: 'Tool',     credits: 4,  label: 'Relight (Lighting & Environment Transfer)' },
  { id: 'style-transfer',         type: 'Edit',    tier: 'Tool',     credits: 5,  label: 'Style Transfer' },
  { id: 'remove-background',      type: 'Edit',    tier: 'Tool',     credits: 1,  label: 'Remove Background (Instant PNG)' },
  { id: 'magnific-spaces-flows',  type: 'Space',   tier: 'MCP',      credits: 10, label: 'Magnific Spaces & Flows (https://mcp.magnific.com)', badge: 'MCP' },
];

type Generation = {
  id: string;
  user_email: string;
  type: string;
  model: string;
  prompt: string;
  status: string;
  result_url: string | null;
  error: string | null;
  created_at: string;
};

export default function AdminMagnific() {
  const [apiKey, setApiKey]         = useState('');
  const [maskedKey, setMaskedKey]   = useState('');
  const [hasKey, setHasKey]         = useState(false);
  const [saving, setSaving]         = useState(false);
  const [testing, setTesting]       = useState(false);
  const [testResult, setTestResult] = useState<'ok' | 'fail' | null>(null);
  const [testError, setTestError]   = useState('');
  const [testRaw, setTestRaw]       = useState<string>('');
  const [saveMsg, setSaveMsg]       = useState('');

  // Replicate state
  const [rpKey, setRpKey]               = useState('');
  const [rpMaskedKey, setRpMaskedKey]   = useState('');
  const [rpHasKey, setRpHasKey]         = useState(false);
  const [rpSaving, setRpSaving]         = useState(false);
  const [rpTesting, setRpTesting]       = useState(false);
  const [rpTestResult, setRpTestResult] = useState<'ok' | 'fail' | null>(null);
  const [rpTestError, setRpTestError]   = useState('');
  const [rpSaveMsg, setRpSaveMsg]       = useState('');

  const [generations, setGenerations] = useState<Generation[]>([]);
  const [loadingGens, setLoadingGens] = useState(false);
  const [genTypeFilter, setGenTypeFilter] = useState<string>('all');

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` };

  useEffect(() => {
    fetchConfig();
    fetchReplicateConfig();
    fetchGenerations();
  }, []);

  async function fetchConfig() {
    try {
      const r = await fetch(`${getApiBaseUrl()}/api/admin/magnific/config`, { headers });
      const d = await r.json();
      if (d.success) { setHasKey(d.hasKey); setMaskedKey(d.maskedKey ?? ''); }
    } catch { /* ignore */ }
  }

  async function saveKey() {
    if (!apiKey.trim()) return;
    setSaving(true); setSaveMsg('');
    try {
      const r = await fetch(`${getApiBaseUrl()}/api/admin/magnific/config`, {
        method: 'PUT', headers, body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const d = await r.json();
      if (d.success) { setSaveMsg('Saved!'); setApiKey(''); fetchConfig(); }
      else setSaveMsg(d.error ?? 'Save failed');
    } catch (e: any) { setSaveMsg(e.message); } finally { setSaving(false); }
  }

  async function testConnection() {
    setTesting(true); setTestResult(null); setTestError(''); setTestRaw('');
    try {
      const r = await fetch(`${getApiBaseUrl()}/api/admin/magnific/test`, { headers });
      const d = await r.json();
      setTestRaw(JSON.stringify(d, null, 2));
      if (d.success) setTestResult('ok');
      else { setTestResult('fail'); setTestError(d.error ?? 'Connection failed'); }
    } catch (e: any) { setTestResult('fail'); setTestError(e.message); } finally { setTesting(false); }
  }

  async function fetchReplicateConfig() {
    try {
      const r = await fetch(`${getApiBaseUrl()}/api/admin/replicate/config`, { headers });
      const d = await r.json();
      if (d.success) { setRpHasKey(d.hasKey); setRpMaskedKey(d.maskedKey ?? ''); }
    } catch { /* ignore */ }
  }

  async function saveReplicateKey() {
    if (!rpKey.trim()) return;
    setRpSaving(true); setRpSaveMsg('');
    try {
      const r = await fetch(`${getApiBaseUrl()}/api/admin/replicate/config`, {
        method: 'PUT', headers, body: JSON.stringify({ apiKey: rpKey.trim() }),
      });
      const d = await r.json();
      if (d.success) { setRpSaveMsg('Saved!'); setRpKey(''); fetchReplicateConfig(); }
      else setRpSaveMsg(d.error ?? 'Save failed');
    } catch (e: any) { setRpSaveMsg(e.message); } finally { setRpSaving(false); }
  }

  async function testReplicateConnection() {
    setRpTesting(true); setRpTestResult(null); setRpTestError('');
    try {
      const r = await fetch(`${getApiBaseUrl()}/api/admin/replicate/test`, { headers });
      const d = await r.json();
      if (d.success) setRpTestResult('ok');
      else { setRpTestResult('fail'); setRpTestError(d.error ?? 'Connection failed'); }
    } catch (e: any) { setRpTestResult('fail'); setRpTestError(e.message); } finally { setRpTesting(false); }
  }

  async function fetchGenerations() {
    setLoadingGens(true);
    try {
      const r = await fetch(`${getApiBaseUrl()}/api/admin/magnific/generations`, { headers });
      const d = await r.json();
      if (d.success) setGenerations(d.generations ?? []);
    } catch { /* ignore */ } finally { setLoadingGens(false); }
  }

  const filteredGens = genTypeFilter === 'all' ? generations : generations.filter(g => g.type === genTypeFilter);

  return (
    <div className="space-y-8">
      {/* Replicate API Key — Primary provider (no Akamai block) */}
      <div className="rounded-2xl border-2 border-[#2563EB]/30 bg-[#2563EB]/5 p-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#2563EB]/10">
            <Key size={18} className="text-[#2563EB]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900">Replicate API Token</h2>
              <span className="rounded-full bg-[#2563EB] px-2 py-0.5 text-[10px] font-bold text-white">RECOMMENDED</span>
            </div>
            <p className="text-xs text-slate-500">Primary image generation — same Flux models, no IP restrictions. Get a token at replicate.com</p>
          </div>
        </div>

        {rpHasKey && (
          <div className="flex items-center gap-2 mb-4 mt-4 rounded-xl bg-white border border-slate-200 px-3 py-2.5">
            <CheckCircle2 size={14} className="text-green-500 shrink-0" />
            <span className="text-xs text-slate-600">Current token: <span className="font-mono font-semibold">{rpMaskedKey}</span></span>
          </div>
        )}

        <div className="flex gap-2 mt-4 mb-3">
          <input type="password" value={rpKey} onChange={e => setRpKey(e.target.value)}
            placeholder={rpHasKey ? 'Enter new token to replace…' : 'r8_xxxxxxxxxxxxxxxxxxxx'}
            className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder-slate-400 outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]/20" />
          <button type="button" disabled={!rpKey.trim() || rpSaving} onClick={saveReplicateKey}
            className="flex items-center gap-1.5 rounded-xl bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#4a5ae0] disabled:opacity-40 disabled:cursor-not-allowed transition">
            {rpSaving ? <Loader2 size={14} className="animate-spin" /> : null}Save
          </button>
        </div>
        {rpSaveMsg && <p className={`text-xs mb-2 ${rpSaveMsg === 'Saved!' ? 'text-green-600' : 'text-red-500'}`}>{rpSaveMsg}</p>}

        <button type="button" disabled={rpTesting || !rpHasKey} onClick={testReplicateConnection}
          className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition">
          {rpTesting ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Test Connection
          {rpTestResult === 'ok'   && <CheckCircle2 size={14} className="text-green-500 ml-1" />}
          {rpTestResult === 'fail' && <XCircle      size={14} className="text-red-500 ml-1" />}
        </button>
        {rpTestResult === 'ok'   && <p className="text-xs text-green-600 mt-2">Replicate token is valid — image generation will use Replicate.</p>}
        {rpTestResult === 'fail' && <p className="text-xs text-red-500 mt-2">{rpTestError || 'Connection failed'}</p>}
      </div>

      {/* Magnific API Key Section */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#2563EB]/10">
            <Key size={18} className="text-[#2563EB]" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">API Key Configuration</h2>
            <p className="text-xs text-slate-500">Connect your Magnific.com API key to enable AI generation</p>
          </div>
        </div>

        {hasKey && (
          <div className="flex items-center gap-2 mb-4 rounded-xl bg-slate-50 border border-slate-200 px-3 py-2.5">
            <CheckCircle2 size={14} className="text-green-500 shrink-0" />
            <span className="text-xs text-slate-600">Current key: <span className="font-mono font-semibold">{maskedKey}</span></span>
          </div>
        )}

        <div className="flex gap-2 mb-3">
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder={hasKey ? 'Enter new API key to replace…' : 'Enter Magnific API key…'}
            className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder-slate-400 outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]/20"
          />
          <button type="button" disabled={!apiKey.trim() || saving} onClick={saveKey}
            className="flex items-center gap-1.5 rounded-xl bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#4a5ae0] disabled:opacity-40 disabled:cursor-not-allowed transition">
            {saving ? <Loader2 size={14} className="animate-spin" /> : null}
            Save
          </button>
        </div>
        {saveMsg && <p className={`text-xs mb-2 ${saveMsg === 'Saved!' ? 'text-green-600' : 'text-red-500'}`}>{saveMsg}</p>}

        <button type="button" disabled={testing || !hasKey} onClick={testConnection}
          className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition">
          {testing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Test Connection
          {testResult === 'ok'   && <CheckCircle2 size={14} className="text-green-500 ml-1" />}
          {testResult === 'fail' && <XCircle      size={14} className="text-red-500 ml-1" />}
        </button>
        {testResult === 'ok'   && <p className="text-xs text-green-600 mt-2">Connection successful — API key is valid and image was generated.</p>}
        {testResult === 'fail' && <p className="text-xs text-red-500 mt-2">{testError || 'Connection failed'}</p>}
        {testRaw && (
          <details className="mt-2">
            <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600">Raw API response (debug)</summary>
            <pre className="mt-1 text-[10px] text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-2 overflow-x-auto whitespace-pre-wrap">{testRaw}</pre>
          </details>
        )}
      </div>

      {/* Supported Models */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="text-base font-bold text-slate-900 mb-4">Supported Models</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="pb-2 text-left text-xs font-semibold text-slate-500">Model</th>
                <th className="pb-2 text-left text-xs font-semibold text-slate-500">Type</th>
                <th className="pb-2 text-left text-xs font-semibold text-slate-500">Tier</th>
                <th className="pb-2 text-right text-xs font-semibold text-slate-500">Credits</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {SUPPORTED_MODELS.map(m => (
                <tr key={m.id} className="hover:bg-slate-50 transition">
                  <td className="py-2 pr-4">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-slate-800">{m.label}</span>
                      {'badge' in m && m.badge && (
                        <span className="rounded-full bg-[#2563EB]/10 px-1.5 py-0.5 text-[9px] font-bold text-[#2563EB]">{m.badge}</span>
                      )}
                    </div>
                  </td>
                  <td className="py-2 pr-4">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      m.type === 'Image' ? 'bg-blue-50 text-blue-600' :
                      m.type === 'Video' ? 'bg-purple-50 text-purple-600' :
                                           'bg-amber-50 text-amber-600'
                    }`}>
                      {m.type === 'Image' ? <Image size={9} /> : m.type === 'Video' ? <Video size={9} /> : <Edit3 size={9} />}
                      {m.type}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-xs text-slate-500">{m.tier}</td>
                  <td className="py-2 text-right text-xs font-bold text-[#2563EB]">✦{m.credits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Generation History */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-slate-900">Generation History</h2>
          <div className="flex items-center gap-2">
            <select value={genTypeFilter} onChange={e => setGenTypeFilter(e.target.value)}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700 outline-none focus:border-[#2563EB]">
              <option value="all">All types</option>
              <option value="magnific-one">Magnific One</option>
              <option value="image">Image</option>
              <option value="video">Video</option>
              <option value="lip-sync">Lip Sync (OmniHuman 1.5)</option>
              <option value="audio">Audio (Music / SFX / SAM)</option>
              <option value="upscale">Upscale Creative</option>
              <option value="upscale-precision">Upscale Precision</option>
              <option value="image-expand">Image Expand / Outpaint</option>
              <option value="relight">Relight</option>
              <option value="style-transfer">Style Transfer</option>
              <option value="remove-background">Remove BG</option>
              <option value="space">Magnific Space</option>
              <option value="flow">Magnific Flow</option>
            </select>
            <button type="button" onClick={fetchGenerations} disabled={loadingGens}
              className="flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition">
              {loadingGens ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Refresh
            </button>
          </div>
        </div>

        {filteredGens.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400">
            <Sparkles size={24} className="mb-2 opacity-40" />
            <p className="text-sm">{loadingGens ? 'Loading…' : 'No generations yet'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="pb-2 text-left text-xs font-semibold text-slate-500">User</th>
                  <th className="pb-2 text-left text-xs font-semibold text-slate-500">Type</th>
                  <th className="pb-2 text-left text-xs font-semibold text-slate-500">Model</th>
                  <th className="pb-2 text-left text-xs font-semibold text-slate-500">Prompt</th>
                  <th className="pb-2 text-left text-xs font-semibold text-slate-500">Status</th>
                  <th className="pb-2 text-left text-xs font-semibold text-slate-500">Date</th>
                  <th className="pb-2 text-right text-xs font-semibold text-slate-500">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filteredGens.map(g => (
                  <tr key={g.id} className="hover:bg-slate-50 transition">
                    <td className="py-2 pr-3 text-xs text-slate-600 max-w-[120px] truncate">{g.user_email ?? '—'}</td>
                    <td className="py-2 pr-3">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        g.type === 'image' ? 'bg-blue-50 text-blue-600' :
                        g.type === 'video' ? 'bg-purple-50 text-purple-600' :
                                             'bg-amber-50 text-amber-600'
                      }`}>{g.type}</span>
                    </td>
                    <td className="py-2 pr-3 text-xs text-slate-600">{g.model}</td>
                    <td className="py-2 pr-3 text-xs text-slate-500 max-w-[180px] truncate">{g.prompt || '—'}</td>
                    <td className="py-2 pr-3">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        g.status === 'completed' ? 'bg-green-50 text-green-600' :
                        g.status === 'failed'    ? 'bg-red-50 text-red-600' :
                        g.status === 'processing'? 'bg-yellow-50 text-yellow-600' :
                                                   'bg-slate-100 text-slate-500'
                      }`}>{g.status}</span>
                      {g.error && <p className="text-[9px] text-red-400 mt-0.5 max-w-[120px] truncate" title={g.error}>{g.error}</p>}
                    </td>
                    <td className="py-2 pr-3 text-xs text-slate-400 whitespace-nowrap">
                      {new Date(g.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="py-2 text-right">
                      {g.result_url ? (
                        <a href={g.result_url} target="_blank" rel="noreferrer"
                          className="inline-block rounded-lg overflow-hidden border border-slate-200 hover:border-[#2563EB] transition">
                          <img src={g.result_url} alt="" className="h-10 w-10 object-cover" />
                        </a>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
