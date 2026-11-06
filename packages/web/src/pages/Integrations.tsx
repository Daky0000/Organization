import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle, ExternalLink, Info, Instagram, Layers, Loader2, Plug, RefreshCw, Settings2, Sparkles, Unplug } from 'lucide-react';
import { integrationService, type IntegrationCatalogItem } from '../services/integrationService';
import { sanitizeApiErrorText } from '../utils/apiRequest';
import { wordpressService } from '../services/wordpressService';
import { socialPostService } from '../services/socialPostService';
import { PlatformLogo } from '../components/PlatformLogo';
import { googleSheetsService } from '../services/leadService';

type Props = {
  onNavigateSettings?: () => void;
};

type ModalState =
  | { type: 'none' }
  | { type: 'wordpress' }
  | { type: 'facebook-type' }
  | { type: 'facebook-select'; accountType: 'page' | 'group' }
  | { type: 'instagram' }
  | { type: 'linkedin' }
  | { type: 'linkedin-select' }
  | { type: 'mailchimp' }
  | { type: 'whatsapp' };

const PLATFORM_BADGE: Record<string, { bg: string; text: string }> = {
  connected: { bg: 'bg-emerald/10', text: 'text-emerald' },
  disconnected: { bg: 'bg-soft', text: 'text-muted' },
  disabled: { bg: 'bg-amber/15', text: 'text-amber' },
  expiring: { bg: 'bg-warn-surface', text: 'text-warn-text' },
  reconnect: { bg: 'bg-danger-surface', text: 'text-danger-text' },
};

const formatDate = (value?: string | null) => {
  if (!value) return '';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString();
};

const PRIMARY_ACTION =
  'inline-flex items-center gap-1.5 rounded-xl bg-navy px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 transition-colors shadow-xs';
const SECONDARY_ACTION =
  'inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-3.5 py-1.5 text-xs font-semibold text-ink hover:bg-soft disabled:opacity-50 transition-colors';

function Card({
  title,
  description,
  statusLabel,
  statusTone,
  icon,
  meta,
  disabledReason,
  notice,
  children,
}: {
  title: string;
  description: string;
  statusLabel: string;
  statusTone: keyof typeof PLATFORM_BADGE;
  icon: React.ReactNode;
  meta?: string | null;
  disabledReason?: string | null;
  notice?: { tone: 'warn' | 'danger'; text: string } | null;
  children: React.ReactNode;
}) {
  const badge = PLATFORM_BADGE[statusTone];
  return (
    <div className="group flex flex-col justify-between rounded-2xl border border-line bg-white p-5 shadow-xs transition hover:border-slate-300 hover:shadow-md">
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl overflow-hidden shadow-xs border border-line/60 bg-soft">
              {icon}
            </div>
            <div className="min-w-0">
              <div className="text-base font-bold text-ink">{title}</div>
              {meta ? <div className="mt-0.5 text-xs text-muted">{meta}</div> : null}
            </div>
          </div>
          <span className={`rounded-lg px-2.5 py-1 text-[11px] font-bold ${badge.bg} ${badge.text}`}>{statusLabel}</span>
        </div>
        <p className="mt-3 text-xs leading-5 text-muted">{description}</p>
        {disabledReason ? (
          <p className="mt-2.5 rounded-lg border border-amber/30 bg-amber/5 px-2.5 py-1.5 text-xs font-medium text-amber">
            {disabledReason}
          </p>
        ) : null}
        {notice ? (
          <p
            role="status"
            className={`mt-2.5 flex items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
              notice.tone === 'danger' ? 'border-danger-line bg-danger-surface text-danger-text' : 'border-warn-line bg-warn-surface text-warn-text'
            }`}
          >
            <AlertCircle size={14} className="mt-px shrink-0" />
            <span>{notice.text}</span>
          </p>
        ) : null}
      </div>
      <div className="mt-4 flex flex-wrap gap-2 pt-3 border-t border-line/60">{children}</div>
    </div>
  );
}

