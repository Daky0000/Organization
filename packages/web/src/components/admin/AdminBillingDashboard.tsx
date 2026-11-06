import { useEffect, useState } from 'react';
import { TrendingUp, Users, DollarSign, BarChart2, Search, ChevronLeft, ChevronRight, ExternalLink, AlertCircle } from 'lucide-react';
import { API_BASE_URL } from '../../utils/apiBase';

const API_BASE = API_BASE_URL;

function fetchJson<T>(path: string): Promise<T> {
  const token = localStorage.getItem('auth_token');
  return fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token ?? ''}` },
  }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json() as Promise<T>;
  });
}

async function putJson<T>(path: string, body: unknown): Promise<T> {
  const token = localStorage.getItem('auth_token');
  const r = await fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token ?? ''}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json() as Promise<T>;
}

type Metrics = {
  mrr: number;
  arr: number;
  arpu: number;
  activeSubscriptions: number;
  canceledThisMonth: number;
  newThisMonth: number;
  planBreakdown: { planName: string; count: number; mrr: number }[];
  recentInvoices: {
    id: string;
    userEmail: string;
    amount: number;
    currency: string;
    status: string;
    createdAt: string;
    hostedUrl: string | null;
  }[];
};

type Customer = {
  userId: string;
  email: string;
  name: string;
  planName: string | null;
  planId: string | null;
  status: string | null;
  mrr: number;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

type Plan = { id: string; name: string };

// Server payloads use snake_case and nest metrics; map them to the view models
// above so a shape drift fails here (visibly) instead of mid-render.
type MetricsResponse = {
  metrics?: {
    mrr?: number; arr?: number; arpu?: number;
    active_subscriptions?: number; new_this_month?: number; canceled_this_month?: number;
  };
  plan_breakdown?: { plan_name: string; subscriber_count: number; mrr_contribution: string | number }[];
  recent_invoices?: {
    id?: string; invoice_number?: string; email?: string; total_cents?: number;
    currency?: string; status?: string; created_at?: string; paid_at?: string;
    hosted_invoice_url?: string | null;
  }[];
};

function mapMetrics(d: MetricsResponse): Metrics {
  const m = d.metrics ?? {};
  return {
    // mrr/arr/arpu arrive in currency units; fmt() renders cents, so scale up
    mrr: Math.round((Number(m.mrr) || 0) * 100),
    arr: Math.round((Number(m.arr) || 0) * 100),
    arpu: Math.round((Number(m.arpu) || 0) * 100),
    activeSubscriptions: m.active_subscriptions ?? 0,
    newThisMonth: m.new_this_month ?? 0,
    canceledThisMonth: m.canceled_this_month ?? 0,
    planBreakdown: (d.plan_breakdown ?? []).map((r) => ({
      planName: r.plan_name,
      count: r.subscriber_count,
      mrr: Math.round((Number(r.mrr_contribution) || 0) * 100),
    })),
    recentInvoices: (d.recent_invoices ?? []).map((r) => ({
      id: r.id ?? r.invoice_number ?? `${r.email}-${r.created_at}`,
      userEmail: r.email ?? '—',
      amount: r.total_cents ?? 0,
      currency: r.currency ?? 'usd',
      status: r.status ?? 'unknown',
      createdAt: r.created_at ?? r.paid_at ?? '',
      hostedUrl: r.hosted_invoice_url ?? null,
    })),
  };
}

type CustomerRow = {
  id: string; email: string; full_name: string | null; plan_id: string | null;
  plan_name: string | null; price: string | number | null; billing_period: string | null;
  subscription_status: string | null; current_period_end: string | null;
  cancel_at_period_end: boolean | null;
};

function mapCustomer(r: CustomerRow): Customer {
  const price = Number(r.price) || 0;
  const mrrCents = r.subscription_status === 'active'
    ? Math.round((r.billing_period === 'yearly' ? price / 12 : price) * 100)
    : 0;
  return {
    userId: r.id,
    email: r.email,
    name: r.full_name ?? '',
    planName: r.plan_name,
    planId: r.plan_id,
    status: r.subscription_status,
    mrr: mrrCents,
    currentPeriodEnd: r.current_period_end,
    cancelAtPeriodEnd: Boolean(r.cancel_at_period_end),
  };
}

function fmt(cents: number, currency = 'usd') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function StatusPill({ status }: { status: string | null }) {
  if (!status) return <span className="text-slate-400 text-xs">—</span>;
  const colors: Record<string, string> = {
    active: 'bg-emerald-100 text-emerald-700',
    past_due: 'bg-amber-100 text-amber-700',
    canceled: 'bg-red-100 text-red-700',
    trialing: 'bg-blue-100 text-blue-700',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${colors[status] ?? 'bg-slate-100 text-slate-600'}`}>
      {status}
    </span>
  );
}

function MetricCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string; sub?: string; icon: React.ElementType; color: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6">
      <div className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${color}`}>
        <Icon size={20} />
      </div>
      <div className="mt-4 text-3xl font-black tracking-[-0.04em] text-slate-950">{value}</div>
      <div className="mt-1 text-sm font-semibold text-slate-600">{label}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

export default function AdminBillingDashboard() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalCustomers, setTotalCustomers] = useState(0);
  const [loadingMetrics, setLoadingMetrics] = useState(true);
  const [loadingCustomers, setLoadingCustomers] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assigningPlan, setAssigningPlan] = useState<string | null>(null);

  const PAGE_SIZE = 20;

  useEffect(() => {
    setLoadingMetrics(true);
    fetchJson<MetricsResponse>('/api/admin/billing/metrics')
      .then((d) => setMetrics(mapMetrics(d)))
      .catch((e) => setError(e.message))
      .finally(() => setLoadingMetrics(false));

    fetchJson<{ plans: Plan[] }>('/api/pricing/plans')
      .then((d) => setPlans(d.plans ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoadingCustomers(true);
    // Server paginates with limit/offset, not page numbers
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE) });
    if (search) params.set('search', search);
    fetchJson<{ customers: CustomerRow[]; total: number }>(`/api/admin/billing/customers?${params}`)
      .then((d) => {
        setCustomers((d.customers ?? []).map(mapCustomer));
        setTotalCustomers(d.total ?? 0);
      })
      .catch(() => {})
      .finally(() => setLoadingCustomers(false));
  }, [page, search]);

  const handleSearchChange = (v: string) => {
    setSearch(v);
    setPage(1);
  };

  const assignPlan = async (userId: string, planId: string) => {
    setAssigningPlan(userId);
    try {
      await putJson(`/api/admin/billing/customers/${userId}/plan`, { planId });
      setCustomers((prev) =>
        prev.map((c) => {
          if (c.userId !== userId) return c;
          const plan = plans.find((p) => p.id === planId);
          return { ...c, planId, planName: plan?.name ?? c.planName };
        })
      );
    } catch {
      /* ignore */
    } finally {
      setAssigningPlan(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(totalCustomers / PAGE_SIZE));

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 flex items-center gap-3">
        <AlertCircle size={20} className="text-red-500 shrink-0" />
        <p className="text-sm text-red-700">Failed to load billing metrics: {error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Metrics row */}
      {loadingMetrics ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="h-32 animate-pulse rounded-2xl border border-slate-200 bg-slate-100" />
          ))}
        </div>
      ) : metrics ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Monthly Recurring Revenue" value={fmt(metrics.mrr)} sub={`ARR ${fmt(metrics.arr)}`} icon={DollarSign} color="bg-emerald-100 text-emerald-700" />
            <MetricCard label="Active Subscriptions" value={String(metrics.activeSubscriptions)} sub={`+${metrics.newThisMonth} new this month`} icon={Users} color="bg-blue-100 text-blue-700" />
            <MetricCard label="Avg Revenue / User" value={fmt(metrics.arpu)} sub="per active subscriber" icon={TrendingUp} color="bg-violet-100 text-violet-700" />
            <MetricCard label="Cancellations" value={String(metrics.canceledThisMonth)} sub="this month" icon={BarChart2} color="bg-amber-100 text-amber-700" />
          </div>

          {/* Plan breakdown */}
          {metrics.planBreakdown.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
              <div className="border-b border-slate-100 px-6 py-4">
                <h2 className="text-sm font-bold text-slate-950">Plan Breakdown</h2>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    <th className="px-6 py-3 text-left">Plan</th>
                    <th className="px-6 py-3 text-right">Subscribers</th>
                    <th className="px-6 py-3 text-right">MRR</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.planBreakdown.map((row) => (
                    <tr key={row.planName} className="border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-3 font-semibold text-slate-900">{row.planName}</td>
                      <td className="px-6 py-3 text-right text-slate-600">{row.count}</td>
                      <td className="px-6 py-3 text-right font-semibold text-slate-900">{fmt(row.mrr)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Recent invoices */}
          {metrics.recentInvoices.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
              <div className="border-b border-slate-100 px-6 py-4">
                <h2 className="text-sm font-bold text-slate-950">Recent Invoices</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      <th className="px-6 py-3 text-left">Customer</th>
                      <th className="px-6 py-3 text-left">Date</th>
                      <th className="px-6 py-3 text-right">Amount</th>
                      <th className="px-6 py-3 text-center">Status</th>
                      <th className="px-6 py-3 text-center">Link</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.recentInvoices.map((inv) => (
                      <tr key={inv.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors">
                        <td className="px-6 py-3 text-slate-700">{inv.userEmail}</td>
                        <td className="px-6 py-3 text-slate-500">{new Date(inv.createdAt).toLocaleDateString()}</td>
                        <td className="px-6 py-3 text-right font-semibold text-slate-900">{fmt(inv.amount, inv.currency)}</td>
                        <td className="px-6 py-3 text-center"><StatusPill status={inv.status} /></td>
                        <td className="px-6 py-3 text-center">
                          {inv.hostedUrl ? (
                            <a href={inv.hostedUrl} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center text-slate-400 hover:text-slate-700 transition-colors">
                              <ExternalLink size={14} />
                            </a>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      ) : null}

      {/* Customer list */}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="border-b border-slate-100 px-6 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-bold text-slate-950">Customers</h2>
          <div className="relative w-full sm:w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by email or name…"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-8 pr-3 text-sm text-slate-800 placeholder-slate-400 focus:border-slate-400 focus:outline-none"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                <th className="px-6 py-3 text-left">Customer</th>
                <th className="px-6 py-3 text-left">Plan</th>
                <th className="px-6 py-3 text-center">Status</th>
                <th className="px-6 py-3 text-right">MRR</th>
                <th className="px-6 py-3 text-left">Renews</th>
                <th className="px-6 py-3 text-left">Assign Plan</th>
              </tr>
            </thead>
            <tbody>
              {loadingCustomers ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-slate-50">
                    {Array.from({ length: 6 }).map((_, j) => (
                      <td key={j} className="px-6 py-4">
                        <div className="h-4 animate-pulse rounded bg-slate-100" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : customers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-10 text-center text-slate-500">No customers found.</td>
                </tr>
              ) : (
                customers.map((c) => (
                  <tr key={c.userId} className="border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-3">
                      <div className="font-semibold text-slate-900">{c.name || '—'}</div>
                      <div className="text-xs text-slate-400">{c.email}</div>
                    </td>
                    <td className="px-6 py-3 text-slate-700">{c.planName ?? <span className="text-slate-400">Free</span>}</td>
                    <td className="px-6 py-3 text-center">
                      <StatusPill status={c.status} />
                      {c.cancelAtPeriodEnd && (
                        <div className="mt-0.5 text-[10px] text-amber-600 font-medium">cancels at period end</div>
                      )}
                    </td>
                    <td className="px-6 py-3 text-right font-semibold text-slate-900">{c.mrr > 0 ? fmt(c.mrr) : <span className="text-slate-400">—</span>}</td>
                    <td className="px-6 py-3 text-slate-500">
                      {c.currentPeriodEnd ? new Date(c.currentPeriodEnd).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-6 py-3">
                      <select
                        value={c.planId ?? ''}
                        disabled={assigningPlan === c.userId}
                        onChange={(e) => assignPlan(c.userId, e.target.value)}
                        className="w-36 rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 focus:border-slate-400 focus:outline-none disabled:opacity-50"
                      >
                        <option value="">— Free —</option>
                        {plans.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="border-t border-slate-100 px-6 py-3 flex items-center justify-between">
            <span className="text-xs text-slate-500">
              {totalCustomers} customer{totalCustomers !== 1 ? 's' : ''}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="text-xs font-semibold text-slate-700">{page} / {totalPages}</span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
