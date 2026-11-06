import CreditManagement from './CreditManagement';
import { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  DollarSign,
  ExternalLink,
  Eye,
  EyeOff,
  RefreshCw,
  XCircle,
} from 'lucide-react';

const rawApiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim();
const API_BASE_URL = rawApiBaseUrl.includes('api.yourdomain.com') ? '' : rawApiBaseUrl.replace(/\/$/, '');

const authHeaders = () => {
  const token = localStorage.getItem('auth_token');
  return { Authorization: `Bearer ${token ?? ''}`, 'Content-Type': 'application/json' };
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface HubtelConfig {
  clientId: string;
  clientSecret: string;
  merchantAccountNumber: string;
  senderId: string;
}

interface PaystackConfig {
  mode: 'test' | 'live';
  testSecretKey: string;
  testPublicKey: string;
  liveSecretKey: string;
  livePublicKey: string;
  currency: string;
  fxRate: string;
}

interface SmsLog {
  id: string;
  recipient: string;
  sender_id: string | null;
  content: string;
  context: string;
  status: 'sent' | 'failed';
  provider_response: { error?: string } | null;
  created_at: string;
  user_email: string | null;
}

interface PaymentStats {
  total: number;
  successful: number;
  pending: number;
  failed: number;
  revenue: number;
}

interface PaymentTransaction {
  id: string;
  amount: number;
  currency: string;
  description: string | null;
  status: 'pending' | 'successful' | 'failed';
  provider: string;
  client_reference: string | null;
  provider_reference: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  created_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const CALLBACK_URL = `${API_BASE_URL}/api/payments/hubtel/callback`;

const fmt = (n: number, currency = 'GHS') =>
  new Intl.NumberFormat('en-GH', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n);

const StatusBadge = ({ status }: { status: PaymentTransaction['status'] }) => {
  if (status === 'successful')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
        <CheckCircle2 size={12} /> Successful
      </span>
    );
  if (status === 'pending')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
        <Clock size={12} /> Pending
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-600">
      <XCircle size={12} /> Failed
    </span>
  );
};

// ── Setup Step ────────────────────────────────────────────────────────────────

const SetupStep = ({
  step,
  title,
  children,
}: {
  step: number;
  title: string;
  children: React.ReactNode;
}) => (
  <div className="flex gap-4">
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-black text-white">
      {step}
    </div>
    <div className="pt-0.5">
      <div className="text-sm font-bold text-slate-900">{title}</div>
      <div className="mt-1 text-sm leading-6 text-slate-500">{children}</div>
    </div>
  </div>
);

// ── Main Component ────────────────────────────────────────────────────────────