export default function Integrations({ onNavigateSettings }: Props) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<IntegrationCatalogItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [redirectError, setRedirectError] = useState<string | null>(null);

  const [modal, setModal] = useState<ModalState>({ type: 'none' });
  const [activeTab, setActiveTab] = useState<'cms' | 'social' | 'marketing' | 'messaging'>('cms');
  const [tabInitialized, setTabInitialized] = useState(false);

  const [busy, setBusy] = useState<string | null>(null);

  // WordPress form
  const [wpSiteUrl, setWpSiteUrl] = useState('');
  const [wpUsername, setWpUsername] = useState('');
  const [wpAppPassword, setWpAppPassword] = useState('');

  // Facebook pages
  const [fbPages, setFbPages] = useState<Array<{ id: string; name: string; picture?: string | null; can_publish?: boolean; saved?: boolean }>>([]);
  const [fbGroups, setFbGroups] = useState<Array<{ id: string; name: string }>>([]);
  const [fbLoading, setFbLoading] = useState(false);
  const [fbMissingPermissions, setFbMissingPermissions] = useState<string[]>([]);
  const [fbWarnings, setFbWarnings] = useState<string[]>([]);
  const [fbTargetType, setFbTargetType] = useState<'page' | 'group'>('page');
  const [fbSelectedTargets, setFbSelectedTargets] = useState<string[]>([]);
  const [fbLookupQuery, setFbLookupQuery] = useState('');
  const [fbLookupLoading, setFbLookupLoading] = useState(false);
  const [fbLookupError, setFbLookupError] = useState<string | null>(null);
  const fbReturnHandled = useRef(false);

  // Instagram targets
  const [igTargets, setIgTargets] = useState<Array<{
    pageId: string;
    pageName: string;
    pagePicture?: string | null;
    pageTasks?: string[];
    instagramId: string | null;
    instagramUsername: string | null;
    instagramName?: string | null;
    instagramAccountType?: string | null;
    instagramFollowers?: number | null;
    instagramFollowing?: number | null;
    instagramMediaCount?: number | null;
    instagramBio?: string | null;
    instagramProfilePicture?: string | null;
    instagramWebsite?: string | null;
    instagramVerified?: boolean;
    canPublish?: boolean;
    canInsights?: boolean;
  }>>([]);
  const [igLoading, setIgLoading] = useState(false);
  const [igMissingPermissions, setIgMissingPermissions] = useState<string[]>([]);
  const [igWarnings, setIgWarnings] = useState<string[]>([]);
  const [igModalTab, setIgModalTab] = useState<'direct' | 'pages'>('direct');
  const [igFacebookConnected, setIgFacebookConnected] = useState<boolean>(true);
  const igReturnHandled = useRef(false);

  // LinkedIn targets
  const [linkedInTargets, setLinkedInTargets] = useState<Array<{ id: string; name: string; accountType: 'profile' | 'page'; saved?: boolean }>>([]);
  const [linkedInLoading, setLinkedInLoading] = useState(false);
  const [linkedInWarning, setLinkedInWarning] = useState<string | null>(null);
  const liReturnHandled = useRef(false);

  // LinkedIn company pages
  const [linkedInOrganizations, setLinkedInOrganizations] = useState<Array<{ id: string; name: string; picture_url?: string | null }>>([]);
  const [linkedInOrgLoading, setLinkedInOrgLoading] = useState(false);
  const [linkedInSelectedOrgs, setLinkedInSelectedOrgs] = useState<string[]>([]);

  // Mailchimp
  const [mcApiKey, setMcApiKey] = useState('');
  const [mcServerPrefix, setMcServerPrefix] = useState('');

  // WhatsApp
  const [waPhoneNumberId, setWaPhoneNumberId] = useState('');
  const [waAccessToken, setWaAccessToken] = useState('');

  // Google Sheets
  const [gsStatus, setGsStatus] = useState<{ connected: boolean; email?: string; connectedAt?: string } | null>(null);
  const [gsLoading, setGsLoading] = useState(false);
  const [gsMsg, setGsMsg] = useState<{ text: string; ok: boolean } | null>(null);

  // Google Calendar
  const [gcalLoading, setGcalLoading] = useState(false);
  const [gcalMsg, setGcalMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await integrationService.getCatalog();
      if (!res.success) throw new Error(res.error || 'Failed to load integrations');
      setItems(res.integrations || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load integrations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void googleSheetsService.getStatus().then(setGsStatus).catch(() => { /* silent */ });
  }, [load]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const rawError = params.get('error');
    if (!rawError) return;

    setRedirectError(
      sanitizeApiErrorText(
        rawError,
        'The integration callback returned the app shell instead of API data. Please try connecting again.'
      )
    );

    params.delete('error');
    params.delete('success');
    const nextQuery = params.toString();
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}`;
    window.history.replaceState({}, '', nextUrl);
  }, []);

  const cms = useMemo(() => items.filter((i) => i.type === 'cms'), [items]);
  const social = useMemo(() => items.filter((i) => i.type === 'social'), [items]);
  const marketing = useMemo(() => items.filter((i) => i.type === 'marketing'), [items]);
  const messaging = useMemo(() => items.filter((i) => i.type === 'messaging'), [items]);
  const connectedCount = useMemo(() => items.filter((i) => i.connected).length, [items]);
  const totalCount = items.length;
  const facebookConnected = useMemo(
    () => items.some((item) => item.slug === 'facebook' && item.connected),
    [items]
  );
  const facebookConfigured = useMemo(
    () => items.some((item) => item.slug === 'facebook' && item.configured),
    [items]
  );
  const linkedInConnected = useMemo(
    () => items.some((item) => item.slug === 'linkedin' && item.connected),
    [items]
  );

  const tabs = useMemo(
    () => [
      { id: 'cms' as const, label: 'CMS', count: cms.length, title: 'CMS Platforms', subtitle: `${cms.length} apps available`, empty: 'No CMS integrations enabled.' },
      { id: 'social' as const, label: 'Social', count: social.length, title: 'Social Media Platforms', subtitle: `${social.length} channels supported`, empty: 'No social integrations enabled.' },
      { id: 'marketing' as const, label: 'Marketing', count: marketing.length, title: 'Marketing Platforms', subtitle: `${marketing.length} tools ready`, empty: 'No marketing integrations enabled.' },
      { id: 'messaging' as const, label: 'Messaging', count: messaging.length, title: 'Messaging & Productivity', subtitle: `${messaging.length} integrations available`, empty: 'No messaging integrations enabled.' },
    ],
    [cms.length, social.length, marketing.length, messaging.length],
  );

  useEffect(() => {
    if (tabInitialized || loading) return;
    const params = new URLSearchParams(window.location.search);
    const hasSocialReturnParam = Boolean(params.get('fbType') || params.get('igConnected') || params.get('liConnected'));
    if (hasSocialReturnParam && social.length) {
      setActiveTab('social');
      setTabInitialized(true);
      return;
    }
    const firstAvailable = cms.length ? 'cms' : social.length ? 'social' : marketing.length ? 'marketing' : messaging.length ? 'messaging' : 'cms';
    setActiveTab(firstAvailable);
    setTabInitialized(true);
  }, [cms.length, social.length, marketing.length, messaging.length, loading, tabInitialized]);

  const startOAuth = async (
    slug: string,
    returnTo = '/integrations',
    options?: { extraScopes?: string[]; rerequest?: boolean; method?: 'instagram' | 'facebook' },
  ) => {
    setBusy(slug);
    try {
      const res = await integrationService.startOAuth(slug, returnTo, options);
      if (!res.success) throw new Error(res.error || 'OAuth failed');
    } catch (e) {
      alert(e instanceof Error ? e.message : 'OAuth failed');
      setBusy(null);
    }
  };

  const disconnectOAuth = async (slug: string) => {
    if (!confirm(`Disconnect ${slug}?`)) return;
    setBusy(slug);
    try {
      const res = await integrationService.disconnectOAuth(slug);
      if (!res.success) throw new Error(res.error || 'Failed to disconnect');
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to disconnect');
    } finally {
      setBusy(null);
    }
  };

  const openFacebookType = () => {
    setFbTargetType('page');
    setFbSelectedTargets([]);
    setModal({ type: 'facebook-type' });
  };

  const openFacebookSelect = useCallback(async (accountType: 'page' | 'group') => {
    setFbTargetType(accountType);
    setFbSelectedTargets([]);
    setFbLookupError(null);
    setModal({ type: 'facebook-select', accountType });
    setFbLoading(true);
    try {
      const res = await integrationService.listFacebookTargets();
      if (!res.success) throw new Error(res.error || 'Failed to load Facebook targets');
      const pages = res.pages || [];
      setFbPages(pages);
      setFbGroups(res.groups || []);
      setFbMissingPermissions(res.missingPermissions || []);
      setFbWarnings(res.warnings || []);
      if (accountType === 'page') {
        const savedIds = pages.filter((p) => p.saved && p.can_publish !== false).map((p) => p.id);
        const publishableIds = pages.filter((p) => p.can_publish !== false).map((p) => p.id);
        setFbSelectedTargets(savedIds.length > 0 ? savedIds : publishableIds);
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to load Facebook targets');
      setFbPages([]);
      setFbGroups([]);
      setFbMissingPermissions([]);
      setFbWarnings([]);
    } finally {
      setFbLoading(false);
    }
  }, []);

  const handleLookupFacebookPage = async () => {
    const query = fbLookupQuery.trim();
    if (!query) return;
    setFbLookupLoading(true);
    setFbLookupError(null);
    try {
      const res = await integrationService.lookupFacebookPage(query);
      if (!res.success) {
        setFbLookupError(res.error || 'Could not find that Facebook Page.');
        return;
      }
      const nextPages = res.pages || (res.page ? [res.page] : []);
      setFbPages((prev) => {
        const map = new Map(prev.map((p) => [p.id, p]));
        for (const p of nextPages) {
          map.set(p.id, { ...map.get(p.id), ...p });
        }
        return Array.from(map.values());
      });
      if (res.page?.id && res.page.can_publish !== false) {
        setFbSelectedTargets((prev) => (prev.includes(res.page!.id) ? prev : [...prev, res.page!.id]));
      }
      setFbLookupQuery('');
    } catch (e) {
      setFbLookupError(e instanceof Error ? e.message : 'Failed to look up Facebook Page');
    } finally {
      setFbLookupLoading(false);
    }
  };

  useEffect(() => {
    if (!facebookConnected || fbReturnHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    const fbType = params.get('fbType');
    if (fbType !== 'page' && fbType !== 'group') return;
    fbReturnHandled.current = true;
    setActiveTab('social');
    void openFacebookSelect(fbType);
    params.delete('fbType');
    const nextQuery = params.toString();
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}`;
    window.history.replaceState({}, '', nextUrl);
  }, [facebookConnected, openFacebookSelect]);

  const openLinkedInTargets = useCallback(async () => {
    setModal({ type: 'linkedin' });
    setLinkedInLoading(true);
    setLinkedInWarning(null);
    try {
      const res = await integrationService.listLinkedInTargets();
      if (!res.success) throw new Error(res.error || 'Failed to load LinkedIn targets');
      setLinkedInTargets(res.targets || []);
      setLinkedInWarning(res.warning || null);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to load LinkedIn targets');
      setLinkedInTargets([]);
      setLinkedInWarning(null);
    } finally {
      setLinkedInLoading(false);
    }
  }, []);

  const openLinkedInCompanySelect = useCallback(async () => {
    setModal({ type: 'linkedin-select' });
    setLinkedInOrgLoading(true);
    setLinkedInSelectedOrgs([]);
    try {
      const res = await integrationService.listLinkedInOrganizations();
      if (!res.success) throw new Error(res.error || 'Failed to load LinkedIn organizations');
      setLinkedInOrganizations(res.organizations || []);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to load LinkedIn organizations');
      setLinkedInOrganizations([]);
    } finally {
      setLinkedInOrgLoading(false);
    }
  }, []);

  const handleLinkedInOrgConnect = async () => {
    if (linkedInSelectedOrgs.length === 0) return;
    setBusy('linkedin-company');
    try {
      for (const orgId of linkedInSelectedOrgs) {
        const res = await integrationService.connectLinkedInCompany(orgId);
        if (!res.success) throw new Error(res.error || 'Failed to connect company page');
      }
      setModal({ type: 'none' });
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to connect company pages');
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    if (!linkedInConnected || liReturnHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('liConnected') !== '1') return;
    liReturnHandled.current = true;
    void openLinkedInTargets();
    params.delete('liConnected');
    const nextQuery = params.toString();
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}`;
    window.history.replaceState({}, '', nextUrl);
  }, [linkedInConnected, openLinkedInTargets]);

  const openInstagramTargets = useCallback(async () => {
    setModal({ type: 'instagram' });
    setIgLoading(true);
    setIgMissingPermissions([]);
    setIgWarnings([]);
    try {
      const res = await integrationService.listInstagramTargets();
      if (!res.success) throw new Error(res.error || 'Failed to load Instagram targets');
      setIgFacebookConnected(res.facebookConnected !== false);
      setIgTargets(res.targets || []);
      setIgMissingPermissions(res.missingPermissions || []);
      setIgWarnings(res.warnings || []);
    } catch (e) {
      setIgFacebookConnected(false);
      setIgTargets([]);
      setIgMissingPermissions([]);
      setIgWarnings([e instanceof Error ? e.message : 'Could not query Facebook Pages for linked Instagram accounts.']);
    } finally {
      setIgLoading(false);
    }
  }, []);

  useEffect(() => {
    if (loading || igReturnHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('igConnected') !== '1') return;
    const igMethod = params.get('igMethod');
    igReturnHandled.current = true;
    if (igMethod === 'facebook') {
      setIgModalTab('pages');
      void openInstagramTargets();
    }
    params.delete('igConnected');
    params.delete('igMethod');
    const nextQuery = params.toString();
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}`;
    window.history.replaceState({}, '', nextUrl);
  }, [loading, openInstagramTargets]);


  const toggleFacebookSelection = (id: string, disabled?: boolean) => {
    if (disabled) return;
    setFbSelectedTargets((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const toggleFacebookSelectAll = (ids: string[]) => {
    const allSelected = ids.every((id) => fbSelectedTargets.includes(id));
    setFbSelectedTargets(allSelected ? [] : ids);
  };

  const saveFacebookTargets = async (accountType: 'page' | 'group') => {
    const targets = accountType === 'group' ? fbGroups : fbPages;
    const pageTargets = targets as Array<{ id: string; name: string; can_publish?: boolean }>;
    const selectable = accountType === 'page' ? pageTargets.filter((t) => t.can_publish !== false) : targets;
    const selected = selectable.filter((t) => fbSelectedTargets.includes(t.id));
    if (!selected.length) {
      alert('Select at least one account to connect.');
      return;
    }
    setBusy('facebook-targets');
    try {
      for (const target of selected) {
        const res = await integrationService.saveSocialTarget({
          platform: 'facebook',
          account_type: accountType,
          account_id: target.id,
          account_name: target.name,
        });
        if (!res.success) throw new Error(res.error || 'Failed to save target');
      }
      await load();
      setModal({ type: 'none' });
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to save targets');
    } finally {
      setBusy(null);
    }
  };

  const connectWordPress = async () => {
    setBusy('wordpress');
    try {
      const res = await wordpressService.connect({
        siteUrl: wpSiteUrl,
        username: wpUsername,
        applicationPassword: wpAppPassword,
      });
      if (!res.success) throw new Error(res.error || 'WordPress connection failed');
      await load();
      setModal({ type: 'none' });
      setWpAppPassword('');
    } catch (e) {
      alert(e instanceof Error ? e.message : 'WordPress connection failed');
    } finally {
      setBusy(null);
    }
  };

  const disconnectWordPress = async () => {
    if (!confirm('Disconnect WordPress?')) return;
    setBusy('wordpress');
    try {
      const res = await wordpressService.disconnect();
      if (!res.success) throw new Error(res.error || 'Failed to disconnect WordPress');
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to disconnect WordPress');
    } finally {
      setBusy(null);
    }
  };

  const handleConnectGoogleSheets = async () => {
    setGsLoading(true);
    setGsMsg(null);
    try {
      const url = await googleSheetsService.getConnectUrl();
      window.open(url, 'gs_oauth', 'width=560,height=660,left=200,top=100');
      const onMessage = async (evt: MessageEvent) => {
        if (evt.data?.type === 'gs_success') {
          window.removeEventListener('message', onMessage);
          try {
            const status = await googleSheetsService.getStatus();
            setGsStatus(status);
            if (status.connected) setGsMsg({ text: `Google Sheets connected as ${status.email ?? 'your account'}.`, ok: true });
          } catch { /* silent */ }
          finally { setGsLoading(false); }
        } else if (evt.data?.type === 'gs_error') {
          window.removeEventListener('message', onMessage);
          setGsMsg({ text: `Google sign-in failed: ${String(evt.data.payload)}`, ok: false });
          setGsLoading(false);
        }
      };
      window.addEventListener('message', onMessage);
      setTimeout(() => { window.removeEventListener('message', onMessage); setGsLoading(false); }, 300_000);
    } catch (e) {
      setGsMsg({ text: e instanceof Error ? e.message : 'Failed to connect', ok: false });
      setGsLoading(false);
    }
  };

  const handleDisconnectGoogleSheets = async () => {
    if (!confirm('Disconnect Google Sheets?')) return;
    setGsLoading(true);
    try {
      await googleSheetsService.disconnect();
      setGsStatus({ connected: false });
      setGsMsg(null);
    } catch (e) {
      setGsMsg({ text: e instanceof Error ? e.message : 'Failed to disconnect', ok: false });
    } finally {
      setGsLoading(false);
    }
  };

  const handleConnectGoogleCalendar = async () => {
    setGcalLoading(true);
    setGcalMsg(null);
    try {
      const tok = localStorage.getItem('auth_token') ?? '';
      const r = await fetch('/api/calendar/google/connect-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
      });
      const d = await r.json();
      if (!d.url) { setGcalMsg({ text: d.error || 'Failed to get OAuth URL', ok: false }); setGcalLoading(false); return; }
      const popup = window.open(d.url, 'gcal_oauth', 'width=600,height=700,left=200,top=100');
      const onMessage = async (evt: MessageEvent) => {
        if (evt.data?.type === 'calendar_connected') {
          window.removeEventListener('message', onMessage);
          clearInterval(pollTimer);
          await load();
          setGcalMsg({ text: 'Google Calendar connected successfully.', ok: true });
          setGcalLoading(false);
        } else if (evt.data?.type === 'calendar_error') {
          window.removeEventListener('message', onMessage);
          clearInterval(pollTimer);
          setGcalMsg({ text: `Connection failed: ${evt.data.error || 'unknown error'}`, ok: false });
          setGcalLoading(false);
        }
      };
      window.addEventListener('message', onMessage);
      const pollTimer = setInterval(() => {
        if (popup?.closed) {
          clearInterval(pollTimer);
          window.removeEventListener('message', onMessage);
          void load();
          setGcalLoading(false);
        }
      }, 1000);
    } catch (e) {
      setGcalMsg({ text: e instanceof Error ? e.message : 'Failed to connect', ok: false });
      setGcalLoading(false);
    }
  };

  const handleDisconnectGoogleCalendar = async () => {
    if (!confirm('Disconnect Google Calendar?')) return;
    setGcalLoading(true);
    try {
      const tok = localStorage.getItem('auth_token') ?? '';
      await fetch('/api/calendar/google/disconnect', { method: 'DELETE', headers: { Authorization: `Bearer ${tok}` } });
      await load();
      setGcalMsg(null);
    } catch (e) {
      setGcalMsg({ text: e instanceof Error ? e.message : 'Failed to disconnect', ok: false });
    } finally {
      setGcalLoading(false);
    }
  };

  const connectWhatsApp = async () => {
    setBusy('whatsapp');
    try {
      const res = await integrationService.connectWhatsApp(waPhoneNumberId, waAccessToken);
      if (!res.success) throw new Error(res.error || 'WhatsApp connection failed');
      await load();
      setModal({ type: 'none' });
      setWaPhoneNumberId('');
      setWaAccessToken('');
    } catch (e) {
      alert(e instanceof Error ? e.message : 'WhatsApp connection failed');
    } finally {
      setBusy(null);
    }
  };

  const disconnectWhatsApp = async () => {
    if (!confirm('Disconnect WhatsApp?')) return;
    setBusy('whatsapp');
    try {
      const res = await integrationService.disconnectWhatsApp();
      if (!res.success) throw new Error(res.error || 'Failed to disconnect');
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to disconnect');
    } finally {
      setBusy(null);
    }
  };

  const renderActions = (item: IntegrationCatalogItem) => {
    const slug = item.slug;
    const isOauth = ['facebook', 'linkedin', 'twitter', 'pinterest', 'tiktok', 'threads', 'gmail', 'slack', 'zoom'].includes(slug);
    const connectedAt = item.connection?.connectedAt || item.connection?.createdAt || null;
    const connectedLabel = item.connection?.accountName || item.connection?.username || item.connection?.siteUrl || item.connection?.handle || '';
    const connectedMeta = item.connected
      ? [connectedLabel ? `Connected as ${connectedLabel}` : 'Connected', connectedAt ? formatDate(connectedAt) : '']
          .filter(Boolean)
          .join(' • ')
      : null;

    const disabledReason = !item.adminEnabled
      ? 'Disabled by admin.'
      : !item.configured && isOauth
        ? 'Not configured by admin (missing client credentials / redirect URL).'
        : null;
    const instagramMetaConfigured = item.configured || facebookConfigured;
    const instagramDisabledReason =
      !item.adminEnabled
        ? 'Disabled by admin.'
        : !instagramMetaConfigured
          ? 'Meta app is not configured by admin (Facebook/Instagram OAuth credentials are missing).'
          : null;
    const effectiveDisabledReason = slug === 'instagram' ? instagramDisabledReason : disabledReason;

    const canConnect = item.adminEnabled && (item.configured || !isOauth);

    if (slug === 'google_calendar') {
      return (
        <Card
          title="Google Calendar"
          description="Connect your Google Calendar to sync meetings scheduled in the CRM directly to your calendar and view your schedule when booking meetings."
          statusLabel={item.connected ? 'Connected' : 'Disconnected'}
          statusTone={item.connected ? 'connected' : 'disconnected'}
          icon={<PlatformLogo platform="google_calendar" size={48} />}
          meta={gcalMsg ? gcalMsg.text : item.connected ? 'Calendar synced' : null}
        >
          {!item.connected ? (
            <button
              type="button"
              onClick={() => void handleConnectGoogleCalendar()}
              disabled={gcalLoading || !item.adminEnabled}
              className={PRIMARY_ACTION}
            >
              {gcalLoading ? <Loader2 size={16} className="animate-spin" /> : <Plug size={16} />} Connect
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleDisconnectGoogleCalendar()}
              disabled={gcalLoading}
              className={SECONDARY_ACTION}
            >
              {gcalLoading ? <Loader2 size={16} className="animate-spin" /> : <Unplug size={16} />} Disconnect
            </button>
          )}
        </Card>
      );
    }

    if (slug === 'wordpress') {
      return (
      <Card
        title={item.name}
        description="Connect your WordPress site using Application Passwords. Publish, update, import posts and sync categories/tags."
        statusLabel={item.connected ? 'Connected' : 'Disconnected'}
        statusTone={item.connected ? 'connected' : 'disconnected'}
        icon={<PlatformLogo platform="wordpress" size={48} />}
        meta={connectedMeta}
      >
          {!item.connected ? (
            <button
              type="button"
              onClick={() => setModal({ type: 'wordpress' })}
              className={PRIMARY_ACTION}
            >
              <Plug size={16} /> Connect
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={disconnectWordPress}
                disabled={busy === 'wordpress'}
                className={SECONDARY_ACTION}
              >
                {busy === 'wordpress' ? <Loader2 size={16} className="animate-spin" /> : <Unplug size={16} />} Disconnect
              </button>
              <button
                type="button"
                onClick={() => setModal({ type: 'wordpress' })}
                className={SECONDARY_ACTION}
              >
                <Settings2 size={16} /> Manage
              </button>
            </>
          )}
        </Card>
      );
    }

    if (slug === 'whatsapp') {
      return (
        <Card
          title="WhatsApp Business"
          description="Send messages and notifications via WhatsApp Business Cloud API using your phone number ID and access token."
          statusLabel={item.connected ? 'Connected' : 'Disconnected'}
          statusTone={item.connected ? 'connected' : 'disconnected'}
          icon={<PlatformLogo platform="whatsapp" size={48} />}
          meta={item.connection?.accountName ? `Connected: ${item.connection.accountName}` : null}
        >
          {!item.connected ? (
            <button type="button" onClick={() => setModal({ type: 'whatsapp' })} className={PRIMARY_ACTION}>
              <Plug size={16} /> Connect
            </button>
          ) : (
            <>
              <button type="button" onClick={() => setModal({ type: 'whatsapp' })} className={SECONDARY_ACTION}>
                <Settings2 size={16} /> Manage
              </button>
              <button type="button" onClick={() => void disconnectWhatsApp()} disabled={busy === 'whatsapp'} className={SECONDARY_ACTION}>
                {busy === 'whatsapp' ? <Loader2 size={16} className="animate-spin" /> : <Unplug size={16} />} Disconnect
              </button>
            </>
          )}
        </Card>
      );
    }

    if (slug === 'mailchimp') {
      return (
        <Card
          title={item.name}
          description="Connect Mailchimp using an API key + server prefix (e.g. us19)."
          statusLabel={item.connected ? 'Connected' : 'Disconnected'}
          statusTone={item.connected ? 'connected' : 'disconnected'}
          icon={<PlatformLogo platform="mailchimp" size={48} />}
          meta={connectedMeta}
        >
          {!item.connected ? (
            <button
              type="button"
              onClick={() => setModal({ type: 'mailchimp' })}
              className={PRIMARY_ACTION}
            >
              <Plug size={16} /> Connect
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setModal({ type: 'mailchimp' })}
                className={SECONDARY_ACTION}
              >
                <Settings2 size={16} /> Manage
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!confirm('Disconnect Mailchimp?')) return;
                  setBusy('mailchimp');
                  try {
                    const res = await integrationService.disconnectMailchimp();
                    if (!res.success) throw new Error(res.error || 'Failed to disconnect');
                    await load();
                  } catch (e) {
                    alert(e instanceof Error ? e.message : 'Failed to disconnect');
                  } finally {
                    setBusy(null);
                  }
                }}
                disabled={busy === 'mailchimp'}
                className={SECONDARY_ACTION}
              >
                {busy === 'mailchimp' ? <Loader2 size={16} className="animate-spin" /> : <Unplug size={16} />} Disconnect
              </button>
            </>
          )}
        </Card>
      );
    }

    // Credentials the server says are dead (or about to lapse) need the user.
    const health = item.connected ? item.health : null;
    const needsReconnect = health?.status === 'reconnect_required';
    const expiringSoon = health?.status === 'expiring';
    const healthNotice = needsReconnect || expiringSoon
      ? { tone: needsReconnect ? 'danger' as const : 'warn' as const, text: health?.message || 'Reconnect this account to keep publishing.' }
      : null;

    const statusTone: keyof typeof PLATFORM_BADGE =
      effectiveDisabledReason ? 'disabled'
        : needsReconnect ? 'reconnect'
          : expiringSoon ? 'expiring'
            : item.connected ? 'connected' : 'disconnected';
    const statusLabel = effectiveDisabledReason
      ? item.adminEnabled ? 'Needs setup' : 'Admin disabled'
      : needsReconnect ? 'Reconnect required'
        : expiringSoon ? 'Expiring soon'
          : item.connected ? 'Connected' : 'Disconnected';

    const connectLabel = item.connected ? 'Reconnect' : 'Connect';

    return (
      <Card
        title={item.name}
        description={
          slug === 'facebook'
            ? 'Connect Facebook to publish to your profile or Pages. Save a Page token for automated posting.'
            : slug === 'instagram'
              ? 'Publish images & reels via Instagram Platform (Direct Instagram Business Login or Business Login via Facebook Page).'
              : slug === 'linkedin'
                ? 'Publish posts to your profile or LinkedIn Pages you administer.'
                  : slug === 'twitter'
                  ? 'Publish tweets with X API v2 (supports token refresh).'
                  : slug === 'pinterest'
                    ? 'Publish Pins and pull profile + board performance analytics.'
                    : slug === 'threads'
                      ? 'Publish posts to Threads and sync post insights analytics.'
                      : slug === 'gmail'
                        ? 'Send emails from your Gmail or Google Workspace address via the Gmail API.'
                        : slug === 'slack'
                          ? 'Send workflow notifications and agent alerts to Slack channels.'
                          : slug === 'zoom'
                            ? 'Create Zoom meetings and manage video sessions from your content workflow.'
                            : 'Connect using OAuth.'
        }
        statusLabel={statusLabel}
        statusTone={statusTone}
        disabledReason={effectiveDisabledReason}
        notice={effectiveDisabledReason ? null : healthNotice}
        icon={<PlatformLogo platform={slug} size={48} />}
        meta={connectedMeta}
      >
        {slug === 'instagram' ? (
          <>
            {!item.connected || needsReconnect || expiringSoon ? (
              <button
                type="button"
                onClick={() => void startOAuth('instagram', '/integrations?igConnected=1&igMethod=instagram', { method: 'instagram' })}
                disabled={Boolean(instagramDisabledReason) || busy === 'instagram'}
                className={PRIMARY_ACTION}
                title="Connect directly with Instagram Business or Creator account (no Facebook Page required)"
              >
                {busy === 'instagram' ? <Loader2 size={16} className="animate-spin" /> : <Instagram size={16} />} {item.connected ? 'Reconnect Instagram' : 'Connect Instagram'}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setIgModalTab('pages');
                void openInstagramTargets();
              }}
              disabled={Boolean(instagramDisabledReason) || busy === 'facebook'}
              className={SECONDARY_ACTION}
              title="Connect or manage Instagram professional accounts linked to your Facebook Pages"
            >
              {busy === 'facebook' ? <Loader2 size={16} className="animate-spin" /> : <Layers size={16} />} {item.connected ? 'Manage' : 'Via Facebook Page'}
            </button>
            {item.connected ? (
              <button
                type="button"
                onClick={() => void disconnectOAuth('instagram')}
                disabled={busy === 'instagram'}
                className={SECONDARY_ACTION}
              >
                {busy === 'instagram' ? <Loader2 size={16} className="animate-spin" /> : <Unplug size={16} />} Disconnect
              </button>
            ) : null}
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() =>
                slug === 'facebook'
                  ? item.connected
                    ? void startOAuth('facebook', '/integrations?fbType=page', { rerequest: true })
                    : openFacebookType()
                  : void startOAuth(
                      slug,
                      slug === 'linkedin'
                        ? '/integrations?liConnected=1'
                        : slug === 'gmail'
                          ? '/crm/companies'
                          : '/integrations'
                    )
              }
              disabled={!canConnect || busy === slug}
              className={PRIMARY_ACTION}
            >
              {busy === slug ? <Loader2 size={16} className="animate-spin" /> : <Plug size={16} />} {connectLabel}
            </button>

            {item.connected ? (
              <button
                type="button"
                onClick={() => void disconnectOAuth(slug)}
                disabled={busy === slug}
                className={SECONDARY_ACTION}
              >
                {busy === slug ? <Loader2 size={16} className="animate-spin" /> : <Unplug size={16} />} Disconnect
              </button>
            ) : null}
          </>
        )}

        {slug === 'facebook' ? (
          <button
            type="button"
            onClick={() => openFacebookType()}
            disabled={!item.connected}
            className={SECONDARY_ACTION}
            title={!item.connected ? 'Connect Facebook first' : 'Select or manage Facebook Pages'}
          >
            <Settings2 size={16} /> Manage Pages
          </button>
        ) : null}

        {slug === 'linkedin' ? (
          <>
            <button
              type="button"
              onClick={() => void openLinkedInTargets()}
              disabled={!item.connected}
              className={SECONDARY_ACTION}
              title={!item.connected ? 'Connect LinkedIn first' : 'Choose whether to post to your personal profile, company pages, or both'}
            >
              <Settings2 size={16} /> Manage Posting Targets
            </button>
            <button
              type="button"
              onClick={() => void openLinkedInCompanySelect()}
              disabled={!item.connected}
              className={SECONDARY_ACTION}
              title={!item.connected ? 'Connect LinkedIn first' : 'Manage and sync company pages for analytics and publishing'}
            >
              <Settings2 size={16} /> Manage Company Pages
            </button>
          </>
        ) : null}

      </Card>
    );
  };

  return (
    <div className="space-y-8">
      <section className="rounded-[28px] border border-slate-200 bg-white px-6 py-6 shadow-sm">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400">Integrations & workflows</div>
            <h2 className="mt-2 text-3xl font-black tracking-[-0.03em] text-slate-950">Integrations & workflows</h2>
            <p className="mt-2 text-sm text-slate-500">
              Supercharge your workflow and connect the tools you and your team use every day. Admins configure the apps; you connect the accounts.
            </p>
            <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Integration categories">
              {tabs.map((tab) => {
                const isActive = tab.id === activeTab;
                return (
                  <button
                    key={tab.id}
                    id={`integrations-tab-${tab.id}`}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    aria-controls={`integrations-panel-${tab.id}`}
                    onClick={() => setActiveTab(tab.id)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                      isActive
                        ? 'bg-slate-900 text-white shadow-sm'
                        : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {tab.label} ({tab.count})
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-center">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Connected</div>
              <div className="text-2xl font-black text-slate-900">{connectedCount}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-center">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Total</div>
              <div className="text-2xl font-black text-slate-900">{totalCount}</div>
            </div>
            {onNavigateSettings ? (
              <button
                type="button"
                onClick={onNavigateSettings}
                className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <ExternalLink size={16} /> Admin settings
              </button>
            ) : null}
          </div>
        </div>
      </section>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={28} className="animate-spin text-slate-400" />
        </div>
      ) : (error || redirectError) ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
          <div className="font-semibold">We couldn't load integrations.</div>
          <div className="mt-1">{error || redirectError}</div>
          <button
            type="button"
            onClick={() => {
              setRedirectError(null);
              void load();
            }}
            className="mt-3 inline-flex items-center gap-2 rounded-xl bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          {(() => {
            const activeConfig = tabs.find((tab) => tab.id === activeTab) || tabs[0];
            const activeItems = activeTab === 'cms' ? cms : activeTab === 'social' ? social : activeTab === 'marketing' ? marketing : messaging;
            return (
              <section
                data-tour-id="integrations-cards"
                className="space-y-4"
                role="tabpanel"
                id={`integrations-panel-${activeConfig.id}`}
                aria-labelledby={`integrations-tab-${activeConfig.id}`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-black text-slate-900">{activeConfig.title}</div>
                    <div className="text-xs text-slate-500">{activeConfig.subtitle}</div>
                  </div>
                </div>
                <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                  {activeItems.map(renderActions)}
                  {activeTab === 'marketing' && (
                    <Card
                      title="Google Sheets"
                      description="Link lead groups to Google Sheets spreadsheets and sync contact data automatically."
                      statusLabel={gsStatus?.connected ? 'Connected' : 'Disconnected'}
                      statusTone={gsStatus?.connected ? 'connected' : 'disconnected'}
                      icon={
                        <svg viewBox="0 0 48 48" width="48" height="48" xmlns="http://www.w3.org/2000/svg">
                          <rect width="48" height="48" rx="10" fill="#0f9d58" />
                          <rect x="13" y="14" width="22" height="3" rx="1" fill="white" />
                          <rect x="13" y="20" width="22" height="3" rx="1" fill="white" />
                          <rect x="13" y="26" width="22" height="3" rx="1" fill="white" />
                          <rect x="13" y="32" width="14" height="3" rx="1" fill="white" />
                        </svg>
                      }
                      meta={gsStatus?.connected && gsStatus.email ? `Connected as ${gsStatus.email}` : null}
                    >
                      {gsMsg ? (
                        <p className={`w-full text-xs font-medium ${gsMsg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{gsMsg.text}</p>
                      ) : null}
                      {!gsStatus?.connected ? (
                        <button
                          type="button"
                          onClick={() => void handleConnectGoogleSheets()}
                          disabled={gsLoading}
                          className={PRIMARY_ACTION}
                        >
                          {gsLoading ? <Loader2 size={14} className="animate-spin" /> : (
                            <svg viewBox="0 0 18 18" width="14" height="14" xmlns="http://www.w3.org/2000/svg">
                              <path d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z" fill="currentColor"/>
                              <path d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z" fill="currentColor"/>
                              <path d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18l2.67-2.07z" fill="currentColor"/>
                              <path d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.48a4.77 4.77 0 0 1 4.48-3.3z" fill="currentColor"/>
                            </svg>
                          )}
                          Sign in with Google
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void handleDisconnectGoogleSheets()}
                          disabled={gsLoading}
                          className={SECONDARY_ACTION}
                        >
                          {gsLoading ? <Loader2 size={14} className="animate-spin" /> : <Unplug size={14} />} Disconnect
                        </button>
                      )}
                    </Card>
                  )}
                  {!activeItems.length && activeTab !== 'marketing' && activeTab !== 'messaging' && (
                    <div className="text-sm text-slate-400">{activeConfig.empty}</div>
                  )}
                  {!activeItems.length && activeTab === 'messaging' && (
                    <div className="text-sm text-slate-400">{activeConfig.empty}</div>
                  )}
                </div>
              </section>
            );
          })()}

          <div className="rounded-2xl border border-line bg-white p-5 shadow-xs">
            <div className="flex items-center gap-2 text-sm font-bold text-ink">
              <CheckCircle size={16} className="text-emerald" />
              Publishing Workflow Tip
            </div>
            <p className="mt-1.5 text-xs text-muted">
              For automated multi-platform publishing, connect your accounts above and then dispatch scheduled or immediate posts from <strong>Posts → Distribution</strong>.
            </p>
          </div>
        </>
      )}

      {/* Modal shell */}
      {modal.type !== 'none' ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-10">
          <div className="w-full max-w-2xl rounded-[24px] bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div className="text-sm font-black text-slate-900">
                {modal.type === 'wordpress'
                  ? 'WordPress settings'
                  : modal.type === 'facebook-type'
                    ? 'Select Facebook account type'
                    : modal.type === 'facebook-select'
                      ? modal.accountType === 'group'
                        ? 'Select Facebook Groups'
                        : 'Select Facebook Pages'
                    : modal.type === 'instagram'
                      ? 'Instagram (Business accounts)'
                      : modal.type === 'linkedin'
                        ? 'LinkedIn targets'
                      : modal.type === 'linkedin-select'
                      ? 'Select LinkedIn Company Pages'
                      : modal.type === 'mailchimp'
                        ? 'Mailchimp'
                        : modal.type === 'whatsapp'
                          ? 'WhatsApp Business'
                          : 'Integration'}
              </div>
              <button
                type="button"
                onClick={() => setModal({ type: 'none' })}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            </div>

            <div className="px-6 py-5">
              {modal.type === 'wordpress' ? (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label className="text-xs font-semibold text-slate-600">Website URL</label>
                      <input
                        value={wpSiteUrl}
                        onChange={(e) => setWpSiteUrl(e.target.value)}
                        placeholder="https://example.com"
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-600">Username</label>
                      <input
                        value={wpUsername}
                        onChange={(e) => setWpUsername(e.target.value)}
                        placeholder="admin"
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-600">Application Password</label>
                      <input
                        type="password"
                        autoComplete="off"
                        value={wpAppPassword}
                        onChange={(e) => setWpAppPassword(e.target.value)}
                        placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400"
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void connectWordPress()}
                      disabled={busy === 'wordpress' || !wpSiteUrl.trim() || !wpUsername.trim() || !wpAppPassword.trim()}
                      className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60"
                    >
                      {busy === 'wordpress' ? <Loader2 size={16} className="animate-spin" /> : <Plug size={16} />} Save & Verify
                    </button>
                    <button
                      type="button"
                      onClick={() => void disconnectWordPress()}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
                    >
                      <Unplug size={16} /> Disconnect
                    </button>
                  </div>
                  <p className="text-xs text-slate-500">
                    Create an Application Password in WordPress: Users → Profile → Application Passwords.
                  </p>
                </div>
              ) : null}

              {modal.type === 'facebook-type' ? (
                <div className="space-y-4">
                  <div className="text-sm text-slate-600">
                    Connect the Facebook Pages you manage for direct publishing. Meta retired the Groups publishing API, so Groups can no longer be connected.
                  </div>
                  <button
                    type="button"
                    onClick={() => setFbTargetType('page')}
                    className={`flex w-full items-center justify-between gap-4 rounded-2xl border px-4 py-4 text-left transition ${
                      fbTargetType === 'page' ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-600">P</div>
                      <div>
                        <div className="text-sm font-bold text-slate-900">Page</div>
                        <div className="text-xs text-slate-500">
                          Best for brands and businesses. Direct publishing is supported.
                        </div>
                      </div>
                    </div>
                    <div className={`h-5 w-5 rounded-full border ${fbTargetType === 'page' ? 'border-blue-500' : 'border-slate-300'}`}>
                      <div className={`h-full w-full rounded-full ${fbTargetType === 'page' ? 'bg-blue-500' : 'bg-transparent'}`} />
                    </div>
                  </button>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setModal({ type: 'none' })}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        facebookConnected
                          ? void openFacebookSelect(fbTargetType)
                          : void startOAuth('facebook', `/integrations?fbType=${fbTargetType}`)
                      }
                      className="rounded-xl bg-slate-950 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                    >
                      Continue
                    </button>
                  </div>
                </div>
              ) : null}

              {modal.type === 'facebook-select' ? (
                <div className="space-y-3">
                  {fbLoading ? (
                    <div className="flex items-center justify-center py-10">
                      <Loader2 size={22} className="animate-spin text-slate-400" />
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span>{fbSelectedTargets.length} selected</span>
                        {(() => {
                          const targets = modal.accountType === 'group' ? fbGroups : fbPages;
                          const pageTargets = targets as Array<{ id: string; name: string; can_publish?: boolean }>;
                          const selectable = modal.accountType === 'page' ? pageTargets.filter((t) => t.can_publish !== false) : targets;
                          const selectableIds = selectable.map((t) => t.id);
                          const allSelected = selectableIds.length > 0 && selectableIds.every((id) => fbSelectedTargets.includes(id));
                          return (
                            <label className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={allSelected}
                                onChange={() => toggleFacebookSelectAll(selectableIds)}
                              />
                              Select All
                            </label>
                          );
                        })()}
                      </div>

                      {fbMissingPermissions.length > 0 ? (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
                          Missing Facebook permissions: {fbMissingPermissions.join(', ')}. Reconnect Facebook and approve these permissions.
                        </div>
                      ) : null}

                      {fbWarnings.length > 0 ? (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
                          {fbWarnings.join(' ')}
                        </div>
                      ) : null}

                      {(() => {
                        const targets = modal.accountType === 'group' ? fbGroups : fbPages;
                        if (targets.length === 0) {
                          return (
                            <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                              <div className="font-semibold text-slate-900">
                                No {modal.accountType === 'group' ? 'Groups' : 'Facebook Pages'} were returned by Meta for this login.
                              </div>
                              {modal.accountType === 'page' ? (
                                <ul className="list-disc space-y-1.5 pl-5 text-xs text-slate-600">
                                  <li>
                                    <strong>Personal Profile vs Page:</strong> Meta only supports connecting <strong>Facebook Pages</strong>, not personal accounts. If your URL has <code>/people/</code> or <code>profile.php</code>, create a Page at{' '}
                                    <a
                                      href="https://facebook.com/pages/create"
                                      target="_blank"
                                      rel="noreferrer"
                                      className="font-medium text-blue-600 underline hover:text-blue-700"
                                    >
                                      facebook.com/pages/create
                                    </a>.
                                  </li>
                                  <li>
                                    <strong>Page not checked during Facebook Login:</strong> Click <strong>Reconnect &amp; Select Pages</strong> below, then click <strong>&ldquo;Edit previous settings&rdquo;</strong> in the Facebook popup and select your Page.
                                  </li>
                                  <li>
                                    <strong>Meta App in Development Mode:</strong> If your Meta App in <span className="font-semibold">developers.facebook.com</span> is not set to &ldquo;Live&rdquo;, your Facebook account must be added under <strong>App roles &rarr; Roles &rarr; Testers</strong>.
                                  </li>
                                  <li>
                                    <strong>Page is in a Meta Business Portfolio / Business Suite:</strong> If your Page is linked to Instagram, WhatsApp, or Meta Business Suite, Meta hides it unless Business Portfolio access is granted. Click <strong>Reconnect with Business Portfolio Access</strong> below.
                                  </li>
                                </ul>
                              ) : (
                                <div className="text-xs text-slate-600">Try reconnecting Facebook and granting Group permissions.</div>
                              )}
                            </div>
                          );
                        }
                        return (
                          <div className="grid max-h-64 gap-2 overflow-y-auto pr-1">
                            {targets.map((target) => {
                              const pageTarget = target as { id: string; name: string; picture?: string | null; can_publish?: boolean; saved?: boolean };
                              const disabled =
                                modal.accountType === 'page' &&
                                pageTarget.can_publish === false;
                              const selected = fbSelectedTargets.includes(target.id);
                              return (
                                <button
                                  key={target.id}
                                  type="button"
                                  onClick={() => toggleFacebookSelection(target.id, disabled)}
                                  className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left ${
                                    disabled
                                      ? 'border-amber-200 bg-amber-50 text-amber-800'
                                      : 'border-slate-200 bg-white hover:bg-slate-50'
                                  }`}
                                >
                                  <div className="flex items-center gap-3">
                                    {pageTarget.picture ? (
                                      <img
                                        src={pageTarget.picture}
                                        alt={target.name}
                                        className="h-10 w-10 rounded-full object-cover border border-slate-200"
                                      />
                                    ) : (
                                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-600">
                                        {target.name?.[0]?.toUpperCase() || 'F'}
                                      </div>
                                    )}
                                    <div>
                                      <div className="flex items-center gap-2">
                                        <span className="text-sm font-semibold text-slate-900">{target.name}</span>
                                        {pageTarget.saved ? (
                                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                                            Connected
                                          </span>
                                        ) : null}
                                      </div>
                                      <div className="text-xs text-slate-500">
                                        {modal.accountType === 'group' ? 'Group' : `Page · ID: ${target.id}`}
                                      </div>
                                      {disabled ? (
                                        <div className="mt-1 text-xs text-amber-700">No publish access. Ask for Editor/Admin role.</div>
                                      ) : null}
                                    </div>
                                  </div>
                                  <input type="checkbox" checked={selected} readOnly />
                                </button>
                              );
                            })}
                          </div>
                        );
                      })()}

                      {modal.accountType === 'page' ? (
                        <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5">
                          <div className="text-xs font-semibold text-slate-700">
                            Don&apos;t see your Facebook Page?
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => void startOAuth('facebook', '/integrations?fbType=page', { rerequest: true })}
                              disabled={busy === 'facebook'}
                              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50"
                            >
                              <RefreshCw size={13} />
                              Reconnect &amp; Select Pages
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void startOAuth('facebook', '/integrations?fbType=page', {
                                  extraScopes: ['business_management'],
                                  rerequest: true,
                                })
                              }
                              disabled={busy === 'facebook'}
                              className="inline-flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                            >
                              <RefreshCw size={13} />
                              Reconnect with Business Portfolio Access
                            </button>
                          </div>
                          <div className="pt-1">
                            <label className="block text-[11px] font-medium text-slate-500">
                              Or find an authorized Page by Facebook Page URL, @username, or Page ID:
                            </label>
                            <div className="mt-1.5 flex gap-2">
                              <input
                                type="text"
                                value={fbLookupQuery}
                                onChange={(e) => setFbLookupQuery(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    void handleLookupFacebookPage();
                                  }
                                }}
                                placeholder="https://facebook.com/yourpage or Page ID"
                                className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs outline-none focus:border-slate-400"
                              />
                              <button
                                type="button"
                                onClick={() => void handleLookupFacebookPage()}
                                disabled={fbLookupLoading || !fbLookupQuery.trim()}
                                className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
                              >
                                {fbLookupLoading ? <Loader2 size={13} className="animate-spin" /> : null}
                                Find Page
                              </button>
                            </div>
                            {fbLookupError ? (
                              <div className="mt-1.5 text-xs text-red-600">{fbLookupError}</div>
                            ) : null}
                          </div>
                        </div>
                      ) : null}

                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setModal({ type: 'facebook-type' })}
                          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Back
                        </button>
                        <button
                          type="button"
                          onClick={() => void saveFacebookTargets(modal.accountType)}
                          disabled={busy === 'facebook-targets' || fbSelectedTargets.length === 0}
                          className="rounded-xl bg-slate-950 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                        >
                          {busy === 'facebook-targets' ? 'Saving…' : 'Finish Connection'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ) : null}

              {modal.type === 'instagram' ? (
                <div className="space-y-4">
                  {/* Mode switcher tabs */}
                  <div className="flex rounded-xl border border-line bg-soft p-1">
                    <button
                      type="button"
                      onClick={() => setIgModalTab('direct')}
                      className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                        igModalTab === 'direct'
                          ? 'bg-white text-ink shadow-xs'
                          : 'text-muted hover:text-ink'
                      }`}
                    >
                      <Sparkles size={14} className="text-blue" />
                      Direct Instagram Login
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIgModalTab('pages');
                        if (igTargets.length === 0 && !igLoading) {
                          void openInstagramTargets();
                        }
                      }}
                      className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                        igModalTab === 'pages'
                          ? 'bg-white text-ink shadow-xs'
                          : 'text-muted hover:text-ink'
                      }`}
                    >
                      <Layers size={14} />
                      Via Facebook Page
                    </button>
                  </div>

                  {igModalTab === 'direct' ? (
                    <div className="space-y-4">
                      <div className="rounded-2xl border border-line bg-soft p-4">
                        <div className="flex items-start gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue/10 text-blue">
                            <Instagram size={20} />
                          </div>
                          <div>
                            <div className="text-sm font-bold text-ink">Instagram Login for Business</div>
                            <div className="mt-1 text-xs text-muted leading-relaxed">
                              Sign in directly with your Instagram credentials to grant ContentFlow permissions to publish posts, stories, reels, and view insights. No Facebook Page link required!
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 space-y-2 rounded-xl border border-line bg-white p-3 text-xs text-muted">
                          <div className="font-semibold text-ink">Requirements for Instagram Login:</div>
                          <div className="flex items-start gap-2">
                            <CheckCircle size={14} className="mt-0.5 shrink-0 text-emerald" />
                            <span><strong>Professional Account:</strong> Must be set to Business or Creator (free to switch in Instagram mobile app under <em>Settings → Account type</em>).</span>
                          </div>
                          <div className="flex items-start gap-2">
                            <CheckCircle size={14} className="mt-0.5 shrink-0 text-emerald" />
                            <span><strong>Developer App Access:</strong> If your Meta app is in Development Mode, your Instagram handle must be added under <em>App Roles → Testers</em> in Meta Developer Portal.</span>
                          </div>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void startOAuth('instagram', '/integrations?igConnected=1&igMethod=instagram', { method: 'instagram' })}
                            disabled={busy === 'instagram'}
                            className="inline-flex items-center gap-2 rounded-xl bg-navy px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-slate-800 disabled:opacity-50"
                          >
                            {busy === 'instagram' ? <Loader2 size={14} className="animate-spin" /> : <Instagram size={14} />}
                            Launch Instagram Login
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {igLoading ? (
                        <div className="flex items-center justify-center py-10">
                          <Loader2 size={22} className="animate-spin text-muted" />
                        </div>
                      ) : !igFacebookConnected ? (
                        <div className="rounded-2xl border border-amber/30 bg-amber/10 p-4 text-xs text-amber-800 space-y-3">
                          <div className="flex items-center gap-2 font-semibold">
                            <AlertCircle size={16} />
                            Connect via Facebook Business Login for Instagram
                          </div>
                          <p>
                            Launch Meta&apos;s Business Login for Instagram (with embedded Page &amp; Professional Account onboarding) or connect your Facebook account with Page permissions.
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => void startOAuth('instagram', '/integrations?igConnected=1&igMethod=facebook', { method: 'facebook', rerequest: true })}
                              disabled={busy === 'instagram' || busy === 'facebook'}
                              className="inline-flex items-center gap-2 rounded-xl bg-navy px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 shadow-xs"
                            >
                              {busy === 'instagram' ? <Loader2 size={14} className="animate-spin" /> : <Instagram size={14} />}
                              Business Login for Instagram (via Facebook)
                            </button>
                            <button
                              type="button"
                              onClick={() => void startOAuth('facebook', '/integrations?igConnected=1&igMethod=facebook', { rerequest: true })}
                              disabled={busy === 'facebook' || busy === 'instagram'}
                              className="inline-flex items-center gap-2 rounded-xl border border-amber-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-50 shadow-xs"
                            >
                              {busy === 'facebook' ? <Loader2 size={14} className="animate-spin" /> : <Settings2 size={14} />}
                              Connect Facebook Access
                            </button>
                          </div>
                        </div>
                      ) : igTargets.filter((t) => t.instagramId).length === 0 ? (
                        <div className="space-y-3">
                          {igMissingPermissions.length > 0 ? (
                            <div className="rounded-2xl border border-amber/30 bg-amber/10 px-4 py-3 text-xs text-amber-800">
                              Missing Instagram permissions: {igMissingPermissions.join(', ')}. Reconnect Meta/Facebook and approve these permissions.
                            </div>
                          ) : null}
                          {igWarnings.length > 0 ? (
                            <div className="rounded-2xl border border-amber/30 bg-amber/10 px-4 py-3 text-xs text-amber-800">
                              {igWarnings.join(' ')}
                            </div>
                          ) : null}

                          <div className="rounded-2xl border border-line bg-soft p-4">
                            <div className="flex items-center gap-2 text-sm font-bold text-ink">
                              <Info size={16} className="text-blue" />
                              No Linked Instagram Professional Accounts Found
                            </div>
                            <p className="mt-2 text-xs text-muted leading-relaxed">
                              Your Facebook Pages were scanned, but none have an Instagram Business or Creator account connected. You can launch Meta&apos;s embedded onboarding flow or link your account manually:
                            </p>
                            <ol className="mt-3 list-decimal list-inside space-y-1.5 text-xs text-muted">
                              <li>Open the Instagram app on your phone and go to your profile.</li>
                              <li>Tap <strong>Edit profile</strong> → <strong>Public business information</strong> → <strong>Page</strong>.</li>
                              <li>Select or create your Facebook Page and confirm the connection.</li>
                              <li>Ensure your Instagram account is switched to <strong>Business</strong> or <strong>Creator</strong> (free in Account settings).</li>
                            </ol>
                            <div className="mt-4 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => void openInstagramTargets()}
                                className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-soft"
                              >
                                <RefreshCw size={13} /> Check Again
                              </button>
                              <button
                                type="button"
                                onClick={() => void startOAuth('instagram', '/integrations?igConnected=1&igMethod=facebook', { method: 'facebook', rerequest: true })}
                                className="inline-flex items-center gap-1.5 rounded-xl bg-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 shadow-xs"
                              >
                                Launch Instagram Business Onboarding (via Facebook)
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <>
                          {igMissingPermissions.length > 0 ? (
                            <div className="rounded-2xl border border-amber/30 bg-amber/10 px-4 py-3 text-xs text-amber-800">
                              Missing permissions: {igMissingPermissions.join(', ')}. Reconnect Meta to approve publishing rights.
                            </div>
                          ) : null}
                          {igWarnings.length > 0 ? (
                            <div className="rounded-2xl border border-amber/30 bg-amber/10 px-4 py-3 text-xs text-amber-800">
                              {igWarnings.join(' ')}
                            </div>
                          ) : null}

                          <div className="grid gap-3">
                            {igTargets
                              .filter((t) => t.instagramId)
                              .map((t) => (
                                <div
                                  key={`${t.pageId}:${t.instagramId}`}
                                  className="rounded-2xl border border-line bg-white p-4 transition-colors hover:border-slate-300"
                                >
                                  <div className="flex items-start justify-between gap-4">
                                    <div className="flex min-w-0 gap-3">
                                      {t.instagramProfilePicture ? (
                                        <img
                                          src={t.instagramProfilePicture}
                                          alt=""
                                          className="h-12 w-12 rounded-2xl object-cover border border-line"
                                        />
                                      ) : (
                                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-soft text-sm font-bold text-ink">
                                          {(t.instagramUsername || t.pageName || 'I').slice(0, 1).toUpperCase()}
                                        </div>
                                      )}
                                      <div className="min-w-0">
                                        <div className="truncate text-sm font-semibold text-ink">
                                          @{t.instagramUsername || t.instagramId}
                                        </div>
                                        {t.instagramName ? (
                                          <div className="truncate text-xs text-muted">{t.instagramName}</div>
                                        ) : null}
                                        <div className="mt-1 text-xs text-muted">Linked Page: {t.pageName}</div>
                                      </div>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        if (!t.instagramId) return;
                                        setBusy(`ig-${t.instagramId}`);
                                        try {
                                          const res = await integrationService.connectInstagram(t.pageId, t.instagramId, t.instagramUsername);
                                          if (!res.success) throw new Error(res.error || 'Failed to connect Instagram');
                                          await load();
                                          setModal({ type: 'none' });
                                        } catch (e) {
                                          alert(e instanceof Error ? e.message : 'Failed to connect Instagram');
                                        } finally {
                                          setBusy(null);
                                        }
                                      }}
                                      disabled={busy === `ig-${t.instagramId}`}
                                      className="inline-flex items-center gap-1.5 rounded-xl bg-navy px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60 shadow-xs"
                                    >
                                      {busy === `ig-${t.instagramId}` ? <Loader2 size={14} className="animate-spin" /> : null}
                                      {t.canPublish === false ? 'Save Account' : 'Connect'}
                                    </button>
                                  </div>

                                  <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted">
                                    {t.instagramAccountType ? (
                                      <span className="rounded-full bg-soft px-2.5 py-0.5 font-semibold text-ink">
                                        {t.instagramAccountType.replace(/_/g, ' ')}
                                      </span>
                                    ) : null}
                                    {typeof t.instagramFollowers === 'number' ? (
                                      <span className="rounded-full bg-soft px-2.5 py-0.5 font-semibold text-ink">
                                        {t.instagramFollowers.toLocaleString()} followers
                                      </span>
                                    ) : null}
                                    {typeof t.instagramMediaCount === 'number' ? (
                                      <span className="rounded-full bg-soft px-2.5 py-0.5 font-semibold text-ink">
                                        {t.instagramMediaCount.toLocaleString()} posts
                                      </span>
                                    ) : null}
                                    {t.canPublish === false ? (
                                      <span className="rounded-full bg-amber/15 px-2.5 py-0.5 font-semibold text-amber">
                                        Publishing permission missing
                                      </span>
                                    ) : null}
                                    {t.canInsights === false ? (
                                      <span className="rounded-full bg-amber/15 px-2.5 py-0.5 font-semibold text-amber">
                                        Insights permission missing
                                      </span>
                                    ) : null}
                                  </div>

                                  {t.instagramBio ? (
                                    <div className="mt-2.5 text-xs leading-5 text-muted line-clamp-2">{t.instagramBio}</div>
                                  ) : null}
                                </div>
                              ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ) : null}

              {modal.type === 'linkedin' ? (
                <div className="space-y-3">
                  {linkedInLoading ? (
                    <div className="flex items-center justify-center py-10">
                      <Loader2 size={22} className="animate-spin text-slate-400" />
                    </div>
                  ) : (
                    <>
                      <p className="text-xs text-slate-500">
                        Choose where to post on LinkedIn. Save your personal profile, a LinkedIn Page you admin, or both — each appears as a separate account in post distribution.
                      </p>

                      {linkedInWarning ? (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
                          {linkedInWarning}
                        </div>
                      ) : null}

                      {linkedInTargets.length === 0 ? (
                        <div className="text-sm text-slate-500">
                          No LinkedIn targets were found. Reconnect LinkedIn if you recently gained Page access.
                        </div>
                      ) : (
                        <div className="grid gap-2">
                          {linkedInTargets.map((target) => (
                            <div
                              key={`${target.accountType}:${target.id}`}
                              className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 ${target.saved ? 'border-indigo-200 bg-indigo-50' : 'border-slate-200 bg-white'}`}
                            >
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold text-slate-900">{target.name}</div>
                                <div className="text-xs text-slate-500">
                                  {target.accountType === 'page' ? 'LinkedIn Page' : 'Personal profile'}
                                </div>
                              </div>
                              <button
                                type="button"
                                disabled={busy === `li-${target.accountType}-${target.id}`}
                                onClick={async () => {
                                  setBusy(`li-${target.accountType}-${target.id}`);
                                  try {
                                    if (target.saved) {
                                      const accts = await socialPostService.listAccounts();
                                      const match = accts.find(
                                        (a) => a.platform === 'linkedin' && a.account_type === target.accountType && a.account_id === target.id
                                      );
                                      if (match) await socialPostService.deleteAccount(match.id);
                                    } else {
                                      const res = await integrationService.saveSocialTarget({
                                        platform: 'linkedin',
                                        account_type: target.accountType,
                                        account_id: target.id,
                                        account_name: target.name,
                                      });
                                      if (!res.success) throw new Error(res.error || 'Failed to save LinkedIn target');
                                    }
                                    await load();
                                    await openLinkedInTargets();
                                  } catch (e) {
                                    alert(e instanceof Error ? e.message : 'Failed to update LinkedIn target');
                                  } finally {
                                    setBusy(null);
                                  }
                                }}
                                className={`shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors ${
                                  target.saved
                                    ? 'bg-indigo-100 text-indigo-700 hover:bg-red-100 hover:text-red-700'
                                    : 'bg-slate-950 text-white hover:bg-slate-700'
                                }`}
                              >
                                {busy === `li-${target.accountType}-${target.id}` ? (
                                  <Loader2 size={12} className="animate-spin" />
                                ) : target.saved ? (
                                  'Saved ✓'
                                ) : (
                                  'Save'
                                )}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              ) : null}

              {modal.type === 'linkedin-select' ? (
                <div className="space-y-3">
                  {linkedInOrgLoading ? (
                    <div className="flex items-center justify-center py-10">
                      <Loader2 size={22} className="animate-spin text-slate-400" />
                    </div>
                  ) : (
                    <>
                      <p className="text-xs text-slate-500">
                        Select the company pages you admin to enable full analytics tracking, including impressions, engagement, and audience insights.
                      </p>

                      {linkedInOrganizations.length === 0 ? (
                        <div className="text-sm text-slate-500">
                          No organization pages found. Ensure you have admin access to a LinkedIn Company Page.
                        </div>
                      ) : (
                        <div className="grid gap-2">
                          {linkedInOrganizations.map((org) => {
                            const isSelected = linkedInSelectedOrgs.includes(org.id);
                            return (
                              <button
                                key={org.id}
                                type="button"
                                onClick={() => {
                                  setLinkedInSelectedOrgs((prev) =>
                                    isSelected ? prev.filter((id) => id !== org.id) : [...prev, org.id]
                                  );
                                }}
                                className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 transition ${
                                  isSelected ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 bg-white hover:bg-slate-50'
                                }`}
                              >
                                <div className="flex items-center gap-3">
                                  {org.picture_url && (
                                    <img src={org.picture_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                                  )}
                                  <div className="min-w-0">
                                    <div className="truncate text-sm font-semibold text-slate-900">{org.name}</div>
                                    <div className="text-xs text-slate-500">LinkedIn Company Page</div>
                                  </div>
                                </div>
                                <input type="checkbox" checked={isSelected} readOnly className="shrink-0" />
                              </button>
                            );
                          })}
                        </div>
                      )}

                      <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                        <button
                          type="button"
                          onClick={() => setModal({ type: 'none' })}
                          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleLinkedInOrgConnect()}
                          disabled={busy === 'linkedin-company' || linkedInSelectedOrgs.length === 0}
                          className="rounded-xl bg-slate-950 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                        >
                          {busy === 'linkedin-company' ? 'Connecting...' : 'Connect Pages'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ) : null}

              {modal.type === 'mailchimp' ? (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label className="text-xs font-semibold text-slate-600">API key</label>
                      <input
                        type="password"
                        autoComplete="off"
                        value={mcApiKey}
                        onChange={(e) => setMcApiKey(e.target.value)}
                        placeholder="xxxxxxxxxxxxxxxx-us19"
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-600">Server prefix (optional)</label>
                      <input
                        value={mcServerPrefix}
                        onChange={(e) => setMcServerPrefix(e.target.value)}
                        placeholder="Read from the key, e.g. us19"
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400"
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={async () => {
                      setBusy('mailchimp');
                      try {
                        const res = await integrationService.connectMailchimp({ apiKey: mcApiKey, serverPrefix: mcServerPrefix });
                        if (!res.success) throw new Error(res.error || 'Failed to connect Mailchimp');
                        alert('Mailchimp connected.');
                        await load();
                        setModal({ type: 'none' });
                        setMcApiKey('');
                      } catch (e) {
                        alert(e instanceof Error ? e.message : 'Failed to connect Mailchimp');
                      } finally {
                        setBusy(null);
                      }
                    }}
                    disabled={busy === 'mailchimp' || !mcApiKey.trim()}
                    className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60"
                  >
                    {busy === 'mailchimp' ? <Loader2 size={16} className="animate-spin" /> : <Plug size={16} />} Connect
                  </button>

                  <p className="text-xs text-slate-500">We validate the key server-side and store it encrypted.</p>
                </div>
              ) : null}

              {modal.type === 'whatsapp' ? (
                <div className="space-y-4">
                  <p className="text-sm text-slate-500">
                    Enter your WhatsApp Business Cloud API credentials from the Meta Developer Console. Your phone number ID and a permanent system user access token are required.
                  </p>
                  <div className="grid gap-3">
                    <div>
                      <label className="text-xs font-semibold text-slate-600">Phone Number ID</label>
                      <input
                        value={waPhoneNumberId}
                        onChange={(e) => setWaPhoneNumberId(e.target.value)}
                        placeholder="1234567890123456"
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-600">Access Token</label>
                      <input
                        type="password"
                        value={waAccessToken}
                        onChange={(e) => setWaAccessToken(e.target.value)}
                        placeholder="EAAxxxxxxx..."
                        className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400"
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void connectWhatsApp()}
                      disabled={busy === 'whatsapp' || !waPhoneNumberId.trim() || !waAccessToken.trim()}
                      className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60"
                    >
                      {busy === 'whatsapp' ? <Loader2 size={16} className="animate-spin" /> : <Plug size={16} />} Save & Verify
                    </button>
                  </div>
                  <p className="text-xs text-slate-500">
                    Find your Phone Number ID in Meta Developer Console → WhatsApp → API Setup. Use a system user permanent token for production.
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
