import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  BarChart4,
  Bell,
  Bot,
  Building2,
  ChevronDown,
  Compass,
  PhoneCall,
  CreditCard,
  HelpCircle,
  Layers,
  LogOut,
  Megaphone,
  Plus,
  Rocket,
  Shield,
  Sparkles,
  Star,
  User,
  Waypoints,
  Settings,
} from 'lucide-react';
import NotificationBell from './components/NotificationBell';
import OnboardingWizard from './components/OnboardingWizard';
import { onboardingService } from './services/onboardingService';
import PageTour, { PAGE_GUIDES } from './components/PageTour';
import GuidedTour, { SYSTEM_TOUR_STEPS, TourStep as GuidedTourStep } from './components/GuidedTour';
import AdvancedTemplateCardModal from './components/TemplateEditorHost';
import HelpModal from './components/HelpModal';
import ErrorBoundary from './components/ErrorBoundary';
import ChatWidget from './components/ChatWidget';
import ToastContainer from './components/ToastContainer';
import { ToastContext, useToast, useToastState } from './hooks/useToast';
import { Loading } from './components/ui';

// Pages — lazy-loaded to split the bundle into per-route chunks
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Posts = lazy(() => import('./pages/Posts'));
const Cards = lazy(() => import('./pages/Cards'));
const WorkflowPage = lazy(() => import('./pages/Workflow'));
const Admin = lazy(() => import('./pages/Admin'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Pricing = lazy(() => import('./pages/Pricing'));
const Profile = lazy(() => import('./pages/Profile'));
const Media = lazy(() => import('./pages/Media'));
const Integrations = lazy(() => import('./pages/Integrations'));
const Auth = lazy(() => import('./pages/Auth'));
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy'));
const TermsOfService = lazy(() => import('./pages/TermsOfService'));
const RefundPolicy = lazy(() => import('./pages/RefundPolicy'));
const Landing = lazy(() => import('./pages/Landing'));
const Tools = lazy(() => import('./pages/Tools'));
const PublicPricing = lazy(() => import('./pages/PublicPricing'));
const DataDeletion = lazy(() => import('./pages/DataDeletion'));
const OAuthCallback = lazy(() => import('./pages/OAuthCallback'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const VerifyEmail = lazy(() => import('./pages/VerifyEmail'));
const PostAutomation = lazy(() => import('./pages/PostAutomation'));
const MarketingOverview = lazy(() => import('./pages/MarketingOverview'));
const MarketingContacts = lazy(() => import('./pages/MarketingContacts'));
const MarketingEmail = lazy(() => import('./pages/MarketingEmail'));
const MarketingCampaigns = lazy(() => import('./pages/MarketingCampaigns'));
const MarketingSurveys = lazy(() => import('./pages/MarketingSurveys'));
const MarketingAutomations = lazy(() => import('./pages/MarketingAutomations'));
const MarketingForms = lazy(() => import('./pages/MarketingForms'));
const MarketingLeads = lazy(() => import('./pages/MarketingLeads'));
const MarketingLeadsImport = lazy(() => import('./pages/MarketingLeadsImport'));
const SalesLeads = lazy(() => import('./pages/SalesLeads'));
const SalesConversations = lazy(() => import('./pages/SalesConversations'));
const SalesFollowUps = lazy(() => import('./pages/SalesFollowUps'));
const SalesIntelligence = lazy(() => import('./pages/SalesIntelligence'));
const SalesSettings = lazy(() => import('./pages/SalesSettings'));
const CRMCompanies = lazy(() => import('./pages/CRMCompanies'));
const CRMPipeline = lazy(() => import('./pages/CRMPipeline'));
const CRMLeadScoring = lazy(() => import('./pages/CRMLeadScoring'));
const GmailAgent = lazy(() => import('./pages/GmailAgent'));
const ConnectorHub = lazy(() => import('./pages/ConnectorHub'));
const ConnectorProviderSetup = lazy(() => import('./pages/ConnectorProviderSetup'));
const ConnectorSyncDashboard = lazy(() => import('./pages/ConnectorSyncDashboard'));
const PublicSurvey = lazy(() => import('./pages/PublicSurvey'));
const Workspace = lazy(() => import('./pages/Workspace'));
const AcceptInvite = lazy(() => import('./pages/AcceptInvite'));
const Billing = lazy(() => import('./pages/Billing'));
const Credits = lazy(() => import('./pages/Credits'));
const Memory = lazy(() => import('./pages/Memory'));
const Changelog = lazy(() => import('./pages/Changelog'));
const AITeam = lazy(() => import('./pages/AITeam'));
const Discover = lazy(() => import('./pages/Discover'));
const Notifications = lazy(() => import('./pages/Notifications'));
const TasksPage = lazy(() => import('./components/tasks/TasksPage'));
const ProjectSettings = lazy(() => import('./pages/ProjectSettings'));
const SettingsPage = lazy(() => import('./pages/Settings'));
const SocialInbox = lazy(() => import('./pages/SocialInbox'));
const ClientReviewPortal = lazy(() => import('./pages/ClientReviewPortal'));
import QuotaUpgradeModal, { QuotaExceededPayload } from './components/QuotaUpgradeModal';
import { TemplateEditorProvider } from './hooks/useTemplateEditor';
import { WorkspaceProvider, useWorkspace } from './contexts/WorkspaceContext';
import { API_BASE_URL } from './utils/apiBase';
import {
  AppUser,
  clearStoredUser,
  getStoredUser,
  isProfileComplete,
  normalizeUser,
  setStoredUser,
} from './utils/userSession';

const PageFallback = () => (
  <div className="py-10">
    <Loading rows={5} />
  </div>
);

export type PageType =
  | 'dashboard'
  | 'notifications'
  | 'posts'
  | 'post-automation'
  | 'cards'
  | 'media'
  | 'analytics'
  | 'admin'
  | 'profile'
  | 'memory'
  | 'integrations'
  | 'marketing'
  | 'marketing-contacts'
  | 'marketing-email'
  | 'marketing-campaigns'
  | 'marketing-surveys'
  | 'marketing-automations'
  | 'marketing-forms'
  | 'marketing-leads'
  | 'marketing-leads-import'
  | 'sales-leads'
  | 'sales-conversations'
  | 'sales-followups'
  | 'sales-intelligence'
  | 'sales-settings'
  | 'crm-companies'
  | 'crm-pipeline'
  | 'crm-scoring'
  | 'gmail-agent'
  | 'connector-hub'
  | 'connector-setup'
  | 'connector-sync'
  | 'workspace'
  | 'credits'
  | 'billing'
  | 'pricing'
  | 'tasks'
  | 'project-settings'
  | 'settings'
  | 'workflow'
  | 'discover'
  | 'ai-team'
  | 'social-inbox';

type AuthMeResponse = {
  success: boolean;
  user?: Partial<AppUser> & { id?: string; email?: string };
};

const safeJson = async <T,>(response: Response): Promise<T | null> => {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
};

const PAGE_PATHS: Record<PageType, string> = {
  dashboard: '/dashboard',
  notifications: '/notifications',
  posts: '/posts',
  'post-automation': '/posts/automation',
  cards: '/cards',
  media: '/media',
  analytics: '/analytics',
  pricing: '/pricing',
  admin: '/admin/overview',
  profile: '/profile',
  memory: '/memory',
  integrations: '/integrations',
  marketing: '/marketing',
  'marketing-contacts': '/marketing/contacts',
  'marketing-email': '/marketing/email',
  'marketing-campaigns': '/marketing/campaigns',
  'marketing-surveys': '/marketing/surveys',
  'marketing-automations': '/marketing/automations',
  'marketing-forms': '/marketing/forms',
  'marketing-leads': '/marketing/leads',
  'marketing-leads-import': '/marketing/leads/import',
  'sales-leads': '/sales/leads',
  'sales-conversations': '/sales/conversations',
  'sales-followups': '/sales/followups',
  'sales-intelligence': '/sales/intelligence',
  'sales-settings': '/sales/settings',
  'crm-companies': '/crm/companies',
  'crm-pipeline': '/crm/pipeline',
  'crm-scoring': '/crm/scoring',
  'gmail-agent': '/crm/gmail-agent',
  'connector-hub': '/connectors',
  'connector-setup': '/connectors/setup',
  'connector-sync': '/connectors/sync',
  workspace: '/workspace',
  credits: '/credits',
  billing: '/billing',
  tasks: '/tasks',
  'project-settings': '/project/settings',
  settings: '/settings',
  workflow: '/posts/workflow',
  discover: '/discover',
  'ai-team': '/ai-team',
  'social-inbox': '/social-inbox',
};

const PAGE_TITLES: Record<PageType, string> = {
  dashboard: 'Dashboard',
  notifications: 'Notifications',
  posts: 'Posts & Calendar',
  'post-automation': 'Post Automation',
  cards: 'AI Studio & Cards',
  media: 'Media Library',
  analytics: 'Analytics',
  pricing: 'Plans & Pricing',
  admin: 'Admin Console',
  profile: 'Profile',
  memory: 'Brand Memory',
  integrations: 'Integrations',
  marketing: 'Marketing Overview',
  'marketing-contacts': 'Contacts & Segments',
  'marketing-email': 'Email Campaigns',
  'marketing-campaigns': 'Campaigns & Funnels',
  'marketing-surveys': 'Surveys',
  'marketing-automations': 'Marketing Automations',
  'marketing-forms': 'Lead Forms',
  'marketing-leads': 'Lead Generation',
  'marketing-leads-import': 'Import Leads',
  'sales-leads': 'Sales Leads',
  'sales-conversations': 'Sales Conversations',
  'sales-followups': 'Follow-ups',
  'sales-intelligence': 'Sales Intelligence',
  'sales-settings': 'Sales Settings',
  'crm-companies': 'Companies',
  'crm-pipeline': 'Deals Pipeline',
  'crm-scoring': 'Lead Scoring',
  'gmail-agent': 'Gmail Agent',
  'connector-hub': 'Connector Hub',
  'connector-setup': 'Connector Setup',
  'connector-sync': 'Sync Dashboard',
  workspace: 'Workspace & Team',
  credits: 'AI Credits',
  billing: 'Billing & Subscription',
  tasks: 'Project Tasks',
  'project-settings': 'Project Settings',
  settings: 'Settings & API',
  workflow: 'Workflow Builder',
  discover: 'Discover Library',
  'ai-team': 'Workforce Floor',
  'social-inbox': 'Unified Social Inbox',
};

const PATH_TO_PAGE = new Map<string, PageType>(
  Object.entries(PAGE_PATHS).map(([page, path]) => [path, page as PageType])
);
PATH_TO_PAGE.set('/admin', 'admin');
PATH_TO_PAGE.set('/mailing', 'marketing-email');
PATH_TO_PAGE.set('/campaign', 'marketing-campaigns');

// Sidebar groups
const CONTENT_PAGES: PageType[] = ['posts', 'post-automation', 'media', 'cards', 'workflow', 'analytics'];
const MARKETING_PAGES: PageType[] = [
  'marketing',
  ...CONTENT_PAGES,
  'marketing-contacts',
  'marketing-email',
  'marketing-campaigns',
  'marketing-surveys',
  'marketing-automations',
  'marketing-forms',
  'marketing-leads',
  'marketing-leads-import',
];
const CRM_PAGES: PageType[] = ['crm-companies', 'crm-pipeline', 'crm-scoring', 'gmail-agent'];
const SALES_PAGES: PageType[] = [
  'sales-leads', 'sales-conversations', 'sales-followups', 'sales-intelligence', 'sales-settings',
];
const CONNECTOR_PAGES: PageType[] = ['connector-hub', 'connector-setup', 'connector-sync'];

async function fetchCurrentUser(token: string): Promise<AppUser | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      return null;
    }

    const payload = await safeJson<AuthMeResponse>(response);
    if (!payload) {
      return null;
    }

    if (!payload.success || !payload.user?.id || !payload.user?.email) {
      return null;
    }

    return normalizeUser({
      id: payload.user.id,
      email: payload.user.email,
      name: payload.user.name ?? null,
      username: payload.user.username ?? null,
      phone: payload.user.phone ?? null,
      country: payload.user.country ?? null,
      role: payload.user.role === 'admin' ? 'admin' : 'user',
      avatar: payload.user.avatar ?? null,
      cover: payload.user.cover ?? null,
      // Without these the sidebar read "Free" for every paying customer.
      planName: payload.user.planName ?? null,
      planSource: payload.user.planSource,
    });
  } catch {
    return null;
  }
}

type AppSidebarProps = {
  currentPage: PageType;
  authUser: AppUser | null;
  postsMenuOpen: boolean;
  setPostsMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  marketingMenuOpen: boolean;
  setMarketingMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  crmMenuOpen: boolean;
  setCrmMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  salesMenuOpen: boolean;
  setSalesMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  connectorMenuOpen: boolean;
  setConnectorMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  profileNeedsAttention: boolean;
  navigateToPage: (page: PageType, replace?: boolean) => void;
  handleLogout: () => void;
  onMobileClose?: () => void;
  goTasks: (filter?: string) => void;
  disabledNav: Set<string>;
  onStartSystemTour?: () => void;
};

function AppSidebar({
  currentPage,
  authUser,
  postsMenuOpen,
  setPostsMenuOpen,
  marketingMenuOpen,
  setMarketingMenuOpen,
  crmMenuOpen,
  setCrmMenuOpen,
  salesMenuOpen,
  setSalesMenuOpen,
  connectorMenuOpen,
  setConnectorMenuOpen,
  profileNeedsAttention,
  navigateToPage,
  handleLogout,
  onMobileClose,
  goTasks,
  disabledNav,
  onStartSystemTour,
}: AppSidebarProps) {
  const navOn = (key: string) => authUser?.role === 'admin' || !disabledNav.has(key);
  const { currentOrg, currentProject, projects, refresh } = useWorkspace();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [navSearch, setNavSearch] = useState('');
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [addingProject, setAddingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [workspaceCreating, setWorkspaceCreating] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const newProjectRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!userMenuOpen) return;
    function handle(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setUserMenuOpen(false);
    }
    document.addEventListener('mousedown', handle);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('keydown', handleKey);
    };
  }, [userMenuOpen]);

  useEffect(() => {
    if (addingProject) newProjectRef.current?.focus();
  }, [addingProject]);

  const addProjectContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!addingProject) return;
    function handle(e: MouseEvent) {
      if (addProjectContainerRef.current && !addProjectContainerRef.current.contains(e.target as Node)) {
        setAddingProject(false);
        setNewProjectName('');
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [addingProject]);

  const go = (page: PageType) => {
    navigateToPage(page);
    onMobileClose?.();
    setUserMenuOpen(false);
  };

  const createProject = async () => {
    if (!newProjectName.trim() || !currentOrg) return;
    setCreatingProject(true);
    try {
      const token = localStorage.getItem('auth_token');
      await fetch(`${API_BASE_URL}/api/organizations/${currentOrg.id}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token ?? ''}` },
        body: JSON.stringify({ name: newProjectName.trim(), color: '#2563EB' }),
      });
      await refresh();
      setNewProjectName('');
      setAddingProject(false);
    } finally {
      setCreatingProject(false);
    }
  };

  const createWorkspace = async () => {
    if (!newWorkspaceName.trim()) return;
    setWorkspaceCreating(true);
    try {
      const token = localStorage.getItem('auth_token');
      await fetch(`${API_BASE_URL}/api/organizations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token ?? ''}` },
        body: JSON.stringify({ name: newWorkspaceName.trim() }),
      });
      await refresh();
      setNewWorkspaceName('');
      setCreatingWorkspace(false);
    } finally {
      setWorkspaceCreating(false);
    }
  };

  const toggleProject = (id: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const wsName = currentOrg?.name ?? 'Workspace';
  const projName = currentProject?.name ?? 'Project';
  const wsInitial = wsName[0]?.toUpperCase() || 'D';
  const displayName = currentOrg?.name ?? authUser?.name ?? 'My Workspace';
  const userInitial = displayName.slice(0, 2).toUpperCase();
  const planLabel = authUser?.planName?.trim() || 'Free';
  const isFreePlan = planLabel.toLowerCase() === 'free';

  const q = navSearch.trim().toLowerCase();
  const matches = (label: string) => !q || label.toLowerCase().includes(q);

  const cls = (active: boolean) => `os-nav-link${active ? ' is-active' : ''}`;
  const subCls = (active: boolean) => `os-nav-sublink${active ? ' is-active' : ''}`;

  return (
    <div className="flex h-full flex-col bg-white">
      {/* ── DakyXTech v22 Brand Header ── */}
      <div className="os-brand">
        <div className="min-w-0 flex-1">
          <img src="/brand/lockup-on-light.png" alt="DakyXTech" className="block h-7 w-auto" />
          <span className="truncate">{wsName} · {projName}</span>
        </div>
        {onMobileClose && (
          <button type="button" onClick={onMobileClose} className="os-nav-close">
            Close
          </button>
        )}
      </div>

      {/* ── Quick Page Filter ── */}
      <div className="os-nav-search">
        <input
          aria-label="Find a workspace page"
          placeholder="Find a page"
          value={navSearch}
          onChange={(e) => setNavSearch(e.target.value)}
        />
      </div>

      {/* ── Navigation ── */}
      <nav className="os-navigation flex flex-col" aria-label="Main navigation">
        {/* Workspace Section */}
        <section className="os-nav-section">
          <h2>Workspace</h2>
          {navOn('dashboard') && matches('Dashboard') && (
            <button type="button" data-tour-id="nav-dashboard" onClick={() => go('dashboard')} className={cls(currentPage === 'dashboard')}>
              <BarChart4 size={15} className="shrink-0 opacity-75" />
              <span className="flex-1 text-left">Dashboard</span>
            </button>
          )}
          {navOn('notifications') && matches('Notifications') && (
            <button type="button" onClick={() => go('notifications')} className={cls(currentPage === 'notifications')}>
              <Bell size={15} className="shrink-0 opacity-75" />
              <span className="flex-1 text-left">Notifications</span>
            </button>
          )}
          {navOn('ai-team') && matches('AI Team Workforce') && (
            <button type="button" onClick={() => go('ai-team')} className={cls(currentPage === 'ai-team')}>
              <Bot size={15} className="shrink-0 opacity-75" />
              <span className="flex-1 text-left">AI Team</span>
            </button>
          )}
          {navOn('social-inbox') && matches('Social Inbox Approvals') && (
            <button type="button" onClick={() => go('social-inbox')} className={cls(currentPage === 'social-inbox')}>
              <Megaphone size={15} className="shrink-0 opacity-75" />
              <span className="flex-1 text-left">Social Inbox</span>
            </button>
          )}
        </section>

        {/* ── Projects Section ── */}
        <section className="os-nav-section">
          <div className="flex items-center justify-between px-2.5 pb-1">
            <span className="text-[10.5px] font-medium uppercase tracking-[.14em] text-faint">Projects</span>
            <button
              type="button"
              title="New project"
              onClick={() => setAddingProject((p) => !p)}
              className="rounded-[8px] p-1 text-muted hover:bg-sunken hover:text-ink transition-colors"
            >
              <Plus size={13} />
            </button>
          </div>

          {!currentOrg && (
            <div className="px-1 my-1">
              {creatingWorkspace ? (
                <div className="flex items-center gap-1.5 rounded-[10px] border border-line-2 bg-sunken px-2.5 py-1.5">
                  <input
                    autoFocus
                    value={newWorkspaceName}
                    onChange={(e) => setNewWorkspaceName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void createWorkspace();
                      if (e.key === 'Escape') setCreatingWorkspace(false);
                    }}
                    placeholder="Workspace name…"
                    className="flex-1 bg-transparent text-[12px] text-ink placeholder-faint focus:outline-none"
                  />
                  {workspaceCreating ? (
                    <span className="text-muted text-[10px]">…</span>
                  ) : (
                    <button
                      type="button"
                      onClick={createWorkspace}
                      disabled={!newWorkspaceName.trim()}
                      className="text-[11px] font-medium text-blue hover:text-blue-d disabled:opacity-40"
                    >
                      Create
                    </button>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setCreatingWorkspace(true)}
                  className="w-full rounded-[10px] border border-dashed border-line-2 bg-sunken px-3 py-2 text-[11.5px] font-medium text-muted hover:border-blue hover:text-blue transition-colors"
                >
                  + Create your workspace
                </button>
              )}
            </div>
          )}

          {addingProject && (
            <div ref={addProjectContainerRef} className="px-1 my-1">
              <div className="flex items-center gap-1.5 rounded-[10px] border border-line-2 bg-sunken px-2.5 py-1.5">
                <input
                  ref={newProjectRef}
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void createProject();
                    if (e.key === 'Escape') setAddingProject(false);
                  }}
                  placeholder="Project name…"
                  className="flex-1 bg-transparent text-[12px] text-ink placeholder-faint focus:outline-none"
                />
                {creatingProject ? (
                  <span className="text-muted text-[10px]">…</span>
                ) : (
                  <button
                    type="button"
                    onClick={createProject}
                    disabled={!newProjectName.trim()}
                    className="text-[11px] font-medium text-blue hover:text-blue-d disabled:opacity-40"
                  >
                    Add
                  </button>
                )}
              </div>
            </div>
          )}

          {projects.map((proj) => {
            const isExpanded = expandedProjects.has(proj.id);
            const isCurrent = currentProject?.id === proj.id;
            if (q && !proj.name.toLowerCase().includes(q) && !'general team all tasks'.includes(q)) return null;
            return (
              <div key={proj.id}>
                <button
                  type="button"
                  onClick={() => toggleProject(proj.id)}
                  className={`os-nav-link ${isCurrent ? 'is-active' : ''}`}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: proj.color || '#2563EB' }}
                  />
                  <span className="flex-1 truncate text-left">{proj.name}</span>
                  <ChevronDown size={11} className={`shrink-0 text-faint transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                </button>
                {(isExpanded || Boolean(q)) && (
                  <div className="ml-4 border-l border-line pl-2.5 py-0.5 flex flex-col">
                    <a
                      href={PAGE_PATHS['project-settings']}
                      onClick={(e) => {
                        e.preventDefault();
                        sessionStorage.removeItem('proj_settings_tab');
                        go('project-settings');
                      }}
                      className={subCls(
                        currentPage === 'project-settings' &&
                          typeof window !== 'undefined' &&
                          !window.location.search.includes('tab=team')
                      )}
                    >
                      General
                    </a>
                    <a
                      href={PAGE_PATHS['project-settings']}
                      onClick={(e) => {
                        e.preventDefault();
                        sessionStorage.setItem('proj_settings_tab', 'team');
                        go('project-settings');
                        onMobileClose?.();
                      }}
                      className={subCls(
                        currentPage === 'project-settings' &&
                          typeof window !== 'undefined' &&
                          window.location.search.includes('tab=team')
                      )}
                    >
                      Team
                    </a>
                    <a
                      href={PAGE_PATHS['tasks']}
                      onClick={(e) => {
                        e.preventDefault();
                        goTasks('all');
                        onMobileClose?.();
                      }}
                      className={subCls(currentPage === 'tasks')}
                    >
                      All Tasks
                    </a>
                  </div>
                )}
              </div>
            );
          })}
        </section>

        {/* ── Pipeline & Operations Section ── */}
        <section className="os-nav-section">
          <h2>Operations &amp; Growth</h2>

          {/* CRM */}
          {navOn('crm') && (
            <>
              <div
                className={cls(
                  currentPage === 'crm-companies' ||
                    currentPage === 'crm-pipeline' ||
                    currentPage === 'crm-scoring' ||
                    currentPage === 'gmail-agent'
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    setCrmMenuOpen(true);
                    go('crm-pipeline');
                  }}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                >
                  <Building2 size={15} className="shrink-0 opacity-75" />
                  <span className="flex-1 text-left">CRM</span>
                </button>
                <button
                  type="button"
                  aria-label="Toggle Crm submenu"
                  aria-expanded={crmMenuOpen}
                  onClick={(e) => {
                    e.stopPropagation();
                    setCrmMenuOpen((p) => !p);
                  }}
                  className="shrink-0 -m-1 p-1 rounded-[8px] hover:bg-sunken"
                >
                  <ChevronDown size={12} className={`text-faint transition-transform ${crmMenuOpen || Boolean(q) ? 'rotate-180' : ''}`} />
                </button>
              </div>
              {(crmMenuOpen || Boolean(q)) && (
                <div className="ml-4 border-l border-line pl-2.5 py-0.5 flex flex-col">
                  {(
                    [
                      { id: 'crm-companies' as PageType, label: 'Companies', navKey: 'crm-companies' },
                      { id: 'crm-pipeline' as PageType, label: 'Deals', navKey: 'crm-pipeline' },
                      { id: 'crm-scoring' as PageType, label: 'Lead Scoring', navKey: 'crm-scoring' },
                      { id: 'gmail-agent' as PageType, label: 'Gmail Agent', navKey: 'crm-gmail-agent' },
                    ] as { id: PageType; label: string; navKey: string }[]
                  )
                    .filter((c) => navOn(c.navKey) && matches(`CRM ${c.label}`))
                    .map((c) => (
                      <button key={c.id} type="button" onClick={() => go(c.id)} className={subCls(currentPage === c.id)}>
                        {c.label}
                      </button>
                    ))}
                </div>
              )}
            </>
          )}

          {/* Sales */}
          {navOn('sales') && (
            <>
              <div className={cls(SALES_PAGES.includes(currentPage))}>
                <button
                  type="button"
                  onClick={() => {
                    setSalesMenuOpen(true);
                    go('sales-leads');
                  }}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                >
                  <PhoneCall size={15} className="shrink-0 opacity-75" />
                  <span className="flex-1 text-left">Sales</span>
                </button>
                <button
                  type="button"
                  aria-label="Toggle Sales submenu"
                  aria-expanded={salesMenuOpen}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSalesMenuOpen((p) => !p);
                  }}
                  className="shrink-0 -m-1 p-1 rounded-[8px] hover:bg-sunken"
                >
                  <ChevronDown size={12} className={`text-faint transition-transform ${salesMenuOpen || Boolean(q) ? 'rotate-180' : ''}`} />
                </button>
              </div>
              {(salesMenuOpen || Boolean(q)) && (
                <div className="ml-4 border-l border-line pl-2.5 py-0.5 flex flex-col">
                  {(
                    [
                      { id: 'sales-leads' as PageType, label: 'Leads', navKey: 'sales-leads' },
                      { id: 'sales-conversations' as PageType, label: 'Conversations', navKey: 'sales-conversations' },
                      { id: 'sales-followups' as PageType, label: 'Follow-ups', navKey: 'sales-followups' },
                      { id: 'sales-intelligence' as PageType, label: 'Intelligence', navKey: 'sales-intelligence' },
                      { id: 'sales-settings' as PageType, label: 'Settings', navKey: 'sales-settings' },
                    ] as { id: PageType; label: string; navKey: string }[]
                  )
                    .filter((c) => navOn(c.navKey) && matches(`Sales ${c.label}`))
                    .map((c) => (
                      <button key={c.id} type="button" onClick={() => go(c.id)} className={subCls(currentPage === c.id)}>
                        {c.label}
                      </button>
                    ))}
                </div>
              )}
            </>
          )}

          {/* Marketing */}
          {navOn('marketing') && (
            <>
              <div className={cls(MARKETING_PAGES.includes(currentPage))}>
                <button
                  type="button"
                  onClick={() => {
                    setMarketingMenuOpen(true);
                    go('marketing');
                  }}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                >
                  <Megaphone size={15} className="shrink-0 opacity-75" />
                  <span className="flex-1 text-left">Marketing</span>
                </button>
                <button
                  type="button"
                  aria-label="Toggle Marketing submenu"
                  aria-expanded={marketingMenuOpen}
                  onClick={(e) => {
                    e.stopPropagation();
                    setMarketingMenuOpen((p) => !p);
                  }}
                  className="shrink-0 -m-1 p-1 rounded-[8px] hover:bg-sunken"
                >
                  <ChevronDown size={12} className={`text-faint transition-transform ${marketingMenuOpen || Boolean(q) ? 'rotate-180' : ''}`} />
                </button>
              </div>
              {(marketingMenuOpen || Boolean(q)) && (
                <div className="ml-4 border-l border-line pl-2.5 py-0.5 flex flex-col">
                  {navOn('marketing-overview') && matches('Marketing Overview') && (
                    <button type="button" onClick={() => go('marketing')} className={subCls(currentPage === 'marketing')}>
                      Overview
                    </button>
                  )}

                  {/* Content submenu */}
                  {navOn('content') && (
                    <>
                      <button
                        type="button"
                        data-tour-id="nav-content"
                        onClick={() => {
                          setPostsMenuOpen(true);
                          go('posts');
                        }}
                        className={subCls(CONTENT_PAGES.includes(currentPage))}
                      >
                        <span className="flex-1 text-left">Content</span>
                        <span
                          role="button"
                          aria-label="Toggle submenu"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPostsMenuOpen((p) => !p);
                          }}
                          className="shrink-0 -m-1 p-1 rounded-[8px] hover:bg-sunken"
                        >
                          <ChevronDown size={11} className={`text-faint transition-transform ${postsMenuOpen || Boolean(q) ? 'rotate-180' : ''}`} />
                        </span>
                      </button>
                      {(postsMenuOpen || Boolean(q)) && (
                        <div className="ml-2.5 border-l border-line pl-2.5 flex flex-col">
                          {(
                            [
                              { id: 'posts' as PageType, label: 'Posts', navKey: 'content-posts' },
                              { id: 'post-automation' as PageType, label: 'Automation', navKey: 'content-automation' },
                              { id: 'media' as PageType, label: 'Media', navKey: 'content-media' },
                              { id: 'cards' as PageType, label: 'AI Studio', navKey: 'content-studio' },
                              { id: 'workflow' as PageType, label: 'Workflow', navKey: 'content-workflow' },
                              { id: 'analytics' as PageType, label: 'Analytics', navKey: 'analytics' },
                            ] as { id: PageType; label: string; navKey: string }[]
                          )
                            .filter((c) => navOn(c.navKey) && matches(`Content ${c.label}`))
                            .map((c) => (
                              <button
                                key={c.id}
                                type="button"
                                {...(c.id === 'analytics' ? { 'data-tour-id': 'nav-analytics' } : {})}
                                onClick={() => go(c.id)}
                                className={subCls(currentPage === c.id)}
                              >
                                {c.label}
                              </button>
                            ))}
                        </div>
                      )}
                    </>
                  )}

                  {(
                    [
                      { id: 'marketing-contacts' as PageType, label: 'Contacts', navKey: 'marketing-contacts' },
                      { id: 'marketing-email' as PageType, label: 'Email', navKey: 'marketing-email' },
                      { id: 'marketing-campaigns' as PageType, label: 'Campaigns', navKey: 'marketing-campaigns' },
                      { id: 'marketing-surveys' as PageType, label: 'Surveys', navKey: 'marketing-surveys' },
                      { id: 'marketing-automations' as PageType, label: 'Automations', navKey: 'marketing-automations' },
                      { id: 'marketing-forms' as PageType, label: 'Forms', navKey: 'marketing-forms' },
                      { id: 'marketing-leads' as PageType, label: 'Lead Generation', navKey: 'marketing-leads' },
                      { id: 'marketing-leads-import' as PageType, label: 'Import Leads', navKey: 'marketing-leads-import' },
                    ] as { id: PageType; label: string; navKey: string }[]
                  )
                    .filter((c) => navOn(c.navKey) && matches(`Marketing ${c.label}`))
                    .map((c) => (
                      <button key={c.id} type="button" onClick={() => go(c.id)} className={subCls(currentPage === c.id)}>
                        {c.label}
                      </button>
                    ))}
                </div>
              )}
            </>
          )}

          {navOn('integrations') && matches('Integrations') && (
            <button type="button" data-tour-id="nav-integrations" onClick={() => go('integrations')} className={cls(currentPage === 'integrations')}>
              <Waypoints size={15} className="shrink-0 opacity-75" />
              <span className="flex-1 text-left">Integrations</span>
            </button>
          )}

          {/* Connectors */}
          {navOn('connectors') && (
            <>
              <div
                className={cls(
                  currentPage === 'connector-hub' ||
                    currentPage === 'connector-setup' ||
                    currentPage === 'connector-sync'
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    setConnectorMenuOpen(true);
                    go('connector-hub');
                  }}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                >
                  <Layers size={15} className="shrink-0 opacity-75" />
                  <span className="flex-1 text-left">Connectors</span>
                </button>
                <button
                  type="button"
                  aria-label="Toggle Connector submenu"
                  aria-expanded={connectorMenuOpen}
                  onClick={(e) => {
                    e.stopPropagation();
                    setConnectorMenuOpen((p) => !p);
                  }}
                  className="shrink-0 -m-1 p-1 rounded-[8px] hover:bg-sunken"
                >
                  <ChevronDown size={12} className={`text-faint transition-transform ${connectorMenuOpen || Boolean(q) ? 'rotate-180' : ''}`} />
                </button>
              </div>
              {(connectorMenuOpen || Boolean(q)) && (
                <div className="ml-4 border-l border-line pl-2.5 py-0.5 flex flex-col">
                  {(
                    [
                      { id: 'connector-hub' as PageType, label: 'Hub', navKey: 'connectors-hub' },
                      { id: 'connector-sync' as PageType, label: 'Sync Dashboard', navKey: 'connectors-sync' },
                    ] as { id: PageType; label: string; navKey: string }[]
                  )
                    .filter((c) => navOn(c.navKey) && matches(`Connectors ${c.label}`))
                    .map((c) => (
                      <button key={c.id} type="button" onClick={() => go(c.id)} className={subCls(currentPage === c.id)}>
                        {c.label}
                      </button>
                    ))}
                </div>
              )}
            </>
          )}
        </section>

        {/* ── Account & System Section ── */}
        <section className="os-nav-section">
          <h2>System &amp; Billing</h2>
          {matches('Buy credits') && (
            <button type="button" onClick={() => go('credits')} className={cls(currentPage === 'credits')}>
              <CreditCard size={15} className="shrink-0 opacity-75" />
              <span className="flex-1 text-left">Buy credits</span>
            </button>
          )}
          {navOn('billing') && matches('Billing') && (
            <button type="button" data-tour-id="nav-billing" onClick={() => go('billing')} className={cls(currentPage === 'billing')}>
              <CreditCard size={15} className="shrink-0 opacity-75" />
              <span className="flex-1 text-left">Billing</span>
            </button>
          )}
          {authUser?.role === 'admin' && matches('Admin Console') && (
            <button type="button" data-tour-id="nav-admin" onClick={() => go('admin')} className={cls(currentPage === 'admin')}>
              <Shield size={15} className="shrink-0 opacity-75" />
              <span className="flex-1 text-left">Admin</span>
            </button>
          )}
        </section>
      </nav>

      {/* ── Notifications Row ── */}
      <div className="mx-3 border-t border-line py-2 px-1 flex items-center justify-between">
        <span className="text-[10.5px] font-medium uppercase tracking-[.14em] text-faint">Notifications</span>
        <NotificationBell />
      </div>

      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} onStartTour={onStartSystemTour} />}

      {/* ── DakyXTech v22 Account Bar + Menu ── */}
      <div ref={userMenuRef} className="relative">
        {userMenuOpen && (
          <div
            role="menu"
            className="absolute bottom-full left-3 right-3 mb-1.5 rounded-2xl border border-line bg-white py-1.5 shadow-menu z-50 overflow-hidden"
          >
            <div className="flex items-center gap-2.5 px-3.5 py-2.5">
              {authUser?.avatar ? (
                <img src={authUser.avatar} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
              ) : (
                <div className="os-initials !h-7 !w-7 !text-[11px]">{wsInitial}</div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-medium text-ink truncate">{displayName}</p>
                {authUser?.email ? (
                  <p className="text-[11px] text-faint truncate">{authUser.email}</p>
                ) : (
                  <p className="text-[10px] uppercase tracking-[.12em] text-faint">{planLabel} Plan</p>
                )}
              </div>
              <span className="shrink-0 rounded-[8px] bg-pale px-2 py-0.5 text-[10px] font-medium uppercase tracking-[.1em] text-blue-d">
                {planLabel}
              </span>
            </div>
            <div className="mx-3 h-px bg-line" />
            {isFreePlan ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => go('billing')}
                className="flex w-full items-center gap-2.5 px-3.5 py-2 text-[13px] font-medium text-blue hover:bg-pale transition-colors"
              >
                <Star size={14} className="shrink-0" /> Upgrade
              </button>
            ) : (
              <button
                type="button"
                role="menuitem"
                onClick={() => go('billing')}
                className="flex w-full items-center gap-2.5 px-3.5 py-2 text-[13px] font-normal text-ink hover:bg-sunken transition-colors"
              >
                <CreditCard size={14} className="shrink-0 text-muted" /> Billing
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={() => go('memory')}
              className="flex w-full items-center gap-2.5 px-3.5 py-2 text-[13px] font-normal text-ink hover:bg-sunken transition-colors"
            >
              <Sparkles size={14} className="shrink-0 text-muted" /> Personalization
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => go('profile')}
              className="flex w-full items-center gap-2.5 px-3.5 py-2 text-[13px] font-normal text-ink hover:bg-sunken transition-colors"
            >
              <User size={14} className="shrink-0 text-muted" />
              <span className="flex-1 text-left">Profile</span>
              {profileNeedsAttention && (
                <span className="flex shrink-0 items-center gap-1 text-[10.5px] font-medium text-danger-text">
                  <AlertCircle size={12} /> Incomplete
                </span>
              )}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => go('workspace')}
              className="flex w-full items-center gap-2.5 px-3.5 py-2 text-[13px] font-normal text-ink hover:bg-sunken transition-colors"
            >
              <Building2 size={14} className="shrink-0 text-muted" /> Workspace
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => go('settings')}
              className="flex w-full items-center gap-2.5 px-3.5 py-2 text-[13px] font-normal text-ink hover:bg-sunken transition-colors"
            >
              <Settings size={14} className="shrink-0 text-muted" /> Settings
            </button>
            <div className="mx-3 my-1 h-px bg-line" />
            {onStartSystemTour && (
              <button
                type="button"
                role="menuitem"
                data-tour-id="menu-guided-tour"
                onClick={() => {
                  onStartSystemTour();
                  setUserMenuOpen(false);
                }}
                className="flex w-full items-center gap-2.5 px-3.5 py-2 text-[13px] font-medium text-blue hover:bg-pale transition-colors"
              >
                <Compass size={14} className="shrink-0 text-blue" />
                <span className="flex-1 text-left">Guided Tour</span>
                <span className="rounded-full bg-blue/10 px-1.5 py-0.5 text-[10px] font-semibold text-blue">Tour</span>
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                window.open('/changelog', '_blank', 'noopener');
                setUserMenuOpen(false);
              }}
              className="flex w-full items-center gap-2.5 px-3.5 py-2 text-[13px] font-normal text-ink hover:bg-sunken transition-colors"
            >
              <Rocket size={14} className="shrink-0 text-muted" /> What&apos;s new
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setHelpOpen(true);
                setUserMenuOpen(false);
              }}
              className="flex w-full items-center gap-2.5 px-3.5 py-2 text-[13px] font-normal text-ink hover:bg-sunken transition-colors"
            >
              <HelpCircle size={14} className="shrink-0 text-muted" /> Help
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                handleLogout();
                setUserMenuOpen(false);
              }}
              className="flex w-full items-center gap-2.5 px-3.5 py-2 text-[13px] font-medium text-danger-text hover:bg-danger-surface transition-colors"
            >
              <LogOut size={14} className="shrink-0" /> Log out
            </button>
          </div>
        )}
        <div className="os-account">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={userMenuOpen}
            onClick={() => setUserMenuOpen((v) => !v)}
            className="flex w-full items-center gap-2.5 rounded-[10px] px-1.5 py-1 hover:bg-sunken transition-colors text-left"
          >
            <div className="relative shrink-0">
              {authUser?.avatar ? (
                <img src={authUser.avatar} alt="" className="h-[34px] w-[34px] rounded-full object-cover" />
              ) : (
                <div className="os-initials">{userInitial}</div>
              )}
              {profileNeedsAttention && (
                <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-danger ring-2 ring-white" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <strong>{displayName}</strong>
              <span>{planLabel} Plan</span>
            </div>
            <ChevronDown size={13} className={`shrink-0 text-faint transition-transform duration-200 ${userMenuOpen ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>
    </div>
  );
}

function App() {
  const { addToast } = useToast();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authUser, setAuthUser] = useState<AppUser | null>(() => getStoredUser());
  const [currentPage, setCurrentPage] = useState<PageType>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [currentPathname, setCurrentPathname] = useState(() => (typeof window !== 'undefined' ? window.location.pathname : '/'));
  const [postsMenuOpen, setPostsMenuOpen] = useState(false);
  const [marketingMenuOpen, setMarketingMenuOpen] = useState(false);
  const [crmMenuOpen, setCrmMenuOpen] = useState(false);
  const [salesMenuOpen, setSalesMenuOpen] = useState(false);
  const [connectorMenuOpen, setConnectorMenuOpen] = useState(false);
  const [disabledNav, setDisabledNav] = useState<Set<string>>(new Set());
  const [connectorSetupDomain, setConnectorSetupDomain] = useState<any>(null);
  const [currentTaskFilter, setCurrentTaskFilter] = useState('all');
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [pendingTour, setPendingTour] = useState(false);
  const [systemTourOpen, setSystemTourOpen] = useState(false);
  const [customTourSteps, setCustomTourSteps] = useState<GuidedTourStep[] | null>(null);
  const [customTourTitle, setCustomTourTitle] = useState('System Tour');

  const startSystemTour = useCallback(() => {
    setCustomTourSteps(null);
    setCustomTourTitle('System Tour');
    setSystemTourOpen(true);
  }, []);

  const startPageTour = useCallback((steps: GuidedTourStep[], title: string) => {
    setCustomTourSteps(steps);
    setCustomTourTitle(title);
    setSystemTourOpen(true);
  }, []);

  useEffect(() => {
    const handleStartTour = () => startSystemTour();
    window.addEventListener('start-system-tour', handleStartTour);
    return () => window.removeEventListener('start-system-tour', handleStartTour);
  }, [startSystemTour]);
  const [quotaModalPayload, setQuotaModalPayload] = useState<QuotaExceededPayload | null>(null);

  const goTasks = useCallback((filter = 'all') => {
    setCurrentTaskFilter(filter);
    setCurrentPage('tasks');
    const path = '/tasks';
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path);
      setCurrentPathname(path);
    }
  }, []);

  useEffect(() => {
    const resetFlag = 'force_auth_reset_v8';
    if (localStorage.getItem(resetFlag) === '1') {
      return;
    }

    localStorage.removeItem('auth_session');
    localStorage.removeItem('auth_token');
    localStorage.removeItem('workspace_state');
    localStorage.removeItem('dw_onboarded');
    clearStoredUser();
    localStorage.setItem(resetFlag, '1');
  }, []);

  const getPageFromPath = useCallback((pathname: string): PageType | null => {
    if (PATH_TO_PAGE.has(pathname)) return PATH_TO_PAGE.get(pathname)!;
    if (pathname.startsWith('/admin')) return 'admin';
    return null;
  }, []);

  const navigatePath = useCallback((path: string, replace = false) => {
    if (replace) {
      window.history.replaceState({}, document.title, path);
      setCurrentPathname(path);
      return;
    }
    window.history.pushState({}, document.title, path);
    setCurrentPathname(path);
  }, []);

  const navigateToPage = useCallback(
    (page: PageType, replace = false) => {
      setCurrentPage(page);
      if (CONTENT_PAGES.includes(page)) {
        setPostsMenuOpen(true);
      }
      if (MARKETING_PAGES.includes(page)) {
        setMarketingMenuOpen(true);
      }
      if (CRM_PAGES.includes(page)) {
        setCrmMenuOpen(true);
      }
      if (SALES_PAGES.includes(page)) {
        setSalesMenuOpen(true);
      }
      if (CONNECTOR_PAGES.includes(page)) {
        setConnectorMenuOpen(true);
      }
      const path = PAGE_PATHS[page];
      if (window.location.pathname !== path || window.location.search) {
        navigatePath(path, replace);
      }
    },
    [navigatePath]
  );

  const getDefaultPageForUser = useCallback(
    (user: AppUser | null): PageType => (user?.role === 'admin' ? 'admin' : 'dashboard'),
    [],
  );

  // Global 401 & 402 handler
  useEffect(() => {
    if (!isAuthenticated) return;

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const url = typeof args[0] === 'string' ? args[0] : args[0] instanceof URL ? args[0].href : '';
      if (url.includes('/api/')) {
        const token = localStorage.getItem('auth_token');
        if (token) {
          const init = (args[1] ? { ...args[1] } : {}) as RequestInit;
          const headers = new Headers(init.headers || {});
          if (!headers.has('Authorization')) {
            headers.set('Authorization', `Bearer ${token}`);
          }
          try {
            const wsRaw = localStorage.getItem(`workspace_state:${getStoredUser()?.id || 'anonymous'}`);
            if (wsRaw) {
              const ws = JSON.parse(wsRaw);
              if (ws?.orgId && !headers.has('X-Organization-Id')) headers.set('X-Organization-Id', String(ws.orgId));
              if (ws?.projectId && !headers.has('X-Project-Id')) headers.set('X-Project-Id', String(ws.projectId));
            }
          } catch { /* ignore malformed workspace state */ }
          if (false) {
          }
          init.headers = headers;
          args[1] = init;
        }
      }
      const response = await originalFetch(...args);
      if (response.status === 401) {
        if (url.includes('/api/') && !url.includes('/api/auth/') && !url.includes('/api/media')) {
          localStorage.removeItem('auth_session');
          localStorage.removeItem('auth_token');
          clearStoredUser();
          setAuthUser(null);
          setIsAuthenticated(false);
          addToast('error', 'Your session has expired. Please log in again.');
          navigatePath('/login', true);
        }
      } else if (response.status === 402 && url.includes('/api/')) {
        response.clone().json().then((body) => {
          setQuotaModalPayload({
            error: body?.error || 'You have reached the limit for your current subscription plan.',
            resource: body?.resource,
            currentCount: body?.currentCount,
            limit: body?.limit,
            currentPlan: body?.currentPlan,
          });
        }).catch(() => undefined);
      }
      return response;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, [isAuthenticated, navigatePath]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const token = localStorage.getItem('auth_token') ?? '';
    fetch(`${API_BASE_URL}/api/platform/nav-settings`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : { disabled: [] })
      .then(d => setDisabledNav(new Set(d.disabled ?? [])))
      .catch(() => {});
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || showOnboarding) return;
    if (localStorage.getItem('dw_onboarded')) return;
    let canceled = false;
    onboardingService.status()
      .then((s) => {
        if (canceled) return;
        if (s.completed || s.skipped) { localStorage.setItem('dw_onboarded', '1'); return; }
        setShowOnboarding(true);
      })
      .catch(() => undefined);
    return () => { canceled = true; };
  }, [isAuthenticated, showOnboarding]);

  useEffect(() => {
    let canceled = false;

    const pathname = window.location.pathname;
    if (pathname.startsWith('/auth/')) {
      setCurrentPathname(pathname);
      return () => {
        canceled = true;
      };
    }
    const hasSession = Boolean(localStorage.getItem('auth_session'));
    const token = localStorage.getItem('auth_token');
    if (hasSession && !token) {
      localStorage.removeItem('auth_session');
      clearStoredUser();
    }
    const loggedIn = Boolean(token);
    setIsAuthenticated(loggedIn);

    if (loggedIn) {
      const storedUser = getStoredUser();
      setAuthUser(storedUser);

      if (token) {
        void fetchCurrentUser(token).then((user) => {
          if (canceled) {
            return;
          }

          if (!user) {
            localStorage.removeItem('auth_session');
            localStorage.removeItem('auth_token');
            clearStoredUser();
            setAuthUser(null);
            setIsAuthenticated(false);
            if (window.location.pathname !== '/login') {
              navigatePath('/login', true);
            }
            return;
          }

          const persisted = setStoredUser(user);
          setAuthUser(persisted);
        });
      }
    } else {
      clearStoredUser();
      setAuthUser(null);
    }

    if (!loggedIn) {
      const publicPaths = ['/', '/privacy', '/terms', '/refund', '/login', '/tools', '/pricing', '/changelog', '/data-deletion', '/reset-password', '/verify-email'];
      if (!publicPaths.includes(pathname) && !pathname.startsWith('/invite/') && !pathname.startsWith('/review/') && !pathname.startsWith('/survey/')) {
        navigatePath('/login', true);
      }
      return () => {
        canceled = true;
      };
    }

    const pageFromPath = getPageFromPath(pathname);
    if (pageFromPath) {
      setCurrentPage(pageFromPath);
      if (CONTENT_PAGES.includes(pageFromPath)) setPostsMenuOpen(true);
      if (MARKETING_PAGES.includes(pageFromPath)) setMarketingMenuOpen(true);
      if (CRM_PAGES.includes(pageFromPath)) setCrmMenuOpen(true);
      if (SALES_PAGES.includes(pageFromPath)) setSalesMenuOpen(true);
      if (CONNECTOR_PAGES.includes(pageFromPath)) setConnectorMenuOpen(true);
      return () => {
        canceled = true;
      };
    }

    navigateToPage(getDefaultPageForUser(getStoredUser()), true);
    return () => {
      canceled = true;
    };
  }, [getDefaultPageForUser, getPageFromPath, navigatePath, navigateToPage]);

  useEffect(() => {
    const handlePopState = () => {
      const pathname = window.location.pathname;
      setCurrentPathname(pathname);
      if (pathname.startsWith('/auth/')) {
        return;
      }

      if (!isAuthenticated) {
        const publicPaths = ['/', '/privacy', '/terms', '/refund', '/login', '/tools', '/pricing', '/changelog', '/data-deletion', '/reset-password', '/verify-email'];
        if (!publicPaths.includes(pathname) && !pathname.startsWith('/invite/') && !pathname.startsWith('/review/') && !pathname.startsWith('/survey/')) {
          navigatePath('/login', true);
          setCurrentPathname('/login');
        }
        return;
      }

      const pageFromPath = getPageFromPath(pathname);
      if (pageFromPath) {
        setCurrentPage(pageFromPath);
        if (CONTENT_PAGES.includes(pageFromPath)) setPostsMenuOpen(true);
        if (MARKETING_PAGES.includes(pageFromPath)) setMarketingMenuOpen(true);
        if (CRM_PAGES.includes(pageFromPath)) setCrmMenuOpen(true);
        if (SALES_PAGES.includes(pageFromPath)) setSalesMenuOpen(true);
        if (CONNECTOR_PAGES.includes(pageFromPath)) setConnectorMenuOpen(true);
        return;
      }

      navigateToPage(getDefaultPageForUser(getStoredUser()), true);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [getDefaultPageForUser, getPageFromPath, isAuthenticated, navigatePath, navigateToPage]);

  const handleLogin = (user: AppUser) => {
    localStorage.setItem('auth_session', 'true');
    setIsAuthenticated(true);
    const storedUser = setStoredUser(user);
    setAuthUser(storedUser);
    window.dispatchEvent(new Event('auth-changed'));
    navigateToPage(getDefaultPageForUser(storedUser), true);
  };

  const handleLogout = () => {
    localStorage.removeItem('auth_session');
    localStorage.removeItem('auth_token');
    localStorage.removeItem('workspace_state');
    localStorage.removeItem('dw_onboarded');
    clearStoredUser();
    setAuthUser(null);
    setIsAuthenticated(false);
    window.dispatchEvent(new Event('auth-changed'));
    navigatePath('/login', true);
  };

  const handleUserUpdated = (user: AppUser) => {
    const storedUser = setStoredUser(user);
    setAuthUser(storedUser);
  };

  const goToLogin = () => { navigatePath('/login', true); setCurrentPathname('/login'); };

  // Public pages — always accessible regardless of auth state
  if (currentPathname === '/privacy') return <Suspense fallback={<PageFallback />}><PrivacyPolicy /></Suspense>;
  if (currentPathname === '/terms') return <Suspense fallback={<PageFallback />}><TermsOfService /></Suspense>;
  if (currentPathname === '/refund') return <Suspense fallback={<PageFallback />}><RefundPolicy /></Suspense>;
  if (currentPathname === '/tools') return <Suspense fallback={<PageFallback />}><Tools onLoginClick={goToLogin} /></Suspense>;
  if (currentPathname === '/changelog') return <Suspense fallback={<PageFallback />}><Changelog /></Suspense>;
  if (currentPathname === '/data-deletion') return <Suspense fallback={<PageFallback />}><DataDeletion /></Suspense>;
  if (currentPathname.startsWith('/auth/')) return <Suspense fallback={<PageFallback />}><OAuthCallback /></Suspense>;
  if (currentPathname === '/reset-password') return <Suspense fallback={<PageFallback />}><ResetPassword /></Suspense>;
  if (currentPathname === '/verify-email') return <Suspense fallback={<PageFallback />}><VerifyEmail /></Suspense>;
  if (currentPathname.startsWith('/invite/')) {
    const token = currentPathname.replace('/invite/', '');
    return <Suspense fallback={<PageFallback />}><AcceptInvite token={token} onLoginClick={goToLogin} /></Suspense>;
  }
  if (currentPathname === '/pricing' && !isAuthenticated) return <Suspense fallback={<PageFallback />}><PublicPricing onLoginClick={goToLogin} /></Suspense>;
  if (currentPathname.startsWith('/survey/')) {
    const surveyId = currentPathname.replace('/survey/', '');
    return <Suspense fallback={<PageFallback />}><PublicSurvey surveyId={surveyId} /></Suspense>;
  }
  if (currentPathname.startsWith('/review/')) {
    const reviewToken = currentPathname.replace('/review/', '');
    return <Suspense fallback={<PageFallback />}><ClientReviewPortal token={reviewToken} /></Suspense>;
  }
  if ((currentPathname === '/' || currentPathname === '') && !isAuthenticated) {
    return <Suspense fallback={<PageFallback />}><Landing onLoginClick={goToLogin} /></Suspense>;
  }

  if (!isAuthenticated) {
    return <Suspense fallback={<PageFallback />}><Auth onLogin={handleLogin} /></Suspense>;
  }

  if (isAuthenticated && currentPage === 'admin' && authUser?.role !== 'admin') {
    navigateToPage('dashboard', true);
    return <Suspense fallback={<PageFallback />}><Dashboard currentUser={authUser} /></Suspense>;
  }

  if (isAuthenticated && currentPage === 'admin') {
    return (
      <TemplateEditorProvider>
        <Suspense fallback={<PageFallback />}><Admin currentUser={authUser} /></Suspense>
        <AdvancedTemplateCardModal />
        {/* System & Interactive Guided Tour */}
        <GuidedTour
          isOpen={systemTourOpen}
          steps={customTourSteps || SYSTEM_TOUR_STEPS}
          tourTitle={customTourTitle || 'System Tour'}
          onClose={() => setSystemTourOpen(false)}
          onComplete={() => setSystemTourOpen(false)}
          currentPage={currentPage}
          onNavigate={(p) => navigateToPage(p as PageType)}
        />
      </TemplateEditorProvider>
    );
  }

  const profileNeedsAttention = !isProfileComplete(authUser);

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard': return <Dashboard currentUser={authUser} />;
      case 'posts': return <Posts currentUser={authUser} />;
      case 'post-automation': return <PostAutomation />;
      case 'cards': return <Cards />;
      case 'pricing': return <Pricing />;
      case 'admin': return <Admin currentUser={authUser} />;
      case 'analytics': return <Analytics />;
      case 'profile': return <Profile currentUser={authUser} onUserUpdated={handleUserUpdated} />;
      case 'media': return <Media />;
      case 'integrations': return <Integrations />;
      case 'marketing': return <MarketingOverview navigateToPage={navigateToPage} />;
      case 'marketing-contacts': return <MarketingContacts />;
      case 'marketing-email': return <MarketingEmail />;
      case 'marketing-campaigns': return <MarketingCampaigns />;
      case 'marketing-surveys': return <MarketingSurveys />;
      case 'marketing-automations': return <MarketingAutomations />;
      case 'marketing-forms': return <MarketingForms />;
      case 'marketing-leads': return <MarketingLeads navigateToPage={navigateToPage} />;
      case 'marketing-leads-import': return <MarketingLeadsImport navigateToPage={navigateToPage} />;
      case 'sales-leads': return <SalesLeads />;
      case 'sales-conversations': return <SalesConversations />;
      case 'sales-followups': return <SalesFollowUps />;
      case 'sales-intelligence': return <SalesIntelligence />;
      case 'sales-settings': return <SalesSettings />;
      case 'crm-companies': return <CRMCompanies />;
      case 'crm-pipeline': return <CRMPipeline />;
      case 'crm-scoring': return <CRMLeadScoring />;
      case 'gmail-agent': return <GmailAgent />;
      case 'connector-hub': return (
        <ConnectorHub
          onNavigateToSetup={(domain) => { setConnectorSetupDomain(domain); navigateToPage('connector-setup'); }}
          onNavigateToSync={() => navigateToPage('connector-sync')}
        />
      );
      case 'connector-setup': return connectorSetupDomain ? (
        <ConnectorProviderSetup
          domain={connectorSetupDomain}
          onBack={() => navigateToPage('connector-hub')}
        />
      ) : <ConnectorHub onNavigateToSetup={(d) => { setConnectorSetupDomain(d); navigateToPage('connector-setup'); }} onNavigateToSync={() => navigateToPage('connector-sync')} />;
      case 'connector-sync': return <ConnectorSyncDashboard onBack={() => navigateToPage('connector-hub')} />;
      case 'workspace': return <Workspace />;
      case 'credits': return <Credits />;
      case 'billing': return <Billing />;
      case 'memory': return <Memory />;
      case 'notifications': return <Notifications />;
      case 'tasks': return <TasksPage initialFilter={currentTaskFilter} />;
      case 'project-settings': return <ProjectSettings />;
      case 'settings': return <SettingsPage currentUser={authUser} onUserUpdated={handleUserUpdated} onNavigateToBilling={() => navigateToPage('billing')} />;
      case 'workflow': return <WorkflowPage />;
      case 'discover': return <Discover />;
      case 'ai-team': return <AITeam />;
      case 'social-inbox': return <SocialInbox />;
      default: return <Dashboard currentUser={authUser} />;
    }
  };

  const sidebarProps: AppSidebarProps = {
    currentPage,
    authUser,
    postsMenuOpen,
    setPostsMenuOpen,
    marketingMenuOpen,
    setMarketingMenuOpen,
    crmMenuOpen,
    setCrmMenuOpen,
    salesMenuOpen,
    setSalesMenuOpen,
    connectorMenuOpen,
    setConnectorMenuOpen,
    profileNeedsAttention,
    navigateToPage,
    handleLogout,
    goTasks,
    disabledNav,
    onStartSystemTour: startSystemTour,
  };

  const guide = PAGE_GUIDES[currentPage];
  const screenName = PAGE_TITLES[currentPage] ?? 'Dashboard';

  return (
    <WorkspaceProvider>
      <TemplateEditorProvider>
        <div className="os-app os-shell">
          <a href="#workspace" className="os-skip">Skip to content</a>

          {/* Desktop floating white sidebar panel */}
          <aside className="os-sidebar">
            <AppSidebar {...sidebarProps} />
          </aside>

          {/* Mobile navigation layer */}
          {sidebarOpen && (
            <div className="os-mobile-layer">
              <div
                className="os-backdrop"
                onClick={() => setSidebarOpen(false)}
                aria-hidden
              />
              <aside className="os-mobile-nav" role="dialog" aria-modal="true" aria-label="Navigation">
                <AppSidebar {...sidebarProps} onMobileClose={() => setSidebarOpen(false)} />
              </aside>
            </div>
          )}

          {/* Main viewport column: floating topbar + floating page panel */}
          <div className="os-viewport">
            <header className="os-topbar">
              <div className="flex min-w-0 items-center gap-3.5">
                <button
                  type="button"
                  className="os-menu-button"
                  aria-expanded={sidebarOpen}
                  onClick={() => setSidebarOpen((p) => !p)}
                >
                  Menu
                </button>
                <img src="/brand/lockup-on-light.png" alt="DakyXTech" className="h-5 w-auto lg:hidden" />
                <img src="/brand/mark-on-light-96.png" alt="DakyXTech" className="hidden lg:block h-5 w-5 rounded-[5px]" />
                <span className="os-workspace-label">Workspace</span>
                <span className="os-breadcrumb-divider">/</span>
                <span className="truncate font-medium text-ink">{screenName}</span>
              </div>

              <div className="flex items-center gap-4">
                {currentPage !== 'dashboard' && (
                  <button
                    type="button"
                    className="os-text-link hidden sm:inline"
                    onClick={() => navigateToPage('dashboard')}
                  >
                    Overview
                  </button>
                )}
                <NotificationBell />
                <span className="os-topbar-date">
                  {new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date())}
                </span>
              </div>
            </header>

            <div className="os-page">
              <main id="workspace" tabIndex={-1} className="os-workspace">
                <ErrorBoundary>
                  <Suspense fallback={<PageFallback />}>{renderPage()}</Suspense>
                </ErrorBoundary>
              </main>
              <footer className="os-workspace-footer">
                <span className="inline-flex items-center gap-2">
                  <img src="/brand/lockup-on-light.png" alt="DakyXTech" className="h-4 w-auto opacity-85" />
                  <span>Marketing OS</span>
                </span>
                <span>Built for considered work.</span>
              </footer>
            </div>
          </div>
        </div>

        <AdvancedTemplateCardModal />
        <ChatWidget />
        <QuotaUpgradeModal
          payload={quotaModalPayload}
          onClose={() => setQuotaModalPayload(null)}
          onNavigateToPricing={() => navigateToPage('pricing')}
          onNavigateToBilling={() => navigateToPage('credits')}
        />

        {/* Per-page quick guide */}
        {guide && (
          <PageTour
            key={currentPage}
            steps={guide.steps}
            pageTitle={guide.title}
            forceStart={pendingTour}
            onForceStartConsumed={() => setPendingTour(false)}
            onStartInteractiveTour={() => startPageTour(guide.steps as any, guide.title)}
            onStartSystemTour={startSystemTour}
          />
        )}

        {/* First-time onboarding wizard */}
        {showOnboarding && (
          <OnboardingWizard
            user={authUser}
            onNavigate={(page) => navigateToPage(page as any)}
            onComplete={() => { setShowOnboarding(false); startSystemTour(); }}
            onDismiss={() => setShowOnboarding(false)}
          />
        )}
        {/* System & Interactive Guided Tour */}
        <GuidedTour
          isOpen={systemTourOpen}
          steps={customTourSteps || SYSTEM_TOUR_STEPS}
          tourTitle={customTourTitle || 'System Tour'}
          onClose={() => setSystemTourOpen(false)}
          onComplete={() => setSystemTourOpen(false)}
          currentPage={currentPage}
          onNavigate={(p) => navigateToPage(p as PageType)}
        />
      </TemplateEditorProvider>
    </WorkspaceProvider>
  );
}

function AppWithToast() {
  const toastState = useToastState();
  return (
    <ToastContext.Provider value={toastState}>
      <App />
      <ToastContainer />
    </ToastContext.Provider>
  );
}

export default AppWithToast;
