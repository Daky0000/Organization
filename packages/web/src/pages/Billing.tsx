import { useEffect, useState } from 'react';
import {
  ArrowRight,
  BadgeCheck,
  CreditCard,
  ExternalLink,
  Loader2,
  Receipt,
  RefreshCw,
  Sparkles,
  AlertTriangle,
  X,
} from 'lucide-react';
import { API_BASE_URL } from '../utils/apiBase';
import { getStoredUser } from '../utils/userSession';

function authHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

async function fetchJson<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...opts,
    headers: {
      ...authHeaders(),
      ...(opts?.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error || `Request failed ${res.status}`);
  return data as T;
}

type Subscription = {
  id: string;
  status: string;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
};

type Plan = {
  id: string;
  name: string;
  price: number;
  billing_period: string;
  features: string[] | null;
  post_limit: number | null;
};

type Invoice = {
  id: string;
  invoice_number: string | null;
  status: string;
  total_cents: number;
  currency: string;
  hosted_invoice_url: string | null;
  invoice_pdf: string | null;
  paid_at: string | null;
  period_start: string | null;
  created_at: string;
};

type BillingData = {
  subscription: Subscription | null;
  plan: Plan | null;
  usage: { posts_this_period: number; posts_limit: number | null };
  paystackConfigured: boolean;
  paymentMode: 'test' | 'live';
  sandbox: { credits: number; plan_id: string | null; current_period_end: string | null } | null;
};

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700',
  past_due: 'bg-amber-50 text-amber-700',
  canceled: 'bg-red-50 text-red-600',
  free: 'bg-slate-100 text-slate-600',
  incomplete: 'bg-amber-50 text-amber-700',
};

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  past_due: 'Past Due',
  canceled: 'Canceled',
  free: 'Free',
  incomplete: 'Incomplete',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-600'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${status === 'active' ? 'bg-emerald-500' : status === 'past_due' ? 'bg-amber-500' : 'bg-slate-400'}`} />
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function UsageBar({ value, max, label }: { value: number; max: number | null; label: string }) {
  const pct = max ? Math.min((value / max) * 100, 100) : 0;
  const isHigh = pct >= 80;
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        <span className={`text-sm font-semibold ${isHigh ? 'text-amber-600' : 'text-slate-600'}`}>
          {value}{max ? ` / ${max}` : ''}
        </span>
      </div>
      {max && (
        <div className="h-2 w-full rounded-full bg-slate-100">
          <div
            className={`h-2 rounded-full transition-all ${isHigh ? 'bg-amber-400' : 'bg-blue-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

export default function Billing() {
  const storedUser = getStoredUser();
  const [data, setData] = useState<BillingData | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [topUpSuccess, setTopUpSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [portalLoading, setPortalLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [reactivateLoading, setReactivateLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [billingRes, invRes] = await Promise.all([
        fetchJson<{ success: boolean } & BillingData>(`${API_BASE_URL}/api/v1/billing/subscription`),
        fetchJson<{ success: boolean; invoices: Invoice[] }>(`${API_BASE_URL}/api/v1/billing/invoices`),
      ]);
      setData({ subscription: billingRes.subscription, plan: billingRes.plan, usage: billingRes.usage, paystackConfigured: billingRes.paystackConfigured, paymentMode: billingRes.paymentMode, sandbox: billingRes.sandbox });
      setInvoices(invRes.invoices ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const reference = new URLSearchParams(window.location.search).get('paystack_reference');
    const initialize = async () => {
      if (reference) {
        try {
          const result = await fetchJson<{ fulfilled: boolean; mode: string; status: string }>(`${API_BASE_URL}/api/payments/paystack/verify/${encodeURIComponent(reference)}`);
          if (result.fulfilled) setTopUpSuccess(result.mode === 'test' ? 'Test payment verified. Sandbox updated; live plans and credits are unchanged.' : 'Payment verified. Your purchase is ready.');
          else setTopUpSuccess('Payment is still pending. Refresh to verify again.');
        } catch (error) { setTopUpSuccess(error instanceof Error ? error.message : 'Payment could not be verified.'); }
      }
      await load();
    };
    void initialize();
  }, []);

  const openPortal = async () => {
    setPortalLoading(true);
    setError(null);
    try {
      const res = await fetchJson<{ url: string }>(`${API_BASE_URL}/api/v1/billing/portal`, { method: 'POST' });
      window.location.href = res.url;
    } catch (e: any) {
      setError(e.message);
      setPortalLoading(false);
    }
  };

  const cancelSubscription = async () => {
    setCancelLoading(true);
    setError(null);
    try {
      await fetchJson(`${API_BASE_URL}/api/v1/billing/cancel`, { method: 'POST' });
      setShowCancelConfirm(false);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCancelLoading(false);
    }
  };

  const reactivate = async () => {
    setReactivateLoading(true);
    setError(null);
    try {
      await fetchJson(`${API_BASE_URL}/api/v1/billing/reactivate`, { method: 'POST' });
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setReactivateLoading(false);
    }
  };

  const goToPricing = () => {
    window.history.pushState({}, '', '/pricing');
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  const sub = data?.subscription;
  const plan = data?.plan;
  const usage = data?.usage;
  const isActive = sub?.status === 'active';
  const isCancelingAtEnd = sub?.cancel_at_period_end === true;
  const isPaid = isActive || sub?.status === 'past_due';
  const paystackOk = data?.paystackConfigured;

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-12">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600">
          <CreditCard className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-black tracking-tight text-slate-900">Billing & Subscription</h1>
        <p className="mt-2 text-sm text-slate-600">Paystack {data?.paymentMode === 'live' ? 'live payments' : 'test mode'}. Plans are prepaid; renew through checkout.</p>
        {data?.paymentMode === 'test' && <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Sandbox only. Test credits: {data.sandbox?.credits || 0}. Live entitlements are unchanged.</p>}

          <p className="text-sm text-slate-500">Manage your plan, invoices, and payment details</p>
        </div>
        <button type="button" onClick={load} className="ml-auto rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50">
          <RefreshCw size={15} />
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">
          <AlertTriangle size={14} />
          {error}
        </div>
      )}

      {/* Cancellation warning */}
      {isCancelingAtEnd && sub?.current_period_end && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-800">Your subscription is set to cancel</p>
            <p className="mt-0.5 text-sm text-amber-700">
              You'll keep {plan?.name} access until{' '}
              <strong>{new Date(sub.current_period_end).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</strong>.
            </p>
          </div>
          <button
            type="button"
            onClick={reactivate}
            disabled={reactivateLoading}
            className="flex items-center gap-1.5 rounded-xl bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {reactivateLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Reactivate
          </button>
        </div>
      )}

      {storedUser?.planSource === 'dakyx' && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-semibold text-emerald-900">{storedUser.planName ?? 'Your plan'} is included with your DakyX retainer</p>
          <p className="mt-0.5 text-sm text-emerald-800">
            There is nothing to pay here while your retainer is active. A plan you buy below only applies if it is higher.
          </p>
        </div>
      )}

      {/* Current plan card */}
      <div data-tour-id="billing-plan-card" className="rounded-2xl border border-slate-200 bg-white p-6 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Current Plan</p>
            <p className="mt-1 text-2xl font-black tracking-tight text-slate-900">
              {plan ? plan.name.replace(/\s*\((Monthly|Yearly)\)/, '') : 'Free'}
            </p>
            {plan && (
              <p className="mt-1 text-sm text-slate-500">
                ${plan.price.toFixed(0)} / {plan.billing_period === 'monthly' ? 'month' : 'year'}
              </p>
            )}
          </div>
          <StatusBadge status={sub?.status ?? 'free'} />
        </div>

        {isPaid && sub?.current_period_end && !isCancelingAtEnd && (
          <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            Renews on{' '}
            <span className="font-semibold text-slate-800">
              {new Date(sub.current_period_end).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
            </span>
          </div>
        )}

        {/* Usage */}
        {usage && (
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Usage this month</p>
            <UsageBar value={usage.posts_this_period} max={usage.posts_limit} label="Posts created" />
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          {!isPaid && (
            <button
              type="button"
              data-tour-id="btn-upgrade"
              onClick={goToPricing}
              className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
            >
              <Sparkles size={14} />
              Upgrade plan
              <ArrowRight size={14} />
            </button>
          )}
          {paystackOk && isPaid && (
            <button
              type="button"
              onClick={openPortal}
              disabled={portalLoading}
              className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {portalLoading ? <Loader2 size={14} className="animate-spin" /> : <CreditCard size={14} />}
              Renew plan
            </button>
          )}
          {paystackOk && isActive && !isCancelingAtEnd && (
            <button
              type="button"
              onClick={() => setShowCancelConfirm(true)}
              className="flex items-center gap-2 rounded-xl border border-red-200 px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50"
            >
              Cancel plan
            </button>
          )}
          {!paystackOk && (
            <p className="text-xs text-slate-400">Payment processing not yet configured — contact support to manage your plan.</p>
          )}
        </div>
      </div>

      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-6">
        <div><h2 className="font-semibold text-slate-900">AI credits</h2><p className="mt-1 text-sm text-slate-500">Buy non-expiring credits independently of your plan. Manage balances, receipts, and optional recharge.</p></div>
        <a href="/credits" className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700">Buy credits</a>
      </section>

      {topUpSuccess && <p role="status" className="text-sm text-emerald-700">{topUpSuccess}</p>}

      {/* Invoice history */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Receipt size={16} className="text-slate-500" />
          <h2 className="text-sm font-bold text-slate-800">Invoice history</h2>
        </div>
        {invoices.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">No invoices yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <th className="pb-2 pr-4">Date</th>
                  <th className="pb-2 pr-4">Invoice</th>
                  <th className="pb-2 pr-4">Amount</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-50/50">
                    <td className="py-3 pr-4 text-slate-600">{new Date(inv.created_at).toLocaleDateString()}</td>
                    <td className="py-3 pr-4 font-mono text-slate-700">{inv.invoice_number || '—'}</td>
                    <td className="py-3 pr-4 font-semibold text-slate-800">
                      ${(inv.total_cents / 100).toFixed(2)} {inv.currency.toUpperCase()}
                    </td>
                    <td className="py-3 pr-4">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${inv.status === 'paid' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                        {inv.status === 'paid' && <BadgeCheck size={10} />}
                        {inv.status}
                      </span>
                    </td>
                    <td className="py-3">
                      {(inv.invoice_pdf || inv.hosted_invoice_url) && (
                        <a
                          href={inv.invoice_pdf || inv.hosted_invoice_url || '#'}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline"
                        >
                          View <ExternalLink size={11} />
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Cancel confirm modal */}
      {showCancelConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">End plan?</h3>
              <button type="button" onClick={() => setShowCancelConfirm(false)} className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100">
                <X size={16} />
              </button>
            </div>
            <p className="text-sm text-slate-600">
              Your plan will remain active until the end of the current billing period. You won't be charged again.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowCancelConfirm(false)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                Keep plan
              </button>
              <button
                type="button"
                onClick={cancelSubscription}
                disabled={cancelLoading}
                className="flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {cancelLoading && <Loader2 size={13} className="animate-spin" />}
                Yes, cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