const PaymentManagement = () => {
  const [config, setConfig] = useState<HubtelConfig>({ clientId: '', clientSecret: '', merchantAccountNumber: '', senderId: '' });
  const [showSecret, setShowSecret] = useState(false);
  const [configLoading, setConfigLoading] = useState(true);
  const [configSaving, setConfigSaving] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [configSuccess, setConfigSuccess] = useState(false);

  const [stats, setStats] = useState<PaymentStats | null>(null);
  const [transactions, setTransactions] = useState<PaymentTransaction[]>([]);
  const [txLoading, setTxLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | PaymentTransaction['status']>('all');

  // ── Paystack state ──────────────────────────────────────────────────────────
  const [psConfig, setPsConfig] = useState<PaystackConfig>({ mode: 'test', testSecretKey: '', testPublicKey: '', liveSecretKey: '', livePublicKey: '', currency: 'GHS', fxRate: '1' });
  const [psLoading, setPsLoading] = useState(true);
  const [psSaving, setPsSaving] = useState(false);
  const [psShowSecret, setPsShowSecret] = useState(false);
  const [psError, setPsError] = useState<string | null>(null);
  const [psSuccess, setPsSuccess] = useState(false);
  const [psTesting, setPsTesting] = useState(false);
  const [psTestResult, setPsTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    const load = async () => {
      setPsLoading(true);
      try {
        const res = await fetch(`${API_BASE_URL}/api/admin/platform-configs/paystack`, { headers: authHeaders() });
        const data = await res.json() as { success: boolean; config: { config: Partial<PaystackConfig> } | null };
        if (data.success && data.config?.config) {
          setPsConfig({
            mode: data.config.config.mode === 'live' ? 'live' : 'test',
            testSecretKey: data.config.config.testSecretKey || '',
            testPublicKey: data.config.config.testPublicKey || '',
            liveSecretKey: data.config.config.liveSecretKey || '',
            livePublicKey: data.config.config.livePublicKey || '',
            currency: data.config.config.currency || 'GHS',
            fxRate: String(data.config.config.fxRate ?? '1'),
          });
        }
      } catch { /* ignore */ } finally {
        setPsLoading(false);
      }
    };
    void load();
  }, []);

  const savePaystack = async () => {
    setPsSaving(true);
    setPsError(null);
    setPsSuccess(false);
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/platform-configs/paystack`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ config: psConfig, enabled: Boolean(psConfig[psConfig.mode === 'live' ? 'liveSecretKey' : 'testSecretKey']) }),
      });
      const data = await res.json() as { success: boolean; error?: string };
      if (!data.success) throw new Error(data.error || 'Failed to save');
      setPsSuccess(true);
      setTimeout(() => setPsSuccess(false), 4000);
    } catch (err) {
      setPsError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setPsSaving(false);
    }
  };

  const testPaystack = async () => {
    setPsTesting(true);
    setPsTestResult(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/paystack/test`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ mode: psConfig.mode }) });
      const data = await res.json() as { success: boolean; mode?: string; totalTransactions?: number | null; error?: string };
      if (data.success) {
        setPsTestResult({ ok: true, message: `Connected — ${data.mode === 'live' ? 'LIVE' : 'test'} key accepted${typeof data.totalTransactions === 'number' ? `, ${data.totalTransactions} transactions on the account` : ''}.` });
      } else {
        setPsTestResult({ ok: false, message: data.error || `Test failed (${res.status})` });
      }
    } catch (err) {
      setPsTestResult({ ok: false, message: err instanceof Error ? err.message : 'Test failed' });
    } finally {
      setPsTesting(false);
    }
  };

  // ── Messaging (SMS & OTP) state ─────────────────────────────────────────────
  const [smsTo, setSmsTo] = useState('');
  const [smsContent, setSmsContent] = useState('Test message from your ContentFlow admin console.');
  const [smsSending, setSmsSending] = useState(false);
  const [smsResult, setSmsResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [smsLogs, setSmsLogs] = useState<SmsLog[]>([]);
  const [smsLogsLoading, setSmsLogsLoading] = useState(true);

  const loadSmsLogs = async () => {
    setSmsLogsLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/hubtel/sms/logs`, { headers: authHeaders() });
      const data = await res.json() as { success: boolean; logs: SmsLog[] };
      if (data.success) setSmsLogs(data.logs ?? []);
    } catch { /* ignore */ } finally {
      setSmsLogsLoading(false);
    }
  };

  useEffect(() => { void loadSmsLogs(); }, []);

  const sendTestSms = async () => {
    setSmsSending(true);
    setSmsResult(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/hubtel/sms/test`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ to: smsTo, content: smsContent }),
      });
      const data = await res.json() as { success: boolean; error?: string };
      if (data.success) {
        setSmsResult({ ok: true, message: `Test SMS sent to ${smsTo}. Check the handset — delivery usually takes a few seconds.` });
      } else {
        setSmsResult({ ok: false, message: data.error || `Send failed (${res.status})` });
      }
      void loadSmsLogs();
    } catch (err) {
      setSmsResult({ ok: false, message: err instanceof Error ? err.message : 'Send failed' });
    } finally {
      setSmsSending(false);
    }
  };

  // ── Load config ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      setConfigLoading(true);
      try {
        const res = await fetch(`${API_BASE_URL}/api/admin/platform-configs/hubtel`, { headers: authHeaders() });
        const data = await res.json() as { success: boolean; config: { config: HubtelConfig } | null };
        if (data.success && data.config?.config) {
          setConfig({
            clientId: data.config.config.clientId || '',
            clientSecret: data.config.config.clientSecret || '',
            merchantAccountNumber: data.config.config.merchantAccountNumber || '',
            senderId: data.config.config.senderId || '',
          });
        }
      } catch { /* ignore */ } finally {
        setConfigLoading(false);
      }
    };
    void load();
  }, []);

  // ── Load stats + transactions ───────────────────────────────────────────────
  const loadTransactions = async () => {
    setTxLoading(true);
    try {
      const response=await fetch(`${API_BASE_URL}/api/admin/paystack/orders?mode=${psConfig.mode}`,{ headers: authHeaders() });
      const result=await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to load payments');
      setStats(result.stats);setTransactions(result.transactions || []);

    } catch { /* ignore */ } finally {
      setTxLoading(false);
    }
  };

  useEffect(() => { void loadTransactions(); }, [psConfig.mode]);

  // ── Save config ─────────────────────────────────────────────────────────────
  const saveConfig = async () => {
    setConfigSaving(true);
    setConfigError(null);
    setConfigSuccess(false);
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/platform-configs/hubtel`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ config, enabled: true }),
      });
      const data = await res.json() as { success: boolean; error?: string };
      if (!data.success) throw new Error(data.error || 'Failed to save');
      setConfigSuccess(true);
      setTimeout(() => setConfigSuccess(false), 4000);
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setConfigSaving(false);
    }
  };

  const filteredTransactions = statusFilter === 'all'
    ? transactions
    : transactions.filter((t) => t.status === statusFilter);

  const isConfigured = config.clientId.length > 0 && config.clientSecret.length > 0;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-8 p-6 md:p-8">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-black tracking-[-0.03em] text-slate-950">Payments</h1>
        <p className="mt-1 text-sm text-slate-500">
          Configure Paystack checkout, choose test or live mode, and review payments. Hubtel messaging remains available below.
        </p>
      </div>

      {/* ── Stats ────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: psConfig.mode === 'test' ? 'Test Revenue' : 'Live Revenue', value: stats ? fmt(Number(stats.revenue), psConfig.currency) : '—', icon: DollarSign, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'Successful', value: stats?.successful ?? '—', icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'Pending', value: stats?.pending ?? '—', icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50' },
          { label: 'Failed', value: stats?.failed ?? '—', icon: XCircle, color: 'text-red-600', bg: 'bg-red-50' },
        ].map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${card.bg}`}>
                <Icon size={20} className={card.color} />
              </div>
              <div className="mt-4 text-2xl font-black text-slate-900">{card.value}</div>
              <div className="mt-0.5 text-sm text-slate-500">{card.label}</div>
            </div>
          );
        })}
      </div>

      {/* ── Paystack ─────────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#00c3f7] text-lg font-black text-white">
              P
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-900">Paystack</h2>
              <label className="mt-3 flex flex-wrap items-center gap-3 text-sm font-semibold text-slate-700">
                Payment mode
                <select aria-label="Paystack payment mode" value={psConfig.mode} onChange={e => { setPsConfig({ ...psConfig, mode: e.target.value as 'test' | 'live' }); setPsSuccess(false); setPsTestResult(null); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2">
                  <option value="test">Test — sandbox payments</option>
                  <option value="live">Live — real payments</option>
                </select>
              </label>
              <p className="mt-2 text-sm text-slate-600">{psConfig.mode === 'test' ? 'Administrators can test checkout. Test plans and credits do not change live accounts.' : 'Customers pay real money. Save live credentials and verify the connection before accepting payments.'}</p>

              <p className="text-sm text-slate-500">
                Card and mobile-money checkout for plans and credit packs. Test payments stay in the sandbox.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {psConfig[psConfig.mode === 'live' ? 'liveSecretKey' : 'testSecretKey'] && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                <CheckCircle2 size={13} /> Configured
              </span>
            )}
            <a
              href="https://paystack.com/docs/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
            >
              <ExternalLink size={13} /> Paystack Docs
            </a>
          </div>
        </div>

        {psLoading ? (
          <div className="space-y-3">
            {[1, 2].map((n) => <div key={n} className="h-12 animate-pulse rounded-2xl bg-slate-100" />)}
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid gap-5 md:grid-cols-2">
              <label className="block space-y-2">
                <span className="text-sm font-semibold text-slate-800">Secret Key</span>
                <div className="relative">
                  <input
                    type={psShowSecret ? 'text' : 'password'}
                    value={psConfig[psConfig.mode === 'live' ? 'liveSecretKey' : 'testSecretKey']}
                    onChange={(e) => setPsConfig((c) => ({ ...c, [psConfig.mode === 'live' ? 'liveSecretKey' : 'testSecretKey']: e.target.value }))}
                    placeholder="sk_test_… or sk_live_…"
                    className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 pr-12 text-sm text-slate-800 outline-none focus:border-slate-400"
                  />
                  <button
                    type="button"
                    onClick={() => setPsShowSecret((s) => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {psShowSecret ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                <p className="text-xs text-slate-500">Paystack Dashboard → Settings → API Keys &amp; Webhooks.</p>
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-semibold text-slate-800">Public Key</span>
                <input
                  type="text"
                  value={psConfig[psConfig.mode === 'live' ? 'livePublicKey' : 'testPublicKey']}
                  onChange={(e) => setPsConfig((c) => ({ ...c, [psConfig.mode === 'live' ? 'livePublicKey' : 'testPublicKey']: e.target.value }))}
                  placeholder="pk_test_… or pk_live_…"
                  className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-800 outline-none focus:border-slate-400"
                />
                <p className="text-xs text-slate-500">Optional — only needed for inline/popup checkout later.</p>
              </label>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <label className="block space-y-2">
                <span className="text-sm font-semibold text-slate-800">Charge Currency</span>
                <select
                  value={psConfig.currency}
                  onChange={(e) => setPsConfig((c) => ({ ...c, currency: e.target.value }))}
                  className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-800 outline-none focus:border-slate-400"
                >
                  {['GHS', 'NGN', 'USD', 'ZAR', 'KES'].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <p className="text-xs text-slate-500">Must be enabled on your Paystack account.</p>
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-semibold text-slate-800">Plan Price Multiplier (FX)</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={psConfig.fxRate}
                  onChange={(e) => setPsConfig((c) => ({ ...c, fxRate: e.target.value }))}
                  className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-800 outline-none focus:border-slate-400"
                />
                <p className="text-xs text-slate-500">
                  Plan prices are multiplied by this before charging. Example: plans priced in USD, charging GHS → set your USD→GHS rate (e.g. 15.5). Leave 1 to charge face value.
                </p>
              </label>
            </div>

            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
              <div className="text-xs font-semibold text-slate-600">Webhook URL — add this in Paystack Dashboard → Settings → API Keys &amp; Webhooks</div>
              <div className="mt-2 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                <code className="flex-1 break-all font-mono text-xs text-slate-700">{`${API_BASE_URL}/api/payments/paystack/webhook`}</code>
                <button
                  type="button"
                  onClick={() => void navigator.clipboard.writeText(`${API_BASE_URL}/api/payments/paystack/webhook`)}
                  className="shrink-0 rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200"
                >
                  Copy
                </button>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Plan activation happens on the <code className="rounded bg-slate-100 px-1">charge.success</code> event — without the webhook, payments still verify on redirect but activation may lag.
              </p>
            </div>

            {psError && (
              <p className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">
                <AlertCircle size={16} /> {psError}
              </p>
            )}
            {psSuccess && (
              <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                <CheckCircle2 size={16} /> Paystack credentials saved.
              </p>
            )}
            {psTestResult && (
              <p className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm ${psTestResult.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                {psTestResult.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />} {psTestResult.message}
              </p>
            )}

            <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={() => void testPaystack()}
                disabled={psTesting || !psConfig[psConfig.mode === 'live' ? 'liveSecretKey' : 'testSecretKey']}
                className="rounded-2xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
              >
                {psTesting ? 'Testing…' : 'Test connection'}
              </button>
              <button
                type="button"
                onClick={() => void savePaystack()}
                disabled={psSaving || !psConfig[psConfig.mode === 'live' ? 'liveSecretKey' : 'testSecretKey']}
                className="rounded-2xl bg-slate-950 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
              >
                {psSaving ? 'Saving…' : 'Save Paystack'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Hubtel Setup Guide ────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#00a859] text-lg font-black text-white">
                H
              </div>
              <div>
                <h2 className="text-lg font-black text-slate-900">Hubtel Setup Guide</h2>
                <p className="text-sm text-slate-500">Follow these steps to go live with Hubtel payments.</p>
              </div>
            </div>
          </div>
          <a
            href="https://developers.hubtel.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
          >
            <ExternalLink size={13} /> Hubtel Docs
          </a>
        </div>

        <div className="space-y-6 rounded-2xl border border-slate-100 bg-slate-50 p-5">
          <SetupStep step={1} title="Create a Hubtel merchant account">
            Go to{' '}
            <a href="https://merchant.hubtel.com" target="_blank" rel="noopener noreferrer" className="font-semibold text-slate-800 underline underline-offset-2">
              merchant.hubtel.com
            </a>{' '}
            and register your business. You will need a valid Ghana phone number and business registration details.
          </SetupStep>

          <SetupStep step={2} title="Get your API credentials">
            In the Hubtel Merchant Dashboard, go to{' '}
            <span className="font-semibold text-slate-800">Settings → API Keys</span>. Copy your{' '}
            <span className="font-semibold text-slate-800">Client ID</span> and{' '}
            <span className="font-semibold text-slate-800">Client Secret</span>. Also note your{' '}
            <span className="font-semibold text-slate-800">Merchant Account Number</span> from your profile.
          </SetupStep>

          <SetupStep step={3} title="Add the callback URL in Hubtel">
            In your Hubtel app settings, add this exact URL as your{' '}
            <span className="font-semibold text-slate-800">Callback / Webhook URL</span>:
            <div className="mt-2 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
              <code className="flex-1 break-all font-mono text-xs text-slate-700">{CALLBACK_URL}</code>
              <button
                type="button"
                onClick={() => void navigator.clipboard.writeText(CALLBACK_URL)}
                className="shrink-0 rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200"
              >
                Copy
              </button>
            </div>
          </SetupStep>

          <SetupStep step={4} title="Enter credentials below and save">
            Paste your Client ID, Client Secret, and Merchant Account Number into the form below, then click{' '}
            <span className="font-semibold text-slate-800">Save credentials</span>. Payments will go live immediately.
          </SetupStep>
        </div>
      </div>

      {/* ── Credentials Form ─────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-black text-slate-900">Hubtel Credentials</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {isConfigured
                ? 'Credentials are configured. Update them here if they change.'
                : 'No credentials saved yet. Fill in the fields from your Hubtel dashboard.'}
            </p>
          </div>
          {isConfigured && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              <CheckCircle2 size={13} /> Configured
            </span>
          )}
        </div>

        {configLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((n) => <div key={n} className="h-12 animate-pulse rounded-2xl bg-slate-100" />)}
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid gap-5 md:grid-cols-2">
              <label className="block space-y-2">
                <span className="text-sm font-semibold text-slate-800">Client ID</span>
                <input
                  type="text"
                  value={config.clientId}
                  onChange={(e) => setConfig((c) => ({ ...c, clientId: e.target.value }))}
                  placeholder="e.g. TestClientID0001"
                  className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-800 outline-none focus:border-slate-400"
                />
                <p className="text-xs text-slate-500">From Hubtel dashboard → Settings → API Keys.</p>
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-semibold text-slate-800">Client Secret</span>
                <div className="relative">
                  <input
                    type={showSecret ? 'text' : 'password'}
                    value={config.clientSecret}
                    onChange={(e) => setConfig((c) => ({ ...c, clientSecret: e.target.value }))}
                    placeholder="Your Hubtel Client Secret"
                    className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 pr-12 text-sm text-slate-800 outline-none focus:border-slate-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret((s) => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showSecret ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                <p className="text-xs text-slate-500">Keep this secret. Never share it publicly.</p>
              </label>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <label className="block space-y-2">
                <span className="text-sm font-semibold text-slate-800">Merchant Account Number</span>
                <input
                  type="text"
                  value={config.merchantAccountNumber}
                  onChange={(e) => setConfig((c) => ({ ...c, merchantAccountNumber: e.target.value }))}
                  placeholder="e.g. 2024XXXX"
                  className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-800 outline-none focus:border-slate-400"
                />
                <p className="text-xs text-slate-500">
                  Your Hubtel merchant account number (visible on your Hubtel profile page).
                </p>
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-semibold text-slate-800">SMS Sender ID</span>
                <input
                  type="text"
                  value={config.senderId}
                  maxLength={11}
                  onChange={(e) => setConfig((c) => ({ ...c, senderId: e.target.value }))}
                  placeholder="e.g. Dakyworld"
                  className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-800 outline-none focus:border-slate-400"
                />
                <p className="text-xs text-slate-500">
                  Approved sender name for SMS &amp; OTP (max 11 characters). Register it in your Hubtel dashboard first.
                </p>
              </label>
            </div>

            {configError && (
              <p className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">
                <AlertCircle size={16} /> {configError}
              </p>
            )}
            {configSuccess && (
              <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                <CheckCircle2 size={16} /> Hubtel credentials saved. Payments are now live.
              </p>
            )}

            <div className="flex justify-end border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={() => void saveConfig()}
                disabled={configSaving || (!config.clientId && !config.clientSecret)}
                className="rounded-2xl bg-slate-950 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
              >
                {configSaving ? 'Saving…' : 'Save credentials'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Messaging: SMS & OTP ─────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-black text-slate-900">Messaging — SMS &amp; OTP</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Uses the same Hubtel credentials. OTP phone verification is available to the app at{' '}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">/api/hubtel/otp/send</code> and{' '}
              <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">/api/hubtel/otp/verify</code>.
            </p>
          </div>
          {config.senderId ? (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              <CheckCircle2 size={13} /> Sender: {config.senderId}
            </span>
          ) : (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
              <AlertCircle size={13} /> Add a Sender ID above
            </span>
          )}
        </div>

        {/* Test SMS */}
        <div className="rounded-2xl border border-slate-100 bg-slate-50 p-5">
          <div className="text-sm font-bold text-slate-900">Send a test SMS</div>
          <p className="mt-0.5 text-xs text-slate-500">
            Confirms your credentials and sender ID against the live Hubtel SMS API. Standard SMS rates apply.
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-[220px_1fr_auto]">
            <input
              type="tel"
              value={smsTo}
              onChange={(e) => setSmsTo(e.target.value)}
              placeholder="e.g. 0241234567"
              className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-800 outline-none focus:border-slate-400"
            />
            <input
              type="text"
              value={smsContent}
              onChange={(e) => setSmsContent(e.target.value)}
              maxLength={160}
              className="h-11 rounded-2xl border border-slate-200 bg-white px-4 text-sm text-slate-800 outline-none focus:border-slate-400"
            />
            <button
              type="button"
              onClick={() => void sendTestSms()}
              disabled={smsSending || !smsTo.trim() || !isConfigured || !config.senderId}
              className="h-11 rounded-2xl bg-slate-950 px-5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
            >
              {smsSending ? 'Sending…' : 'Send test SMS'}
            </button>
          </div>
          {smsResult && (
            <p className={`mt-3 flex items-start gap-2 rounded-xl px-4 py-3 text-sm ${smsResult.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
              {smsResult.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertCircle size={16} className="mt-0.5 shrink-0" />}
              {smsResult.message}
            </p>
          )}
        </div>

        {/* Recent SMS activity */}
        <div className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-bold text-slate-900">Recent SMS activity</div>
            <button
              type="button"
              onClick={() => void loadSmsLogs()}
              className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50"
            >
              <RefreshCw size={14} className={smsLogsLoading ? 'animate-spin' : ''} />
            </button>
          </div>
          {smsLogsLoading ? (
            <div className="space-y-2">
              {[1, 2].map((n) => <div key={n} className="h-12 animate-pulse rounded-xl bg-slate-50" />)}
            </div>
          ) : smsLogs.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">
              No SMS sent yet. OTP sends and test messages will appear here.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-100">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                    <th className="px-4 py-2.5">To</th>
                    <th className="px-4 py-2.5">Message</th>
                    <th className="px-4 py-2.5">Type</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {smsLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-3 font-mono text-xs text-slate-700">{log.recipient}</td>
                      <td className="max-w-[280px] px-4 py-3">
                        <span className="block truncate text-slate-600">{log.content}</span>
                        {log.status === 'failed' && log.provider_response?.error && (
                          <span className="block truncate text-xs text-red-500">{log.provider_response.error}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{log.context}</span>
                      </td>
                      <td className="px-4 py-3">
                        {log.status === 'sent' ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700"><CheckCircle2 size={11} /> Sent</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-600"><XCircle size={11} /> Failed</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
                        {new Date(log.created_at).toLocaleString('en-GH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Transactions ─────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-6 py-5">
          <div>
            <h2 className="text-lg font-black text-slate-900">Transactions</h2>
            <p className="text-sm text-slate-500">{transactions.length} total</p>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none"
            >
              <option value="all">All statuses</option>
              <option value="successful">Successful</option>
              <option value="pending">Pending</option>
              <option value="failed">Failed</option>
            </select>
            <button
              type="button"
              onClick={() => void loadTransactions()}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50"
            >
              <RefreshCw size={16} className={txLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {txLoading ? (
          <div className="space-y-2 p-4">
            {[1, 2, 3].map((n) => <div key={n} className="h-14 animate-pulse rounded-xl bg-slate-50" />)}
          </div>
        ) : filteredTransactions.length === 0 ? (
          <div className="py-16 text-center">
            <DollarSign size={32} className="mx-auto text-slate-200" />
            <p className="mt-3 text-sm text-slate-400">No transactions yet</p>
            <p className="mt-1 text-xs text-slate-400">
              Once customers complete payments, they will appear here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <th className="px-6 py-3">Customer</th>
                  <th className="px-6 py-3">Amount</th>
                  <th className="px-6 py-3">Description</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Reference</th>
                  <th className="px-6 py-3">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filteredTransactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-50/60">
                    <td className="px-6 py-4">
                      <div className="font-semibold text-slate-800">{tx.customer_name || '—'}</div>
                      {tx.customer_phone && <div className="text-xs text-slate-500">{tx.customer_phone}</div>}
                    </td>
                    <td className="px-6 py-4 font-bold text-slate-900">{fmt(Number(tx.amount), tx.currency)}</td>
                    <td className="px-6 py-4 text-slate-500">{tx.description || '—'}</td>
                    <td className="px-6 py-4"><StatusBadge status={tx.status} /></td>
                    <td className="px-6 py-4">
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                        {tx.client_reference?.slice(0, 8) ?? '—'}
                      </code>
                    </td>
                    <td className="px-6 py-4 text-slate-500">
                      {new Date(tx.created_at).toLocaleDateString('en-GH', {
                        day: 'numeric', month: 'short', year: 'numeric',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <CreditManagement />
    </div>
  );
};

export default PaymentManagement;
