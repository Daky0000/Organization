import { FormEvent, useEffect, useState } from 'react';
import { Bot, Check, ChevronDown, ChevronRight, Eye, EyeOff, ExternalLink, Loader2, RotateCcw, Save } from 'lucide-react';
import { API_BASE_URL } from '../../utils/apiBase';

const authHeaders = (): Record<string, string> => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
};

type Provider = 'anthropic' | 'google';

const ANTHROPIC_MODELS = [
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', note: 'Most capable · recommended' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', note: 'Near-Opus quality · lower cost' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', note: 'Balanced' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', note: 'Fastest · lowest cost' },
];

const GOOGLE_MODELS = [
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', note: 'Most capable · recommended' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', note: 'Fast · low cost' },
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', note: 'Fastest · lowest cost' },
];

const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: 'claude-opus-4-8',
  google: 'gemini-2.5-pro',
};

type Config = {
  model: string;
  provider: Provider;
  apiKeyMasked: string;
  googleApiKeyMasked: string;
  enabled: boolean;
  systemPrompt: string | null;
  defaultSystemPrompt: string;
};

type Tab = 'general' | 'bots' | 'usage';

type UsageTotals = {
  calls: number; input_tokens: number; output_tokens: number; cache_read_tokens: number;
  cost_usd: number; credits_charged: number; credit_value_usd: number; gross_margin_usd: number;
};
type UsageRow = {
  feature?: string; model?: string; email?: string | null; user_id?: string | null;
  calls: string | number; input_tokens: string | number; output_tokens: string | number;
  cost_usd: string | number; credits_charged: string | number;
};

