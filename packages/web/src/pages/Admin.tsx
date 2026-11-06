import {
  BookOpen,
  Bot,
  ChevronDown,
  Clapperboard,
  CreditCard,
  FileText,
  Film,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Network,
  Plug,
  Receipt,
  SlidersHorizontal,
  Users,
  Waypoints,
  DollarSign,
  Image,
  Zap,
  Globe,
  Wand2,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { AppUser, clearStoredUser } from '../utils/userSession';
import { Loading } from '../components/ui';

const AdminOverview = lazy(() => import('../components/admin/AdminOverview'));
const UserManagementPage = lazy(() => import('../components/admin/UserManagementPage'));
const PricingManagement = lazy(() => import('../components/admin/PricingManagement'));
const AdminCardsManagement = lazy(() => import('../components/admin/AdminCardsManagement'));
const PaymentManagement = lazy(() => import('../components/admin/PaymentManagement'));
const AdminAuthProviders = lazy(() => import('../components/admin/AdminAuthProviders'));
const AdminPagesManagement = lazy(() => import('../components/admin/AdminPagesManagement'));
const AdminMediaManagement = lazy(() => import('../components/admin/AdminMediaManagement'));
const AdminIntegrations = lazy(() => import('../components/admin/AdminIntegrations'));
const AdminAIConfig = lazy(() => import('../components/admin/AdminAIConfig'));
const AdminAISkills = lazy(() => import('../components/admin/AdminAISkills'));
const AdminBillingDashboard = lazy(() => import('../components/admin/AdminBillingDashboard'));
const AdminApify = lazy(() => import('../components/admin/AdminApify'));
const AdminLearn = lazy(() => import('../components/admin/AdminLearn'));
const AdminAgents = lazy(() => import('../components/admin/AdminAgents'));
const AdminMagnific = lazy(() => import('../components/admin/AdminMagnific'));
const AdminKling = lazy(() => import('../components/admin/AdminKling'));
const AdminGoogle = lazy(() => import('../components/admin/AdminGoogle'));
const AdminOpenAI = lazy(() => import('../components/admin/AdminOpenAI'));
const AdminAuditLog = lazy(() => import('../components/admin/AdminAuditLog'));
const AdminPlatformSettings = lazy(() => import('../components/admin/AdminPlatformSettings'));
const AdminHiggsfield = lazy(() => import('../components/admin/AdminHiggsfield'));
const AdminNavSettings = lazy(() => import('../components/admin/AdminNavSettings'));
const AdminMCP = lazy(() => import('../components/admin/AdminMCP'));

type AdminProps = {
  currentUser: AppUser | null;
};

const Admin = ({ currentUser }: AdminProps) => {
  type AdminTab =
    | 'overview'
    | 'users'
    | 'pricing'
    | 'cards'
    | 'payments'
    | 'auth-providers'
    | 'integrations'
    | 'settings'
    | 'audit'
    | 'nav-settings'
    | 'pages-home'
    | 'pages-tools'
    | 'pages-pricing-public'
    | 'pages-login'
    | 'pages-privacy'
    | 'pages-terms'
    | 'media'
    | 'ai-config'
    | 'ai-skills'
    | 'billing'
    | 'apify'
    | 'learn'
    | 'agents'
    | 'magnific'
    | 'kling'
    | 'google'
    | 'openai'
    | 'higgsfield'
    | 'mcp';

  const TAB_PATHS: Record<AdminTab, string> = {
    overview: '/admin/overview',
    users: '/admin/users',
    pricing: '/admin/pricing',
    cards: '/admin/cards',
    payments: '/admin/payments',
    'auth-providers': '/admin/auth-providers',
    integrations: '/admin/integrations',
    settings: '/admin/settings',
    audit: '/admin/audit',
    'nav-settings': '/admin/nav-settings',
    'pages-home': '/admin/pages/home',
    'pages-tools': '/admin/pages/tools',
    'pages-pricing-public': '/admin/pages/pricing',
    'pages-login': '/admin/pages/login',
    'pages-privacy': '/admin/pages/privacy',
    'pages-terms': '/admin/pages/terms',
    media: '/admin/media',
    'ai-config': '/admin/ai',
    'ai-skills': '/admin/ai/skills',
    billing: '/admin/billing',
    apify: '/admin/apify',
    learn: '/admin/learn',
    agents: '/admin/agents',
    magnific: '/admin/magnific',
    kling: '/admin/kling',
    google: '/admin/google',
    openai: '/admin/openai',
    higgsfield: '/admin/higgsfield',
    mcp: '/admin/mcp',
  };

  const TAB_LABELS: Record<AdminTab, string> = {
    overview: 'Overview',
    users: 'User Management',
    pricing: 'Pricing Plans',
    cards: 'Card Templates',
    payments: 'Payments',
    'auth-providers': 'Login Providers',
    integrations: 'Integrations',
    settings: 'Platform Settings',
    audit: 'Audit Log',
    'nav-settings': 'Navigation',
    'pages-home': 'Homepage CMS',
    'pages-tools': 'Tools Page CMS',
    'pages-pricing-public': 'Pricing Page CMS',
    'pages-login': 'Login / Signup CMS',
    'pages-privacy': 'Privacy Policy CMS',
    'pages-terms': 'Terms of Service CMS',
    media: 'Media Library',
    'ai-config': 'AI Configuration',
    'ai-skills': 'Create AI Skill',
    billing: 'Subscriptions',
    apify: 'Apify Actors & Runs',
    learn: 'Daky Learn',
    agents: 'Agent Team',
    magnific: 'Magnific AI',
    kling: 'Kling AI',
    google: 'Google AI',
    openai: 'OpenAI',
    higgsfield: 'Higgsfield AI',
    mcp: 'MCP Servers',
  };

  const PATH_TO_TAB: Record<string, AdminTab> = Object.fromEntries(
    Object.entries(TAB_PATHS).map(([tab, path]) => [path, tab as AdminTab])
  );

  const getInitialTab = (): AdminTab => {
    const fromPath = PATH_TO_TAB[window.location.pathname];
    if (fromPath) return fromPath;
    return window.location.pathname === '/admin' || window.location.pathname === '/admin/' ? 'overview' : 'users';
  };

  const [activeTab, setActiveTab] = useState<AdminTab>(getInitialTab);
  const [pagesOpen, setPagesOpen] = useState(() => window.location.pathname.startsWith('/admin/pages'));
  const [aiOpen, setAiOpen] = useState(() =>
    ['/admin/ai', '/admin/learn', '/admin/magnific', '/admin/kling', '/admin/google', '/admin/openai', '/admin/higgsfield'].some((p) =>
      window.location.pathname.startsWith(p)
    )
  );
  const [apifyOpen, setApifyOpen] = useState(() => window.location.pathname.startsWith('/admin/apify'));
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const currentAdminRole = 'Admin' as const;

  const navigateTab = (tab: AdminTab) => {
    setActiveTab(tab);
    window.history.pushState({}, '', TAB_PATHS[tab]);
    setMobileNavOpen(false);
  };

  const returnToWorkspace = () => {
    window.history.pushState({}, document.title, '/dashboard');
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const handleLogout = () => {
    localStorage.removeItem('auth_session');
    localStorage.removeItem('auth_token');
    clearStoredUser();
    window.location.assign('/login');
  };

  const adminItems = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard, active: true },
    { id: 'users', label: 'User Management', icon: Users, active: true, tourId: 'admin-tab-users' },
    { id: 'pricing', label: 'Pricing Plans', icon: DollarSign, active: true },
    { id: 'cards', label: 'Card Templates', icon: Image, active: true },
    { id: 'payments', label: 'Payments', icon: CreditCard, active: true },
    { id: 'billing', label: 'Subscriptions', icon: Receipt, active: true, tourId: 'admin-tab-billing' },
    { id: 'auth-providers', label: 'Login Providers', icon: KeyRound, active: true },
    { id: 'integrations', label: 'Integrations', icon: Waypoints, active: true },
    { id: 'media', label: 'Media', icon: Image, active: true },
    { id: 'mcp', label: 'MCP', icon: Plug, active: true },
    { id: 'settings', label: 'Platform Settings', icon: SlidersHorizontal, active: true },
    { id: 'audit', label: 'Audit Log', icon: Waypoints, active: true },
    { id: 'nav-settings', label: 'Navigation', icon: Network, active: true },
  ] as { id: AdminTab; label: string; icon: React.ElementType; active: boolean; tourId?: string }[];

  const pagesItems: { id: AdminTab; label: string }[] = [
    { id: 'pages-home', label: 'Homepage' },
    { id: 'pages-tools', label: 'Tools' },
    { id: 'pages-pricing-public', label: 'Pricing Page' },
    { id: 'pages-login', label: 'Login / Signup' },
    { id: 'pages-privacy', label: 'Privacy Policy' },
    { id: 'pages-terms', label: 'Terms of Service' },
  ];

  const aiItems: { id: AdminTab; label: string; icon: React.ElementType }[] = [
    { id: 'ai-config', label: 'Configuration', icon: Bot },
    { id: 'ai-skills', label: 'Create AI Skill', icon: Zap },
    { id: 'learn', label: 'Daky Learn', icon: BookOpen },
    { id: 'magnific', label: 'Magnific AI', icon: Wand2 },
    { id: 'kling', label: 'Kling AI', icon: Clapperboard },
    { id: 'google', label: 'Google AI', icon: Globe },
    { id: 'openai', label: 'OpenAI', icon: Bot },
    { id: 'higgsfield', label: 'Higgsfield AI', icon: Film },
  ];

  const isPagesActive = activeTab.startsWith('pages-');
  const isAIActive =
    activeTab.startsWith('ai-') || ['learn', 'magnific', 'kling', 'google', 'openai', 'higgsfield'].includes(activeTab);
  const isApifyActive = activeTab === 'apify';

  useEffect(() => {
    const onPop = () => {
      const tab = PATH_TO_TAB[window.location.pathname];
      if (tab) {
        setActiveTab(tab);
        setPagesOpen(tab.startsWith('pages-'));
        setAiOpen(
          tab.startsWith('ai-') || ['learn', 'magnific', 'kling', 'google', 'openai', 'higgsfield'].includes(tab)
        );
        setApifyOpen(tab === 'apify');
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const q = filter.trim().toLowerCase();
  const matches = (label: string) => !q || label.toLowerCase().includes(q);
  const adminName = currentUser?.name?.trim() || currentUser?.email || 'Admin';
  const adminInitials = adminName.slice(0, 2).toUpperCase();

  const SidebarContent = ({ mobile = false }: { mobile?: boolean }) => (
    <div className="flex h-full flex-col bg-white">
      <div className="os-brand">
        <div className="min-w-0 flex-1">
          <img src="/brand/lockup-on-light.png" alt="DakyXTech" className="block h-6 w-auto" />
          <span>Admin Console</span>
        </div>
        {mobile && (
          <button type="button" onClick={() => setMobileNavOpen(false)} className="os-nav-close">
            Close
          </button>
        )}
      </div>

      {/* Mode switcher matching DakyXTech Layout.tsx */}
      <div className="px-3 pt-3 pb-1">
        <div className="flex rounded-xl bg-sunken p-1" role="group" aria-label="Workspace view mode">
          <button
            type="button"
            className="flex-1 rounded-[10px] bg-white py-1.5 text-center text-[11px] font-medium text-ink shadow-[0_1px_2px_rgba(9,24,51,.08)]"
          >
            Admin OS
          </button>
          <button
            type="button"
            onClick={returnToWorkspace}
            className="flex-1 rounded-[10px] py-1.5 text-center text-[11px] font-medium text-muted hover:text-ink transition"
          >
            Return to Dakyworld Hub
          </button>
        </div>
      </div>

      <div className="os-nav-search">
        <input
          aria-label="Find an admin screen"
          placeholder="Find a setting"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <nav className="os-navigation flex flex-col" aria-label={mobile ? 'Mobile admin navigation' : 'Admin navigation'}>
        <section className="os-nav-section">
          <h2>Platform governance</h2>
          {adminItems
            .filter((item) => matches(item.label))
            .map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id && item.active;
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={!item.active}
                  {...(item.tourId ? { 'data-tour-id': item.tourId } : {})}
                  onClick={() => item.active && navigateTab(item.id as AdminTab)}
                  className={`os-nav-link ${isActive ? 'is-active' : ''}`}
                >
                  <Icon size={15} className="shrink-0 opacity-75" />
                  <span className="flex-1 text-left">{item.label}</span>
                </button>
              );
            })}
        </section>

        <section className="os-nav-section">
          <h2>Workforce &amp; AI</h2>
          {matches('Agent Team') && (
            <button
              type="button"
              data-tour-id="admin-tab-agents"
              onClick={() => navigateTab('agents')}
              className={`os-nav-link ${activeTab === 'agents' ? 'is-active' : ''}`}
            >
              <Network size={15} className="shrink-0 opacity-75" />
              <span className="flex-1 text-left">Agent Team</span>
            </button>
          )}

          {/* AI Assistant accordion */}
          <div>
            <button
              type="button"
              data-tour-id="admin-accordion-ai"
              onClick={() => setAiOpen((prev) => !prev)}
              className={`os-nav-link ${isAIActive ? 'is-active' : ''}`}
            >
              <Bot size={15} className="shrink-0 opacity-75" />
              <span className="flex-1 text-left">AI Assistant</span>
              <ChevronDown
                size={12}
                className={`text-faint transition-transform duration-200 ${aiOpen || isAIActive || Boolean(q) ? 'rotate-180' : ''}`}
              />
            </button>

            {(aiOpen || isAIActive || Boolean(q)) && (
              <div className="ml-4 border-l border-line pl-2.5 py-0.5 flex flex-col">
                {aiItems
                  .filter((item) => matches(`AI ${item.label}`))
                  .map((item) => {
                    const Icon = item.icon;
                    const tourIdMap: Partial<Record<typeof item.id, string>> = {
                      'ai-config': 'admin-tab-ai-config',
                      learn: 'admin-tab-learn',
                      agents: 'admin-tab-agents',
                    };
                    return (
                      <button
                        key={item.id}
                        type="button"
                        {...(tourIdMap[item.id] ? { 'data-tour-id': tourIdMap[item.id] } : {})}
                        onClick={() => navigateTab(item.id)}
                        className={`os-nav-sublink ${activeTab === item.id ? 'is-active' : ''}`}
                      >
                        <span className="flex items-center gap-2">
                          <Icon size={13} className="shrink-0 opacity-75" />
                          {item.label}
                        </span>
                      </button>
                    );
                  })}
              </div>
            )}
          </div>

          {/* Apify accordion */}
          <div>
            <button
              type="button"
              onClick={() => setApifyOpen((prev) => !prev)}
              className={`os-nav-link ${isApifyActive ? 'is-active' : ''}`}
            >
              <Globe size={15} className="shrink-0 opacity-75" />
              <span className="flex-1 text-left">Apify</span>
              <ChevronDown
                size={12}
                className={`text-faint transition-transform duration-200 ${apifyOpen || isApifyActive || Boolean(q) ? 'rotate-180' : ''}`}
              />
            </button>

            {(apifyOpen || isApifyActive || Boolean(q)) && (
              <div className="ml-4 border-l border-line pl-2.5 py-0.5 flex flex-col">
                {matches('Apify Actors & Runs') && (
                  <button
                    type="button"
                    onClick={() => navigateTab('apify')}
                    className={`os-nav-sublink ${activeTab === 'apify' ? 'is-active' : ''}`}
                  >
                    <span className="flex items-center gap-2">
                      <Globe size={13} className="shrink-0 opacity-75" />
                      Actors &amp; Runs
                    </span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Pages CMS accordion */}
          <div>
            <button
              type="button"
              onClick={() => setPagesOpen((prev) => !prev)}
              className={`os-nav-link ${isPagesActive ? 'is-active' : ''}`}
            >
              <FileText size={15} className="shrink-0 opacity-75" />
              <span className="flex-1 text-left">Pages</span>
              <ChevronDown
                size={12}
                className={`text-faint transition-transform duration-200 ${pagesOpen || isPagesActive || Boolean(q) ? 'rotate-180' : ''}`}
              />
            </button>

            {(pagesOpen || isPagesActive || Boolean(q)) && (
              <div className="ml-4 border-l border-line pl-2.5 py-0.5 flex flex-col">
                {pagesItems
                  .filter((item) => matches(`Pages ${item.label}`))
                  .map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => navigateTab(item.id)}
                      className={`os-nav-sublink ${activeTab === item.id ? 'is-active' : ''}`}
                    >
                      {item.label}
                    </button>
                  ))}
              </div>
            )}
          </div>
        </section>
      </nav>

      {/* Bottom account bar matching DakyXTech v22 Layout.tsx */}
      <div className="os-account">
        <div className="os-initials">{adminInitials}</div>
        <div className="min-w-0 flex-1">
          <strong>{adminName}</strong>
          <span>{currentAdminRole}</span>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button type="button" onClick={returnToWorkspace}>
            Workspace
          </button>
          <button type="button" onClick={handleLogout} className="flex items-center gap-1 text-danger-text hover:!text-danger">
            <LogOut size={11} />
            Log out
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="os-app os-shell">
      <a href="#admin-workspace" className="os-skip">
        Skip to content
      </a>

      {/* Desktop floating white sidebar panel */}
      <aside className="os-sidebar">
        <SidebarContent />
      </aside>

      {/* Mobile navigation layer */}
      {mobileNavOpen && (
        <div className="os-mobile-layer">
          <div className="os-backdrop" onClick={() => setMobileNavOpen(false)} aria-hidden />
          <aside className="os-mobile-nav" role="dialog" aria-modal="true" aria-label="Admin Navigation">
            <SidebarContent mobile />
          </aside>
        </div>
      )}

      {/* Main viewport column */}
      <div className="os-viewport">
        <header className="os-topbar">
          <div className="flex min-w-0 items-center gap-3.5">
            <button
              type="button"
              className="os-menu-button"
              aria-expanded={mobileNavOpen}
              onClick={() => setMobileNavOpen(true)}
            >
              Menu
            </button>
            <img src="/brand/lockup-on-light.png" alt="DakyXTech" className="h-5 w-auto lg:hidden" />
            <img src="/brand/mark-on-light-96.png" alt="DakyXTech" className="hidden lg:block h-5 w-5 rounded-[5px]" />
            <span className="os-workspace-label">Admin Dashboard</span>
            <span className="os-breadcrumb-divider">/</span>
            <span className="truncate font-medium text-ink">{TAB_LABELS[activeTab] ?? 'Control center'}</span>
          </div>

          <div className="flex items-center gap-4">
            <span className="hidden sm:inline text-xs text-muted">
              Signed in as <strong className="font-medium text-ink">{adminName}</strong> · {currentAdminRole}
            </span>
            <button type="button" onClick={returnToWorkspace} className="os-text-link">
              Workspace
            </button>
            <span className="os-topbar-date">
              {new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date())}
            </span>
          </div>
        </header>

        <div className="os-page">
          <main id="admin-workspace" tabIndex={-1} className="os-workspace">
            <Suspense
              fallback={
                <div className="py-12">
                  <Loading rows={6} />
                </div>
              }
            >
              {activeTab === 'overview' && <AdminOverview />}
              {activeTab === 'users' && <UserManagementPage currentAdminRole={currentAdminRole} />}
              {activeTab === 'pricing' && <PricingManagement />}
              {activeTab === 'cards' && <AdminCardsManagement />}
              {activeTab === 'payments' && <PaymentManagement />}
              {activeTab === 'auth-providers' && <AdminAuthProviders />}
              {activeTab === 'integrations' && <AdminIntegrations />}
              {activeTab === 'media' && <AdminMediaManagement />}
              {activeTab === 'ai-config' && <AdminAIConfig />}
              {activeTab === 'ai-skills' && <AdminAISkills />}
              {activeTab === 'billing' && <AdminBillingDashboard />}
              {activeTab === 'apify' && <AdminApify />}
              {activeTab === 'mcp' && <AdminMCP />}
              {activeTab === 'learn' && <AdminLearn />}
              {activeTab === 'agents' && <AdminAgents />}
              {activeTab === 'magnific' && <AdminMagnific />}
              {activeTab === 'kling' && <AdminKling />}
              {activeTab === 'google' && <AdminGoogle />}
              {activeTab === 'openai' && <AdminOpenAI />}
              {activeTab === 'settings' && <AdminPlatformSettings />}
              {activeTab === 'audit' && <AdminAuditLog />}
              {activeTab === 'nav-settings' && <AdminNavSettings />}
              {activeTab === 'higgsfield' && <AdminHiggsfield />}
              {activeTab.startsWith('pages-') && <AdminPagesManagement activePage={activeTab} />}
            </Suspense>
          </main>
          <footer className="os-workspace-footer">
            <span className="inline-flex items-center gap-2">
              <img src="/brand/lockup-on-light.png" alt="DakyXTech" className="h-4 w-auto opacity-85" />
              <span>Admin OS</span>
            </span>
            <span>Built for considered work.</span>
          </footer>
        </div>
      </div>
    </div>
  );
};

export default Admin;
