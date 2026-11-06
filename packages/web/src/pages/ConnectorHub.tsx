import { useState, useEffect, useCallback } from 'react';
import {
  Mail, Users, Share2, MessageSquare, BarChart2, Calendar,
  CheckCircle2, Zap, RefreshCw, Settings,
  ArrowRight, Lock, Globe
} from 'lucide-react';

const API = '/api/connectors';
const tok = () => localStorage.getItem('auth_token') ?? '';
const authHeaders = () => ({ Authorization: `Bearer ${tok()}` });
const jsonHeaders = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` });

interface Domain {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  position: number;
  provider_count: number;
  active_provider: Provider | null;
  active_provider_slug: string;
  providers: Provider[];
  connected_count: number;
}

interface Provider {
  slug: string;
  name: string;
  description: string;
  is_native: boolean;
  requires_integration_slug: string | null;
  capabilities: string[];
  position: number;
  user_has_access: boolean;
}

const DOMAIN_ICONS: Record<string, React.ElementType> = {
  email: Mail,
  crm: Users,
  social: Share2,
  messaging: MessageSquare,
  analytics: BarChart2,
  calendar: Calendar,
};

const PROVIDER_LOGOS: Record<string, string> = {
  hubspot: 'https://www.hubspot.com/hubfs/HubSpot_Logos/HubSpot-Inversed-Favicon.png',
  salesforce: 'https://c1.sfdcstatic.com/content/dam/sfdc-docs/www/logos/logo-salesforce.svg',
  buffer: 'https://buffer.com/favicon.ico',
  slack: 'https://a.slack-edge.com/80588/marketing/img/meta/favicon-32.png',
  mailchimp: 'https://mailchimp.com/favicon.ico',
  google_analytics: 'https://www.gstatic.com/analytics-suite/header/suite/v2/ic_analytics.svg',
  google_calendar: 'https://ssl.gstatic.com/calendar/images/dynamiclogo_2020q4/calendar_31_2x.png',
  gmail: 'https://ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico',
};

function DomainIcon({ slug, color }: { slug: string; color: string }) {
  const Icon = DOMAIN_ICONS[slug] || Globe;
  return (
    <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${color}18` }}>
      <Icon className="w-5 h-5" style={{ color }} />
    </div>
  );
}

