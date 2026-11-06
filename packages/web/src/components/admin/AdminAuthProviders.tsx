import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Check,
  CheckCircle,
  Copy,
  ExternalLink,
  Loader2,
  Power,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

interface ProviderField {
  id: string;
  label: string;
  placeholder: string;
  type: 'text' | 'password';
  helpText: string;
}

interface AuthProviderDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  accentClass: string;
  fields: ProviderField[];
  loginButtonLabel: string;
  docsUrl: string;
  expectedCallbackPath: string;
  setupSteps: string[];
}

interface ProviderRow {
  provider: string;
  config: Record<string, string>;
  enabled: boolean;
}

type RedirectCheckItem = {
  label: string;
  passed: boolean;
  detail: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const rawApiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim();
const API_BASE_URL = rawApiBaseUrl.includes('api.yourdomain.com') ? '' : rawApiBaseUrl.replace(/\/$/, '');

const authHeaders = (): Record<string, string> => {
  const token = localStorage.getItem('auth_token');
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
};

const getBackendBase = () => {
  if (typeof window === 'undefined') return API_BASE_URL;
  return (API_BASE_URL || window.location.origin).replace(/\/$/, '');
};

const getFrontendBase = () => {
  if (typeof window === 'undefined') return 'https://marketing.dakyx.com';
  return window.location.origin.replace(/\/$/, '');
};

const buildRedirectUri = (provider: AuthProviderDef) => `${getBackendBase()}${provider.expectedCallbackPath}`;
const buildDeauthorizeUrl = (provider: AuthProviderDef) => `${getBackendBase()}/api/oauth/${provider.id}/deauthorize`;
const buildDataDeletionCallbackUrl = (provider: AuthProviderDef) => `${getBackendBase()}/api/oauth/${provider.id}/data-deletion`;
const buildDataDeletionPageUrl = () => `${getFrontendBase()}/data-deletion`;

// ── Supported auth providers ───────────────────────────────────────────────────

const AUTH_PROVIDERS: AuthProviderDef[] = [
  {
    id: 'google',
    name: 'Google',
    description: 'Let users sign in with their Google account via OAuth 2.0. Requires a Google Cloud project with OAuth credentials.',
    icon: 'G',
    accentClass: 'bg-white border border-line text-ink font-bold',
    loginButtonLabel: 'Continue with Google',
    docsUrl: 'https://console.cloud.google.com/apis/credentials',
    expectedCallbackPath: '/auth/google/callback',
    setupSteps: [
      'Open Google Cloud Console (console.cloud.google.com) → Select or create a project.',
      'Go to APIs & Services → Credentials → Create Credentials → OAuth client ID (Application type: Web application).',
      'Under "Authorized redirect URIs", paste the Valid OAuth Redirect URI (`/auth/google/callback`) and verify with the Redirect URI Validator.',
      'Copy the Client ID and Client Secret into the fields below.',
    ],
    fields: [
      { id: 'clientId', label: 'Client ID', placeholder: 'xxxx.apps.googleusercontent.com', type: 'text', helpText: 'OAuth 2.0 Client ID from Google Cloud Console → APIs & Services → Credentials.' },
      { id: 'clientSecret', label: 'Client secret', placeholder: 'GOCSPX-...', type: 'password', helpText: 'Keep this secret. Never expose it to the browser.' },
      { id: 'redirectUri', label: 'Redirect URI', placeholder: 'https://YOUR-BACKEND/auth/google/callback', type: 'text', helpText: 'Must be added to the authorized redirect URIs in your Google Cloud app.' },
    ],
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Let users sign in with their GitHub account. Requires a GitHub OAuth App.',
    icon: '⬡',
    accentClass: 'bg-[#24292e] text-white font-bold',
    loginButtonLabel: 'Continue with GitHub',
    docsUrl: 'https://github.com/settings/developers',
    expectedCallbackPath: '/auth/github/callback',
    setupSteps: [
      'Open GitHub Settings → Developer settings → OAuth Apps (github.com/settings/developers) → New OAuth App.',
      'Set Homepage URL to your site URL and Authorization callback URL to the Valid OAuth Redirect URI (`/auth/github/callback`).',
      'Generate a new client secret, then copy Client ID and Client Secret into the form below.',
      'Optionally register the Deauthorize and Data Deletion webhook URLs below for compliance audits.',
    ],
    fields: [
      { id: 'clientId', label: 'Client ID', placeholder: 'Ov23li...', type: 'text', helpText: 'Client ID from your GitHub OAuth App settings.' },
      { id: 'clientSecret', label: 'Client secret', placeholder: 'GitHub client secret', type: 'password', helpText: 'Used server-side to exchange the authorization code.' },
      { id: 'redirectUri', label: 'Callback URL', placeholder: 'https://YOUR-BACKEND/auth/github/callback', type: 'text', helpText: 'Must match the callback URL registered in your GitHub OAuth App.' },
    ],
  },
  {
    id: 'microsoft',
    name: 'Microsoft',
    description: 'Let users sign in with their Microsoft / Azure AD account.',
    icon: '⊞',
    accentClass: 'bg-[#0078d4] text-white font-bold',
    loginButtonLabel: 'Continue with Microsoft',
    docsUrl: 'https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',
    expectedCallbackPath: '/auth/microsoft/callback',
    setupSteps: [
      'Open Microsoft Azure Portal (portal.azure.com) → Azure Active Directory / Microsoft Entra ID → App registrations → New registration.',
      'Choose Supported account types (e.g. Accounts in any organizational directory and personal Microsoft accounts).',
      'Set Redirect URI (Web) to the Valid OAuth Redirect URI (`/auth/microsoft/callback`) and run the Redirect URI Validator.',
      'Under Certificates & secrets, generate a New client secret and copy its Value (not Secret ID) along with Application (client) ID.',
    ],
    fields: [
      { id: 'clientId', label: 'Application (client) ID', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', type: 'text', helpText: 'Found in Azure Portal → App registrations overview.' },
      { id: 'clientSecret', label: 'Client secret value', placeholder: 'Azure client secret value', type: 'password', helpText: 'Generate under Certificates & secrets → New client secret.' },
      { id: 'tenantId', label: 'Tenant ID', placeholder: 'common', type: 'text', helpText: 'Use "common" for personal + work accounts, or your Azure tenant GUID.' },
      { id: 'redirectUri', label: 'Redirect URI', placeholder: 'https://YOUR-BACKEND/auth/microsoft/callback', type: 'text', helpText: 'Must be added to the Redirect URIs (Web) in Azure App registration.' },
    ],
  },
];

function evaluateRedirectUri(
  candidateRaw: string,
  provider: AuthProviderDef,
  configuredFormValue: string
): { valid: boolean; canonicalUri: string; checks: RedirectCheckItem[] } {
  const canonicalUri = buildRedirectUri(provider);
  const candidate = candidateRaw.trim();
  const expectedPath = provider.expectedCallbackPath;
  const backendBase = getBackendBase();

  if (!candidate) {
    return {
      valid: false,
      canonicalUri,
      checks: [
        {
          label: 'URI provided',
          passed: false,
          detail: `Enter a URI to validate against ${canonicalUri}`,
        },
      ],
    };
  }

  let parsed: URL | null = null;
  try {
    parsed = new URL(candidate);
  } catch {
    parsed = null;
  }

  if (!parsed) {
    return {
      valid: false,
      canonicalUri,
      checks: [
        {
          label: 'Valid URL syntax',
          passed: false,
          detail: 'The URI is not a valid absolute URL (must include https:// or http://localhost).',
        },
      ],
    };
  }

  const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  const isSecureScheme = parsed.protocol === 'https:' || (parsed.protocol === 'http:' && isLocalhost);

  let expectedOrigin = '';
  try {
    expectedOrigin = new URL(backendBase).origin;
  } catch {
    expectedOrigin = backendBase;
  }

  const originMatches = parsed.origin === expectedOrigin;
  const exactPathMatches = parsed.pathname === expectedPath;
  const noTrailingSlashIssue = !parsed.pathname.endsWith('/') || expectedPath.endsWith('/');
  const noQueryOrHash = !parsed.search && !parsed.hash;
  const formTrimmed = configuredFormValue.trim();
  const matchesFormField = Boolean(formTrimmed) && formTrimmed === candidate;

  const checks: RedirectCheckItem[] = [
    {
      label: 'HTTPS / Secure OAuth Protocol',
      passed: isSecureScheme,
      detail: isSecureScheme
        ? `Using ${parsed.protocol}// (${isLocalhost ? 'localhost allowed' : 'HTTPS verified'})`
        : `OAuth providers require https:// in production (found ${parsed.protocol}//)`,
    },
    {
      label: 'Backend Origin Match',
      passed: originMatches,
      detail: originMatches
        ? `Origin matches backend host ${expectedOrigin}`
        : `Origin ${parsed.origin} differs from backend ${expectedOrigin}`,
    },
    {
      label: 'Exact Callback Route Path',
      passed: exactPathMatches && noTrailingSlashIssue,
      detail: exactPathMatches
        ? `Path matches ${expectedPath} exactly`
        : `Expected path ${expectedPath}, but found ${parsed.pathname}`,
    },
    {
      label: 'No Query Strings or URL Fragments',
      passed: noQueryOrHash,
      detail: noQueryOrHash
        ? 'Clean callback URI without query or fragment parameters'
        : 'Remove ?query and #fragments from registered OAuth redirect URIs',
    },
    {
      label: 'Matches Form Redirect URI',
      passed: matchesFormField,
      detail: matchesFormField
        ? 'Matches the Redirect URI input field in this form'
        : 'Does not match the form input above — click "Auto-fill Valid URI" to synchronize',
    },
  ];

  return {
    valid: checks.every((c) => c.passed),
    canonicalUri,
    checks,
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

const AdminAuthProviders = () => {
  const [providerRows, setProviderRows] = useState<Record<string, ProviderRow>>({});
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  // Copy state
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Redirect validator state
  const [validatorInput, setValidatorInput] = useState('');

  const copyValue = (key: string, value: string) => {
    navigator.clipboard?.writeText(value);
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey((prev) => (prev === key ? null : prev));
    }, 2000);
  };

  const fetchProviders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/auth-providers`, { headers: authHeaders() });
      if (!res.ok) throw new Error('Failed');
      const data = (await res.json()) as { success: boolean; providers: ProviderRow[] };
      if (data.success) {
        const map: Record<string, ProviderRow> = {};
        for (const row of data.providers) map[row.provider] = row;
        setProviderRows(map);
      }
    } catch {
      /* ignore */
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchProviders();
  }, [fetchProviders]);

  const handleToggle = async (providerId: string, currentEnabled: boolean) => {
    setToggling(providerId);
    const row = providerRows[providerId];
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/auth-providers/${providerId}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ config: row?.config ?? {}, enabled: !currentEnabled }),
      });
      const data = (await res.json()) as { success: boolean };
      if (data.success) {
        setProviderRows((prev) => ({
          ...prev,
          [providerId]: { provider: providerId, config: row?.config ?? {}, enabled: !currentEnabled },
        }));
      }
    } catch {
      /* ignore */
    }
    setToggling(null);
  };

  const openConfigure = (id: string) => {
    const def = AUTH_PROVIDERS.find((p) => p.id === id) ?? null;
    const existing = providerRows[id]?.config ?? {};
    const merged = { ...existing };
    if (!merged.redirectUri && def) {
      merged.redirectUri = buildRedirectUri(def);
    }
    setDraftValues(merged);
    setActiveId(id);
    setSaveError(null);
    setSaveSuccess(null);
    if (def) {
      setValidatorInput(merged.redirectUri || buildRedirectUri(def));
    }
  };

  const handleSave = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!activeId) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(null);
    try {
      const currentEnabled = providerRows[activeId]?.enabled ?? false;
      const res = await fetch(`${API_BASE_URL}/api/admin/auth-providers/${activeId}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ config: draftValues, enabled: currentEnabled }),
      });
      const data = (await res.json()) as { success: boolean; error?: string };
      if (!data.success) throw new Error(data.error || 'Save failed');
      setProviderRows((prev) => ({
        ...prev,
        [activeId]: { provider: activeId, config: draftValues, enabled: prev[activeId]?.enabled ?? false },
      }));
      setSaveSuccess('Provider configuration saved successfully.');
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    }
    setSaving(false);
  };

  const activeDef = AUTH_PROVIDERS.find((p) => p.id === activeId) ?? null;

  const activeValidation = useMemo(() => {
    if (!activeDef) return null;
    const formVal = draftValues.redirectUri || '';
    return evaluateRedirectUri(validatorInput, activeDef, formVal);
  }, [activeDef, draftValues.redirectUri, validatorInput]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-2xl border border-line bg-white px-6 py-6 shadow-xs">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-blue">OAuth Login & Single Sign-On</div>
            <h2 className="mt-1 text-2xl font-extrabold tracking-[-0.03em] text-ink">Login Providers</h2>
            <p className="mt-1 text-sm text-muted">
              Configure OAuth 2.0 social login options, Redirect URIs, Deauthorize Callback URLs, and Data Deletion Request URLs.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-soft px-3 py-1.5 font-mono text-[11px] text-ink">
            <ShieldCheck size={13} className="text-emerald" />
            Data Deletion Page: {buildDataDeletionPageUrl()}
          </span>
        </div>
      </div>

      {/* Preview banner */}
      <div className="rounded-2xl border border-blue/20 bg-blue/5 px-5 py-4">
        <div className="text-xs font-bold uppercase tracking-[0.12em] text-blue">User Login Screen Preview</div>
        <div className="mt-3 flex flex-wrap gap-3">
          {AUTH_PROVIDERS.filter((p) => providerRows[p.id]?.enabled).map((p) => (
            <div key={p.id} className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm shadow-xs ${p.accentClass}`}>
              <span className="text-base">{p.icon}</span>
              {p.loginButtonLabel}
            </div>
          ))}
          {AUTH_PROVIDERS.every((p) => !providerRows[p.id]?.enabled) && (
            <span className="text-sm text-muted italic">No providers enabled — only email/password login is shown to users.</span>
          )}
        </div>
      </div>

      {/* Provider cards */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={28} className="animate-spin text-muted" />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {AUTH_PROVIDERS.map((provider) => {
            const row = providerRows[provider.id];
            const isEnabled = row?.enabled ?? false;
            const isConfigured = row !== undefined && Object.keys(row.config).length > 0;
            const isToggling = toggling === provider.id;

            const redirectUrl = buildRedirectUri(provider);
            const deauthorizeUrl = buildDeauthorizeUrl(provider);
            const dataDeletionUrl = buildDataDeletionCallbackUrl(provider);

            return (
              <div
                key={provider.id}
                className={`flex flex-col justify-between rounded-2xl border bg-white p-5 transition-all ${
                  isEnabled ? 'border-emerald/40 shadow-xs' : 'border-line hover:border-slate-300'
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className={`flex h-12 w-12 items-center justify-center rounded-xl text-lg ${provider.accentClass}`}>
                      {provider.icon}
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleToggle(provider.id, isEnabled)}
                      disabled={isToggling || (!isConfigured && !isEnabled)}
                      title={!isConfigured && !isEnabled ? 'Configure credentials first' : isEnabled ? 'Disable for users' : 'Enable for users'}
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                        isEnabled
                          ? 'bg-emerald/10 text-emerald hover:bg-emerald/20'
                          : 'bg-soft text-muted hover:bg-slate-200/70'
                      }`}
                    >
                      {isToggling ? <Loader2 size={12} className="animate-spin" /> : <Power size={12} />}
                      {isEnabled ? 'Enabled' : 'Disabled'}
                    </button>
                  </div>

                  <div className="mt-3">
                    <h3 className="text-base font-bold text-ink">{provider.name}</h3>
                    <p className="mt-1 text-xs leading-5 text-muted">{provider.description}</p>
                  </div>

                  {/* Setup & Callback URLs box */}
                  <div className="mt-4 space-y-2 rounded-xl border border-line bg-soft/70 px-3.5 py-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">OAuth Callback & Compliance</span>
                      <a
                        href={provider.docsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue hover:underline"
                      >
                        <ExternalLink size={11} />
                        Console
                      </a>
                    </div>

                    <div className="space-y-1.5 pt-1">
                      <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-white px-2.5 py-1.5">
                        <div className="min-w-0">
                          <div className="text-[10px] font-semibold text-muted">Redirect URI</div>
                          <div className="truncate font-mono text-[11px] text-ink">{redirectUrl}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => copyValue(`card-redir-${provider.id}`, redirectUrl)}
                          className="shrink-0 rounded-md border border-line bg-soft px-2 py-1 text-[10px] font-semibold text-ink hover:bg-slate-200/60"
                        >
                          {copiedKey === `card-redir-${provider.id}` ? 'Copied ✓' : 'Copy'}
                        </button>
                      </div>

                      <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-white px-2.5 py-1.5">
                        <div className="min-w-0">
                          <div className="text-[10px] font-semibold text-muted">Data Deletion Request URL</div>
                          <div className="truncate font-mono text-[11px] text-ink">{dataDeletionUrl}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => copyValue(`card-del-${provider.id}`, dataDeletionUrl)}
                          className="shrink-0 rounded-md border border-line bg-soft px-2 py-1 text-[10px] font-semibold text-ink hover:bg-slate-200/60"
                        >
                          {copiedKey === `card-del-${provider.id}` ? 'Copied ✓' : 'Copy'}
                        </button>
                      </div>

                      <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-white px-2.5 py-1.5">
                        <div className="min-w-0">
                          <div className="text-[10px] font-semibold text-muted">Deauthorize Callback URL</div>
                          <div className="truncate font-mono text-[11px] text-ink">{deauthorizeUrl}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => copyValue(`card-deauth-${provider.id}`, deauthorizeUrl)}
                          className="shrink-0 rounded-md border border-line bg-soft px-2 py-1 text-[10px] font-semibold text-ink hover:bg-slate-200/60"
                        >
                          {copiedKey === `card-deauth-${provider.id}` ? 'Copied ✓' : 'Copy'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-line pt-3.5">
                  <span className={`text-xs font-semibold ${isConfigured ? 'text-emerald' : 'text-amber'}`}>
                    {isConfigured ? 'Credentials saved' : 'Not configured'}
                  </span>
                  <button
                    type="button"
                    onClick={() => openConfigure(provider.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                  >
                    <SlidersHorizontal size={12} />
                    {isConfigured ? 'Reconfigure & Guide' : 'Configure & Guide'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Configure modal */}
      {activeDef && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/60 backdrop-blur-xs px-4 py-6">
          <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-line px-6 py-4">
              <div className="flex items-center gap-3">
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl text-lg ${activeDef.accentClass}`}>
                  {activeDef.icon}
                </div>
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-blue">OAuth Setup & Compliance</div>
                  <h3 className="text-lg font-extrabold text-ink">{activeDef.name} Login Provider</h3>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setActiveId(null);
                  setSaveError(null);
                  setSaveSuccess(null);
                }}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-white text-muted hover:bg-soft hover:text-ink"
              >
                <X size={16} />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSave} className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
              {/* Setup Guide Box */}
              <div className="rounded-xl border border-line bg-soft/60 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-ink">
                    <BookOpen size={14} className="text-blue" />
                    Console Setup Guide
                  </div>
                  <a
                    href={activeDef.docsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1 text-xs font-semibold text-blue hover:bg-soft"
                  >
                    <ExternalLink size={12} />
                    Open {activeDef.name} Developer Console
                  </a>
                </div>

                <ol className="space-y-1.5 text-xs leading-5 text-muted list-decimal list-inside">
                  {activeDef.setupSteps.map((step, idx) => (
                    <li key={idx} className="text-ink/90">
                      {step}
                    </li>
                  ))}
                </ol>

                {/* Callback & Compliance URLs */}
                <div className="grid gap-2 pt-1 sm:grid-cols-2">
                  <div className="sm:col-span-2 rounded-xl border border-line bg-white p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold text-ink">Valid OAuth Redirect URI</span>
                      <button
                        type="button"
                        onClick={() => copyValue('auth-modal-redirect', buildRedirectUri(activeDef))}
                        className="inline-flex items-center gap-1 rounded-md border border-line bg-soft px-2.5 py-1 text-[11px] font-semibold text-ink hover:bg-slate-200/70"
                      >
                        {copiedKey === 'auth-modal-redirect' ? <Check size={12} className="text-emerald" /> : <Copy size={12} />}
                        {copiedKey === 'auth-modal-redirect' ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <div className="mt-1 select-all break-all font-mono text-xs text-blue">
                      {buildRedirectUri(activeDef)}
                    </div>
                  </div>

                  <div className="rounded-xl border border-line bg-white p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold text-ink">Data Deletion Request URL</span>
                      <button
                        type="button"
                        onClick={() => copyValue('auth-modal-del', buildDataDeletionCallbackUrl(activeDef))}
                        className="inline-flex items-center gap-1 rounded-md border border-line bg-soft px-2 py-1 text-[11px] font-semibold text-ink hover:bg-slate-200/70"
                      >
                        {copiedKey === 'auth-modal-del' ? <Check size={12} className="text-emerald" /> : <Copy size={12} />}
                        {copiedKey === 'auth-modal-del' ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <div className="mt-1 select-all break-all font-mono text-xs text-ink">
                      {buildDataDeletionCallbackUrl(activeDef)}
                    </div>
                  </div>

                  <div className="rounded-xl border border-line bg-white p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold text-ink">Deauthorize Callback URL</span>
                      <button
                        type="button"
                        onClick={() => copyValue('auth-modal-deauth', buildDeauthorizeUrl(activeDef))}
                        className="inline-flex items-center gap-1 rounded-md border border-line bg-soft px-2 py-1 text-[11px] font-semibold text-ink hover:bg-slate-200/70"
                      >
                        {copiedKey === 'auth-modal-deauth' ? <Check size={12} className="text-emerald" /> : <Copy size={12} />}
                        {copiedKey === 'auth-modal-deauth' ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <div className="mt-1 select-all break-all font-mono text-xs text-ink">
                      {buildDeauthorizeUrl(activeDef)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Fields */}
              <div className="space-y-4">
                <div className="text-xs font-bold uppercase tracking-[0.12em] text-ink">Client Credentials</div>
                {activeDef.fields.map((field) => (
                  <label key={field.id} className="block space-y-1.5">
                    <span className="text-xs font-semibold text-ink">{field.label}</span>
                    <input
                      type={field.type}
                      value={draftValues[field.id] ?? ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        setDraftValues((c) => ({ ...c, [field.id]: val }));
                        if (field.id === 'redirectUri') {
                          setValidatorInput(val);
                        }
                      }}
                      placeholder={field.placeholder}
                      className="h-10 w-full rounded-xl border border-line bg-soft px-4 text-sm text-ink outline-none focus:border-blue focus:bg-white"
                    />
                    <p className="text-[11px] text-muted">{field.helpText}</p>
                  </label>
                ))}
              </div>

              {/* Redirect URI Validator */}
              {activeValidation && (
                <div className="rounded-xl border border-line bg-soft/50 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.12em] text-ink">
                        <ShieldCheck size={15} className="text-blue" />
                        Redirect URI Validator
                      </div>
                      <p className="mt-0.5 text-xs text-muted">
                        Verify that the URI registered in {activeDef.name} console matches the backend route.
                      </p>
                    </div>
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${
                        activeValidation.valid ? 'bg-emerald/10 text-emerald' : 'bg-amber/15 text-amber'
                      }`}
                    >
                      {activeValidation.valid ? (
                        <>
                          <CheckCircle size={13} /> Valid URI
                        </>
                      ) : (
                        <>
                          <AlertTriangle size={13} /> Check URI
                        </>
                      )}
                    </span>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      type="text"
                      value={validatorInput}
                      onChange={(e) => setValidatorInput(e.target.value)}
                      placeholder={activeValidation.canonicalUri}
                      className="flex-1 rounded-xl border border-line bg-white px-3.5 py-2 font-mono text-xs text-ink outline-none focus:border-blue"
                    />
                    {!activeValidation.valid && (
                      <button
                        type="button"
                        onClick={() => {
                          const canonical = activeValidation.canonicalUri;
                          setValidatorInput(canonical);
                          setDraftValues((c) => ({ ...c, redirectUri: canonical }));
                        }}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-3 py-2 text-xs font-semibold text-ink hover:bg-soft"
                      >
                        <Sparkles size={13} className="text-blue" />
                        Auto-fill Valid URI
                      </button>
                    )}
                  </div>

                  {/* Checklist */}
                  <div className="grid gap-1.5 pt-1 sm:grid-cols-2">
                    {activeValidation.checks.map((chk, idx) => (
                      <div
                        key={idx}
                        className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
                          chk.passed ? 'border-emerald/25 bg-emerald/5 text-ink' : 'border-amber/30 bg-amber/5 text-ink'
                        }`}
                      >
                        {chk.passed ? (
                          <CheckCircle size={14} className="mt-0.5 shrink-0 text-emerald" />
                        ) : (
                          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber" />
                        )}
                        <div className="min-w-0">
                          <div className="font-semibold">{chk.label}</div>
                          <div className="text-[11px] text-muted break-words">{chk.detail}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Status alerts */}
              {saveError && <p className="rounded-xl border border-danger/30 bg-danger/5 px-4 py-2.5 text-xs text-danger">{saveError}</p>}
              {saveSuccess && (
                <p className="flex items-center gap-2 rounded-xl border border-emerald/30 bg-emerald/5 px-4 py-2.5 text-xs font-medium text-emerald">
                  <CheckCircle size={14} /> {saveSuccess}
                </p>
              )}

              {/* Footer */}
              <div className="flex items-center justify-between border-t border-line pt-4">
                <div className="text-xs text-muted">
                  <CheckCircle size={14} className="inline-block mr-1 text-emerald" />
                  Credentials are encrypted server-side.
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveId(null);
                      setSaveError(null);
                      setSaveSuccess(null);
                    }}
                    className="rounded-xl border border-line bg-white px-4 py-2 text-sm font-semibold text-ink hover:bg-soft"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex items-center gap-2 rounded-xl bg-navy px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                  >
                    {saving && <Loader2 size={13} className="animate-spin" />}
                    {saving ? 'Saving…' : 'Save credentials'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminAuthProviders;
