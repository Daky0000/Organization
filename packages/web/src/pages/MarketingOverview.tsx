import { useEffect, useState } from 'react';
import { BarChart2, Loader2, Mail, Megaphone, Users } from 'lucide-react';
import { mailingService, type MailingAnalytics } from '../services/mailingService';
import { campaignService, type Campaign } from '../services/campaignService';
import type { PageType } from '../App';

type OverviewData = {
  mailing: MailingAnalytics;
  campaigns: Campaign[];
};

function KpiCard({ label, value, sub, icon }: { label: string; value: string | number; sub?: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      {icon && <div className="mb-3 text-slate-400">{icon}</div>}
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-3xl font-black text-slate-950">{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

export default function MarketingOverview({ navigateToPage }: { navigateToPage: (page: PageType) => void }) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    Promise.all([
      mailingService.getAnalytics(),
      campaignService.listCampaigns(),
    ])
      .then(([mailing, campaigns]) => setData({ mailing, campaigns }))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 text-slate-400">
        <Loader2 size={24} className="animate-spin mr-3" /> Loading…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="py-16 text-center text-sm text-slate-400">Failed to load marketing overview.</div>
    );
  }

  const { mailing, campaigns } = data;
  const activeCampaigns = campaigns.filter(c => c.status === 'active');
  const totalClicks = campaigns.reduce((sum, c) => sum + Number(c.total_clicks ?? 0), 0);
  const totalConversions = campaigns.reduce((sum, c) => sum + Number(c.total_conversions ?? 0), 0);

  const fmtNum = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toLocaleString();
  };

  return (
    <div className="space-y-8 pb-8">
      <div>
        <h1 className="text-4xl font-black tracking-[-0.04em] text-slate-950">Marketing</h1>
        <p className="mt-2 text-base text-slate-500">Your marketing hub — email, campaigns, contacts, and performance in one place.</p>
      </div>

      {/* Email Health */}
      <section>
        <div className="mb-4 flex items-center gap-2">
          <Mail size={15} className="text-slate-400" />
          <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400">Email Health</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Total Contacts" value={fmtNum(mailing.contacts.total)} sub={`${fmtNum(mailing.contacts.subscribed)} subscribed`} icon={<Users size={18} />} />
          <KpiCard label="Unsubscribed" value={fmtNum(mailing.contacts.unsubscribed)} sub="all time" />
          <KpiCard label="Open Rate" value={`${mailing.rates.openRate}%`} sub="of delivered" />
          <KpiCard label="Click Rate" value={`${mailing.rates.clickRate}%`} sub="of delivered" />
        </div>
      </section>

      {/* Campaign Overview */}
      <section>
        <div className="mb-4 flex items-center gap-2">
          <Megaphone size={15} className="text-slate-400" />
          <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400">Campaign Overview</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Total Campaigns" value={campaigns.length} sub="all time" icon={<Megaphone size={18} />} />
          <KpiCard label="Active Campaigns" value={activeCampaigns.length} sub="running now" />
          <KpiCard label="Total Clicks" value={fmtNum(totalClicks)} sub="across all campaigns" />
          <KpiCard label="Total Conversions" value={fmtNum(totalConversions)} sub="across all campaigns" />
        </div>
      </section>

      {/* Summary Cards */}
      <section className="grid gap-5 lg:grid-cols-2">
        {/* Email summary */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Mail size={16} className="text-indigo-500" />
              <h3 className="text-sm font-bold text-slate-900">Email Campaigns</h3>
            </div>
            <button
              onClick={() => navigateToPage('marketing-email')}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
            >
              Open Email →
            </button>
          </div>
          <div className="space-y-2">
            {[
              { label: 'Sent', value: mailing.campaigns.sent, color: 'bg-emerald-500' },
              { label: 'Draft', value: mailing.campaigns.draft, color: 'bg-slate-300' },
              { label: 'Scheduled', value: mailing.campaigns.scheduled, color: 'bg-amber-400' },
            ].map(row => (
              <div key={row.label} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${row.color}`} />
                  <span className="text-sm text-slate-600">{row.label}</span>
                </div>
                <span className="text-sm font-bold text-slate-900">{row.value}</span>
              </div>
            ))}
          </div>
          {mailing.campaigns.sent === 0 && mailing.campaigns.draft === 0 && (
            <p className="text-xs text-slate-400">No email campaigns yet. Create your first one.</p>
          )}
        </div>

        {/* Active campaigns summary */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Megaphone size={16} className="text-indigo-500" />
              <h3 className="text-sm font-bold text-slate-900">Active Campaigns</h3>
            </div>
            <button
              onClick={() => navigateToPage('marketing-campaigns')}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
            >
              Open Campaigns →
            </button>
          </div>
          {activeCampaigns.length === 0 ? (
            <p className="text-xs text-slate-400">No active campaigns. Launch one to start tracking performance.</p>
          ) : (
            <div className="space-y-2">
              {activeCampaigns.slice(0, 3).map(c => (
                <div key={c.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">{c.name}</p>
                    <p className="text-xs text-slate-400 capitalize">{c.goal}</p>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <p className="text-sm font-bold text-slate-900">{fmtNum(Number(c.total_clicks ?? 0))}</p>
                    <p className="text-xs text-slate-400">clicks</p>
                  </div>
                </div>
              ))}
              {activeCampaigns.length > 3 && (
                <p className="text-xs text-slate-400 text-center">+{activeCampaigns.length - 3} more active campaigns</p>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Quick links */}
      <section>
        <div className="mb-4">
          <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400">Quick Access</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { label: 'Contacts & Segments', desc: 'Manage subscribers and audience groups', page: 'marketing-contacts' as PageType, icon: <Users size={18} /> },
            { label: 'Email Marketing', desc: 'Campaigns, automations, and analytics', page: 'marketing-email' as PageType, icon: <Mail size={18} /> },
            { label: 'Campaigns', desc: 'Multi-channel campaigns, funnels, UTM links', page: 'marketing-campaigns' as PageType, icon: <BarChart2 size={18} /> },
          ].map(item => (
            <button
              key={item.page}
              onClick={() => navigateToPage(item.page)}
              className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-5 text-left hover:border-indigo-200 hover:bg-indigo-50/30 transition-all group"
            >
              <div className="mt-0.5 text-slate-400 group-hover:text-indigo-500 transition-colors">{item.icon}</div>
              <div>
                <div className="text-sm font-bold text-slate-900">{item.label}</div>
                <div className="mt-0.5 text-xs text-slate-500">{item.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