export default function AdminAIConfig() {
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('general');

  // ── Usage & margin tab state ──
  const [usageDays, setUsageDays] = useState(30);
  const [usageTotals, setUsageTotals] = useState<UsageTotals | null>(null);
  const [usageByFeature, setUsageByFeature] = useState<UsageRow[]>([]);
  const [usageTopUsers, setUsageTopUsers] = useState<UsageRow[]>([]);
  const [usageLoading, setUsageLoading] = useState(false);

  useEffect(() => {
    if (activeTab !== 'usage') return;
    setUsageLoading(true);
    fetch(`${API_BASE_URL}/api/admin/ai-usage?days=${usageDays}`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((j) => {
        if (j?.success) {
          setUsageTotals(j.totals ?? null);
          setUsageByFeature(j.byFeature ?? []);
          setUsageTopUsers(j.topUsers ?? []);
        }
      })
      .catch(() => undefined)
      .finally(() => setUsageLoading(false));
  }, [activeTab, usageDays]);

  // General tab state
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [provider, setProvider] = useState<Provider>('anthropic');
  const [model, setModel] = useState('claude-opus-4-8');
  const [apiKey, setApiKey] = useState('');
  const [googleApiKey, setGoogleApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [showGoogleKey, setShowGoogleKey] = useState(false);
  const [showSetupGuide, setShowSetupGuide] = useState(false);

  // AI Bots tab state
  const [promptText, setPromptText] = useState('');
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptSaved, setPromptSaved] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [showFormatGuide, setShowFormatGuide] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE_URL}/api/admin/ai-config`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((data) => {
        if (data.config) {
          setConfig(data.config);
          setProvider(data.config.provider || 'anthropic');
          setModel(data.config.model || 'claude-opus-4-8');
          setApiKey(data.config.apiKeyMasked || '');
          setGoogleApiKey(data.config.googleApiKeyMasked || '');
          setPromptText(data.config.systemPrompt || data.config.defaultSystemPrompt || '');
        }
      })
      .catch(() => setError('Failed to load AI config'))
      .finally(() => setLoading(false));
  }, []);

  const switchProvider = (p: Provider) => {
    setProvider(p);
    setModel(DEFAULT_MODELS[p]);
    setTestResult(null);
  };

  const saveGeneral = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const body: Record<string, string> = { model, provider };
      if (apiKey && !apiKey.startsWith('••')) body.apiKey = apiKey;
      if (googleApiKey && !googleApiKey.startsWith('••')) body.googleApiKey = googleApiKey;
      const res = await fetch(`${API_BASE_URL}/api/admin/ai-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any).error || 'Save failed');
      setConfig(data.config);
      setApiKey(data.config.apiKeyMasked || '');
      setGoogleApiKey(data.config.googleApiKeyMasked || '');
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/ai-config/test`, {
        method: 'POST',
        headers: authHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      setTestResult({ ok: res.ok && (data as any).success, message: (data as any).message || (res.ok ? 'Connection successful' : 'Test failed') });
    } catch {
      setTestResult({ ok: false, message: 'Test request failed' });
    } finally {
      setTesting(false);
    }
  };

  const savePrompt = async () => {
    setPromptError(null);
    setPromptSaved(false);
    setPromptSaving(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/ai-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ systemPrompt: promptText }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any).error || 'Save failed');
      setConfig(data.config);
      setPromptSaved(true);
      setTimeout(() => setPromptSaved(false), 2500);
    } catch (err) {
      setPromptError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setPromptSaving(false);
    }
  };

  const resetPrompt = () => {
    if (config?.defaultSystemPrompt) setPromptText(config.defaultSystemPrompt);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  const hasAnthropicKey = Boolean(config?.apiKeyMasked);
  const hasGoogleKey = Boolean(config?.googleApiKeyMasked);
  const hasActiveKey = provider === 'google' ? hasGoogleKey : hasAnthropicKey;
  const isCustomPrompt = config?.systemPrompt !== null && config?.systemPrompt !== undefined;
  const activeModels = provider === 'google' ? GOOGLE_MODELS : ANTHROPIC_MODELS;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: 'linear-gradient(135deg,#a855f7,#22d3ee)' }}>
          <Bot className="h-5 w-5 text-white" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-slate-900">AI Assistant</h2>
          <p className="text-sm text-slate-500">Configure the LLM that powers Daky and the agent team</p>
        </div>
        <div className="ml-auto">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${hasActiveKey ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${hasActiveKey ? 'bg-emerald-500' : 'bg-slate-400'}`} />
            {hasActiveKey ? 'Configured' : 'Not configured'}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200">
        {(['general', 'bots', 'usage'] as Tab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`px-5 py-3 text-sm font-semibold border-b-2 -mb-px transition-colors capitalize ${
              activeTab === tab ? 'border-slate-950 text-slate-950' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {tab === 'general' ? 'General' : 'AI Bots'}
          </button>
        ))}
      </div>

      {/* ── General Tab ── */}
      {activeTab === 'general' && (
        <>
          {/* Provider selector */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
            <p className="text-sm font-semibold text-slate-700">AI Provider</p>
            <div className="grid grid-cols-2 gap-3">
              {/* Anthropic */}
              <label
                className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3.5 transition-colors ${
                  provider === 'anthropic' ? 'border-purple-400 bg-purple-50' : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <input type="radio" name="provider" value="anthropic" checked={provider === 'anthropic'} onChange={() => switchProvider('anthropic')} className="accent-purple-500" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-bold text-slate-900">Anthropic</span>
                    {hasAnthropicKey && <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">Key saved</span>}
                  </div>
                  <p className="text-xs text-slate-500">Claude models · full tool use</p>
                </div>
                {provider === 'anthropic' && <Check size={15} className="text-purple-500 shrink-0" />}
              </label>

              {/* Google Gemini */}
              <label
                className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3.5 transition-colors ${
                  provider === 'google' ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <input type="radio" name="provider" value="google" checked={provider === 'google'} onChange={() => switchProvider('google')} className="accent-blue-500" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-bold text-slate-900">Google Gemini</span>
                    {hasGoogleKey && <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">Key saved</span>}
                  </div>
                  <p className="text-xs text-slate-500">Gemini models · streaming chat</p>
                </div>
                {provider === 'google' && <Check size={15} className="text-blue-500 shrink-0" />}
              </label>
            </div>

            {provider === 'google' && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
                <strong>Note:</strong> Google Gemini supports streaming chat. Agentic tool use (create drafts, schedule posts) currently requires Anthropic — you can keep both keys saved and switch providers any time.
              </div>
            )}
          </div>

          {/* Setup guide — collapsible */}
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <button
              type="button"
              onClick={() => setShowSetupGuide((v) => !v)}
              className="flex w-full items-center justify-between px-5 py-4 text-sm font-semibold text-slate-800 hover:bg-slate-50 transition-colors"
            >
              <span className="flex items-center gap-2">
                {showSetupGuide ? <ChevronDown size={15} className="text-slate-400" /> : <ChevronRight size={15} className="text-slate-400" />}
                {provider === 'google' ? 'How to get a Google Gemini API key' : 'How to get an Anthropic API key'}
              </span>
              <span className="text-[11px] font-normal text-slate-400">Setup instructions</span>
            </button>

            {showSetupGuide && (
              <div className="border-t border-slate-100 px-5 py-4 space-y-4 text-sm text-slate-600">
                {provider === 'google' ? (
                  <>
                    <p className="text-slate-700 font-medium">Get your Google AI Studio API key in 3 steps:</p>
                    <ol className="space-y-3 list-none">
                      {[
                        { step: '1', title: 'Open Google AI Studio', body: 'Go to aistudio.google.com — sign in with your Google account.', link: 'https://aistudio.google.com', linkLabel: 'Open AI Studio →' },
                        { step: '2', title: 'Enable billing & create an API key', body: 'Click "Get API key" → select a Google Cloud project with billing enabled (or create one). Keys on free-tier projects have a quota of 0 and will fail. Copy the key that starts with AIza…', link: 'https://console.cloud.google.com/billing', linkLabel: 'Set up billing →' },
                        { step: '3', title: 'Paste it here', body: 'Paste the key into the Google API Key field below, select your preferred Gemini model, and click Save.' },
                      ].map((s) => (
                        <li key={s.step} className="flex gap-3">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">{s.step}</span>
                          <div>
                            <p className="font-semibold text-slate-800">{s.title}</p>
                            <p className="text-slate-500 mt-0.5">{s.body}</p>
                            {s.link && (
                              <a href={s.link} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-blue-600 hover:underline text-xs font-medium">
                                {s.linkLabel} <ExternalLink size={11} />
                              </a>
                            )}
                          </div>
                        </li>
                      ))}
                    </ol>
                    <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-800 space-y-1">
                      <p className="font-semibold">Billing required</p>
                      <p>API keys linked to a free-tier Google Cloud project have a quota of 0 and will return a 429 error. You must attach a billing account to your project at console.cloud.google.com/billing. Gemini pricing is pay-per-token and typically very low-cost.</p>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-slate-700 font-medium">Get your Anthropic API key in 3 steps:</p>
                    <ol className="space-y-3 list-none">
                      {[
                        { step: '1', title: 'Open Anthropic Console', body: 'Go to console.anthropic.com — create an account or sign in.', link: 'https://console.anthropic.com', linkLabel: 'Open Console →' },
                        { step: '2', title: 'Create an API key', body: 'In the left sidebar click "API Keys" → "Create Key". Give it a name (e.g. "Dakyworld Production") and copy the key starting with sk-ant-…' },
                        { step: '3', title: 'Paste it here', body: 'Paste the key into the Anthropic API Key field below, select a model, and click Save. We AES-256-GCM encrypt it before storing.' },
                      ].map((s) => (
                        <li key={s.step} className="flex gap-3">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-purple-100 text-xs font-bold text-purple-700">{s.step}</span>
                          <div>
                            <p className="font-semibold text-slate-800">{s.title}</p>
                            <p className="text-slate-500 mt-0.5">{s.body}</p>
                            {s.link && (
                              <a href={s.link} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-purple-600 hover:underline text-xs font-medium">
                                {s.linkLabel} <ExternalLink size={11} />
                              </a>
                            )}
                          </div>
                        </li>
                      ))}
                    </ol>
                    <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-xs text-slate-600 space-y-1">
                      <p className="font-semibold text-slate-700">Billing note</p>
                      <p>Anthropic is pay-per-use. Add a credit card and set a spend limit before going live. Claude Haiku is the most economical for high-volume usage.</p>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Keys + model form */}
          <form onSubmit={saveGeneral} className="rounded-2xl border border-slate-200 bg-white p-6 space-y-5">

            {/* Anthropic key (always shown so both can be saved) */}
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">
                Anthropic API Key
                {provider === 'anthropic' && <span className="ml-2 rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-bold text-purple-700">Active</span>}
              </label>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={hasAnthropicKey ? 'Leave unchanged or enter a new key' : 'sk-ant-…'}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-3 pr-10 text-sm font-mono text-slate-900 placeholder-slate-400 outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-400"
                  autoComplete="off"
                />
                <button type="button" onClick={() => setShowKey((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Get from{' '}
                <a href="https://console.anthropic.com" target="_blank" rel="noreferrer" className="text-purple-500 hover:underline">console.anthropic.com</a>
                {' '}· AES-256 encrypted at rest
              </p>
            </div>

            {/* Google key (always shown) */}
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">
                Google AI API Key
                {provider === 'google' && <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">Active</span>}
              </label>
              <div className="relative">
                <input
                  type={showGoogleKey ? 'text' : 'password'}
                  value={googleApiKey}
                  onChange={(e) => setGoogleApiKey(e.target.value)}
                  placeholder={hasGoogleKey ? 'Leave unchanged or enter a new key' : 'AIzaSy…'}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-3 pr-10 text-sm font-mono text-slate-900 placeholder-slate-400 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
                  autoComplete="off"
                />
                <button type="button" onClick={() => setShowGoogleKey((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  {showGoogleKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Get from{' '}
                <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">aistudio.google.com/apikey</a>
                {' '}· AES-256 encrypted at rest
              </p>
            </div>

            {/* Model selector */}
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">
                Model <span className="text-slate-400 font-normal">({provider === 'google' ? 'Google Gemini' : 'Anthropic Claude'})</span>
              </label>
              <div className="grid gap-2">
                {activeModels.map((m) => (
                  <label
                    key={m.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition-colors ${
                      model === m.id
                        ? provider === 'google' ? 'border-blue-400 bg-blue-50' : 'border-purple-400 bg-purple-50'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <input type="radio" name="model" value={m.id} checked={model === m.id} onChange={() => setModel(m.id)}
                      className={provider === 'google' ? 'accent-blue-500' : 'accent-purple-500'} />
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-slate-900">{m.label}</div>
                      <div className="text-xs text-slate-500">{m.note}</div>
                    </div>
                    {model === m.id && <Check size={16} className={provider === 'google' ? 'text-blue-500' : 'text-purple-500'} />}
                  </label>
                ))}
              </div>
            </div>

            {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

            <div className="flex items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : saved ? <Check size={15} /> : <Save size={15} />}
                {saving ? 'Saving…' : saved ? 'Saved!' : 'Save Changes'}
              </button>
              {hasActiveKey && (
                <button
                  type="button"
                  onClick={testConnection}
                  disabled={testing}
                  className="flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {testing ? <Loader2 size={15} className="animate-spin" /> : <Bot size={15} />}
                  {testing ? 'Testing…' : 'Test Connection'}
                </button>
              )}
            </div>

            {testResult && (
              <div className={`rounded-xl px-3 py-2 text-sm font-medium ${testResult.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                {testResult.message}
              </div>
            )}
          </form>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-600 space-y-1.5">
            <p className="font-semibold text-slate-800">How it works</p>
            <ul className="list-disc list-inside space-y-1 text-slate-500">
              <li>Save both keys — switch provider any time without re-entering them</li>
              <li>The <strong>active provider</strong> is used for Daky chat, team analysis, and agent compilation</li>
              <li>All keys are AES-256-GCM encrypted before being stored — never exposed in API responses</li>
              <li>Agentic tool actions (create draft, schedule post) require Anthropic; Google provider uses direct streaming</li>
            </ul>
          </div>
        </>
      )}

      {/* ── AI Bots Tab ── */}
      {activeTab === 'bots' && (
        <div className="space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: 'linear-gradient(135deg,#a855f7,#22d3ee)' }}>
                  <Bot className="h-4 w-4 text-white" />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-900">Daky Chat Bot</p>
                  <p className="text-xs text-slate-500">Floating assistant visible to all logged-in users</p>
                </div>
              </div>
              {isCustomPrompt && (
                <span className="shrink-0 rounded-full bg-purple-50 px-2.5 py-1 text-xs font-semibold text-purple-700">Custom prompt</span>
              )}
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-sm font-semibold text-slate-700">System Prompt</label>
                <button type="button" onClick={resetPrompt} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800">
                  <RotateCcw size={12} /> Reset to default
                </button>
              </div>
              <textarea
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                rows={14}
                className="w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-400 font-mono leading-relaxed"
                placeholder="Enter the system prompt for the chat bot…"
              />
              <p className="mt-1 text-xs text-slate-400">Changes take effect immediately — no restart required.</p>
              <p className="mt-1 text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2 border border-amber-100">
                <strong>Note:</strong> UI interaction rules are always enforced regardless of what you write here — they cannot be removed.
              </p>
            </div>

            {promptError && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{promptError}</p>}

            <div className="flex items-center gap-3 pt-1">
              <button type="button" onClick={savePrompt} disabled={promptSaving}
                className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50">
                {promptSaving ? <Loader2 size={15} className="animate-spin" /> : promptSaved ? <Check size={15} /> : <Save size={15} />}
                {promptSaving ? 'Saving…' : promptSaved ? 'Saved!' : 'Save Prompt'}
              </button>
            </div>
          </div>

          {/* Format guide */}
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <button type="button" onClick={() => setShowFormatGuide((v) => !v)}
              className="flex w-full items-center justify-between px-5 py-4 text-sm font-semibold text-slate-800 hover:bg-slate-50 transition-colors">
              <span className="flex items-center gap-2">
                {showFormatGuide ? <ChevronDown size={15} className="text-slate-400" /> : <ChevronRight size={15} className="text-slate-400" />}
                Interactive Form Format Guide
              </span>
              <span className="text-[11px] font-normal text-slate-400">How the chat form cards work</span>
            </button>

            {showFormatGuide && (
              <div className="border-t border-slate-100 px-5 py-4 space-y-4 text-sm text-slate-600">
                <p>When the AI responds with a numbered list of questions (each with sub-bullet options), the widget renders them as an interactive chip-selection form.</p>
                <pre className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-xs text-slate-700 whitespace-pre-wrap font-mono leading-relaxed">{`[One short intro sentence:]

1. Question about topic or subject?
   - Suggestion A
   - Suggestion B
   - Custom

2. Question about platform or format?
   - Option A
   - Option B
   - Custom`}</pre>
                <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-800">
                  <strong>Keep the TOOLS section</strong> in your prompt — removing it disables create_draft, schedule_post and other agentic actions.
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Usage & Margin Tab ── */}
      {activeTab === 'usage' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-500">Real provider cost vs. credits charged (1 credit = $0.01 retail, 3× markup on raw API cost).</p>
            <select value={usageDays} onChange={(e) => setUsageDays(Number(e.target.value))}
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
            </select>
          </div>

          {usageLoading && <p className="py-8 text-center text-sm text-slate-400">Loading usage…</p>}

          {!usageLoading && usageTotals && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: 'AI calls', value: usageTotals.calls.toLocaleString() },
                  { label: 'Tokens (in / out)', value: `${(usageTotals.input_tokens / 1000).toFixed(1)}K / ${(usageTotals.output_tokens / 1000).toFixed(1)}K` },
                  { label: 'Provider cost', value: `$${usageTotals.cost_usd.toFixed(2)}` },
                  { label: 'Gross margin', value: `$${usageTotals.gross_margin_usd.toFixed(2)}`, accent: usageTotals.gross_margin_usd >= 0 },
                ].map(({ label, value, accent }) => (
                  <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="text-xs text-slate-500">{label}</p>
                    <p className={`mt-1 text-xl font-bold ${accent === undefined ? 'text-slate-900' : accent ? 'text-emerald-600' : 'text-red-600'}`}>{value}</p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-slate-400">
                Credits charged: {usageTotals.credits_charged.toLocaleString()} (retail value ${usageTotals.credit_value_usd.toFixed(2)}).
                Cache reads saved ~${((usageTotals.cache_read_tokens / 1_000_000) * 4.5).toFixed(2)} vs uncached input.
              </p>

              <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                <p className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-900">By feature & model</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs text-slate-400">
                      <th className="px-4 py-2">Feature</th><th className="px-4 py-2">Model</th>
                      <th className="px-4 py-2 text-right">Calls</th><th className="px-4 py-2 text-right">Cost</th><th className="px-4 py-2 text-right">Credits</th>
                    </tr></thead>
                    <tbody>
                      {usageByFeature.map((r, i) => (
                        <tr key={i} className="border-t border-slate-50">
                          <td className="px-4 py-2 text-slate-700">{r.feature}</td>
                          <td className="px-4 py-2 text-slate-500">{r.model}</td>
                          <td className="px-4 py-2 text-right text-slate-700">{Number(r.calls).toLocaleString()}</td>
                          <td className="px-4 py-2 text-right text-slate-700">${Number(r.cost_usd).toFixed(3)}</td>
                          <td className="px-4 py-2 text-right text-slate-700">{Number(r.credits_charged).toLocaleString()}</td>
                        </tr>
                      ))}
                      {usageByFeature.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">No AI usage recorded yet.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                <p className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-900">Top users</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs text-slate-400">
                      <th className="px-4 py-2">User</th>
                      <th className="px-4 py-2 text-right">Calls</th><th className="px-4 py-2 text-right">Cost</th><th className="px-4 py-2 text-right">Credits</th>
                    </tr></thead>
                    <tbody>
                      {usageTopUsers.map((r, i) => (
                        <tr key={i} className="border-t border-slate-50">
                          <td className="px-4 py-2 text-slate-700">{r.email || r.user_id || 'system'}</td>
                          <td className="px-4 py-2 text-right text-slate-700">{Number(r.calls).toLocaleString()}</td>
                          <td className="px-4 py-2 text-right text-slate-700">${Number(r.cost_usd).toFixed(3)}</td>
                          <td className="px-4 py-2 text-right text-slate-700">{Number(r.credits_charged).toLocaleString()}</td>
                        </tr>
                      ))}
                      {usageTopUsers.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-400">No AI usage recorded yet.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
