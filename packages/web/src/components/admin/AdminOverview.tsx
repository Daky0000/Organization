import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { API_BASE_URL } from '../../utils/apiBase';

type OverviewStats = {
  usersTotal: number | null;
  usersNew7d: number | null;
  subsActive: number | null;
  revenueCents30d: number | null;
  creditsSpent7d: number | null;
  postsPublished7d: number | null;
  emailsSent7d: number | null;
  contactsTotal: number | null;
  designsTotal: number | null;
};

type ReadinessCheck = { id: string; label: string; ok: boolean; detail: string };

type OverviewResponse = {
  success: boolean;
  environment: string;
  appUrl: string;
  stats: OverviewStats;
  checks: ReadinessCheck[];
};

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('auth_token') ?? ''}` };
}

function fmt(n: number | null): string {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('en-US');
}

function fmtMoney(cents: number | null): string {
  if (cents === null || cents === undefined) return '—';
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const AdminOverview = () => {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/overview`, { headers: authHeaders() });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) throw new Error(body?.error || `Failed to load overview (${res.status})`);
      setData(body as OverviewResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load overview');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const tiles: { label: string; value: string; hint: string }[] = data ? [
    { label: 'Total users', value: fmt(data.stats.usersTotal), hint: `${fmt(data.stats.usersNew7d)} new this week` },
    { label: 'Active subscriptions', value: fmt(data.stats.subsActive), hint: 'active + trialing' },
    { label: 'Revenue (30d)', value: fmtMoney(data.stats.revenueCents30d), hint: 'paid invoices' },
    { label: 'Credits spent (7d)', value: fmt(data.stats.creditsSpent7d), hint: 'AI usage across all users' },
    { label: 'Posts published (7d)', value: fmt(data.stats.postsPublished7d), hint: 'social + blog distribution' },
    { label: 'Emails delivered (7d)', value: fmt(data.stats.emailsSent7d), hint: 'campaigns + automations' },
    { label: 'Mailing contacts', value: fmt(data.stats.contactsTotal), hint: 'across all workspaces' },
    { label: 'User designs', value: fmt(data.stats.designsTotal), hint: 'card builder documents' },
  ] : [];

  const failing = data?.checks.filter((c) => !c.ok) ?? [];

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-[-0.03em] text-slate-950">Overview</h1>
          <p className="mt-1 text-sm text-slate-500">
            Platform health and key numbers{data ? ` — ${data.appUrl.replace(/^https?:\/\//, '')} (${data.environment})` : ''}.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-100 bg-red-50 px-5 py-4 text-sm font-semibold text-red-700">
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center rounded-2xl border border-slate-200 bg-white py-16 text-slate-400">
          <Loader2 size={22} className="animate-spin" />
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {tiles.map((t) => (
              <div key={t.label} className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{t.label}</div>
                <div className="mt-2 text-3xl font-black tracking-[-0.02em] text-slate-950">{t.value}</div>
                <div className="mt-1 text-xs text-slate-400">{t.hint}</div>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div className="text-sm font-bold text-slate-900">Launch readiness</div>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${failing.length === 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                {failing.length === 0 ? 'All checks passing' : `${failing.length} needs attention`}
              </span>
            </div>
            <ul className="divide-y divide-slate-100">
              {data.checks.map((c) => (
                <li key={c.id} className="flex items-start gap-3 px-6 py-3.5">
                  {c.ok
                    ? <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-500" />
                    : <AlertTriangle size={17} className="mt-0.5 shrink-0 text-amber-500" />}
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900">{c.label}</div>
                    <div className="text-xs text-slate-500">{c.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
};

export default AdminOverview;