function ProviderBadge({ provider, isActive }: { provider: Provider; isActive: boolean }) {
  const logo = PROVIDER_LOGOS[provider.slug];
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
      isActive ? 'border-[#2563EB] bg-[#2563EB]/5 text-[#2563EB]' :
      provider.user_has_access ? 'border-gray-200 text-gray-600 hover:border-gray-300' :
      'border-dashed border-gray-200 text-gray-400'
    }`}>
      {logo ? <img src={logo} alt="" className="w-3.5 h-3.5 rounded object-contain" onError={e => (e.currentTarget.style.display = 'none')} />
             : <div className="w-3.5 h-3.5 rounded bg-gray-200" />}
      {provider.name}
      {isActive && <CheckCircle2 className="w-3 h-3 text-[#2563EB] ml-0.5" />}
      {!provider.user_has_access && !provider.is_native && <Lock className="w-3 h-3 ml-0.5" />}
    </div>
  );
}

export default function ConnectorHub({ onNavigateToSetup, onNavigateToSync }: {
  onNavigateToSetup?: (domain: Domain) => void;
  onNavigateToSync?: () => void;
}) {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/overview`, { headers: authHeaders() });
      if (r.ok) setDomains(await r.json());
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadOverview(); }, []);

  const switchToNative = async (domainSlug: string) => {
    setSwitching(domainSlug);
    try {
      await fetch(`${API}/prefs/${domainSlug}`, { method: 'DELETE', headers: authHeaders() });
      loadOverview();
    } finally { setSwitching(null); }
  };

  const switchProvider = async (domainSlug: string, providerSlug: string) => {
    setSwitching(domainSlug);
    try {
      const r = await fetch(`${API}/prefs/${domainSlug}`, {
        method: 'PUT',
        headers: jsonHeaders(),
        body: JSON.stringify({ provider_slug: providerSlug }),
      });
      if (!r.ok) {
        const err = await r.json();
        alert(err.error || 'Cannot switch provider');
        return;
      }
      loadOverview();
    } finally { setSwitching(null); }
  };

  const totalConnected = domains.reduce((s, d) => s + d.connected_count, 0);
  const domainsWithExternal = domains.filter(d => d.active_provider_slug !== 'native').length;

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-8 py-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Connector Hub</h1>
            <p className="text-sm text-gray-500 mt-1">Choose which provider powers each capability. Mix native tools with your existing stack.</p>
          </div>
          <button onClick={onNavigateToSync} className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors">
            <RefreshCw className="w-4 h-4" /> Sync History
          </button>
        </div>

        {/* Summary stats */}
        <div className="flex items-center gap-6 mt-5">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="text-sm text-gray-600">{totalConnected} external integration{totalConnected !== 1 ? 's' : ''} connected</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-[#2563EB]" />
            <span className="text-sm text-gray-600">{domainsWithExternal} domain{domainsWithExternal !== 1 ? 's' : ''} using external providers</span>
          </div>
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-500" />
            <span className="text-sm text-gray-600">{6 - domainsWithExternal} domain{(6 - domainsWithExternal) !== 1 ? 's' : ''} running on native</span>
          </div>
        </div>
      </div>

      {/* Domain grid */}
      <div className="flex-1 overflow-y-auto p-8">
        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-100 p-6 animate-pulse">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-11 h-11 rounded-xl bg-gray-100" />
                  <div className="flex-1"><div className="h-4 bg-gray-100 rounded w-24 mb-2" /><div className="h-3 bg-gray-100 rounded w-48" /></div>
                </div>
                <div className="h-3 bg-gray-100 rounded w-32 mb-3" />
                <div className="flex gap-2">{Array.from({ length: 3 }).map((_, j) => <div key={j} className="h-7 bg-gray-100 rounded-lg w-24" />)}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {domains.map(domain => {
              const isActive = (slug: string) => domain.active_provider_slug === slug;
              const isSwitching = switching === domain.slug;
              return (
                <div key={domain.slug} className="bg-white rounded-2xl border border-gray-100 p-6 hover:shadow-sm transition-shadow">
                  {/* Domain header */}
                  <div className="flex items-start justify-between mb-5">
                    <div className="flex items-center gap-4">
                      <DomainIcon slug={domain.slug} color={domain.color} />
                      <div>
                        <h3 className="font-semibold text-gray-900">{domain.name}</h3>
                        <p className="text-xs text-gray-400 mt-0.5">{domain.description}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => onNavigateToSetup?.(domain)}
                      className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      <Settings className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Active provider indicator */}
                  <div className="flex items-center gap-2 mb-4 py-2.5 px-3 bg-gray-50 rounded-xl">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: isActive('native') ? '#10b981' : '#2563EB' }} />
                    <span className="text-xs text-gray-500 flex-1">Active:</span>
                    <span className="text-xs font-semibold text-gray-800">{domain.active_provider?.name || 'Native'}</span>
                    {!isActive('native') && (
                      <button
                        onClick={() => switchToNative(domain.slug)}
                        disabled={isSwitching}
                        className="text-xs text-gray-400 hover:text-gray-600 transition-colors ml-2"
                        title="Switch back to native"
                      >
                        Reset
                      </button>
                    )}
                  </div>

                  {/* Available providers */}
                  <div className="flex flex-wrap gap-2">
                    {domain.providers.map(provider => (
                      <button
                        key={provider.slug}
                        onClick={() => {
                          if (isActive(provider.slug)) return;
                          if (!provider.user_has_access) {
                            alert(`Connect ${provider.name} from the Integrations page first.`);
                            return;
                          }
                          if (provider.is_native) switchToNative(domain.slug);
                          else switchProvider(domain.slug, provider.slug);
                        }}
                        disabled={isSwitching}
                        title={!provider.user_has_access ? `Connect ${provider.name} from Integrations first` : undefined}
                      >
                        <ProviderBadge provider={provider} isActive={isActive(provider.slug)} />
                      </button>
                    ))}
                  </div>

                  {/* Capabilities preview */}
                  {domain.active_provider && (
                    <div className="mt-4 pt-4 border-t border-gray-50">
                      <p className="text-xs text-gray-400 mb-2">Active capabilities</p>
                      <div className="flex flex-wrap gap-1.5">
                        {(domain.active_provider.capabilities || []).slice(0, 4).map((cap: string) => (
                          <span key={cap} className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{cap.replace(/_/g, ' ')}</span>
                        ))}
                        {(domain.active_provider.capabilities || []).length > 4 && (
                          <span className="text-xs text-gray-400">+{domain.active_provider.capabilities.length - 4} more</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* How it works callout */}
        {!loading && (
          <div className="mt-6 bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-100 rounded-2xl p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-[#2563EB] flex items-center justify-center flex-shrink-0">
                <Zap className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900 mb-1">How the Connector Layer works</h3>
                <p className="text-sm text-gray-600 leading-relaxed">
                  Your AI agents (Daky, Sage, Aria, Flux, and others) call each domain through a unified interface. When you switch a domain to an external provider, all agents automatically route through that provider — no reconfiguration needed. Native providers always work as a fallback.
                </p>
                <div className="flex items-center gap-4 mt-3 text-sm text-indigo-600">
                  <span className="flex items-center gap-1.5"><ArrowRight className="w-3.5 h-3.5" /> Agent calls <code className="bg-white px-1 rounded text-xs">email.send()</code></span>
                  <span className="flex items-center gap-1.5"><ArrowRight className="w-3.5 h-3.5" /> Registry picks active provider</span>
                  <span className="flex items-center gap-1.5"><ArrowRight className="w-3.5 h-3.5" /> Native or external delivers</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
