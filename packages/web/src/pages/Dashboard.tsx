import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Bell,
  Calendar,
  CheckCircle2,
  FileText,
  ImageIcon,
  Link2,
  Loader2,
  Palette,
  Plus,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { blogService, type BlogPost } from '../services/blogService';
import { socialPostService, type SocialAccount } from '../services/socialPostService';
import { designService, type UserDesign } from '../services/designService';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { API_BASE_URL } from '../utils/apiBase';
import type { AppUser } from '../utils/userSession';
import { Badge, Button, EmptyState, Loading, Notice, PageHeader } from '../components/ui';

type DashboardProps = {
  currentUser: AppUser | null;
};

function tok() {
  return localStorage.getItem('auth_token') ?? '';
}

function formatDate(value?: string | null) {
  if (!value) return 'N/A';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return 'N/A';
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function relativeDate(value?: string | null) {
  if (!value) return '';
  const dt = new Date(value);
  const now = new Date();
  const diff = Math.floor((now.getTime() - dt.getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return formatDate(value);
}

// ── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const toneMap: Record<string, 'positive' | 'info' | 'warn' | 'muted'> = {
    published: 'positive',
    done: 'positive',
    scheduled: 'info',
    in_review: 'info',
    in_progress: 'warn',
    draft: 'muted',
    todo: 'muted',
  };
  return (
    <Badge tone={toneMap[status] ?? 'muted'}>
      {status.replace('_', ' ')}
    </Badge>
  );
}

// ── Agent Activity Feed ───────────────────────────────────────────────────────

type AgentActivity = {
  id: string;
  agent_key: string;
  agent_name: string;
  activity_type: string;
  title: string;
  content: string;
  is_read: boolean;
  created_at: string;
};

const AGENT_ICONS: Record<string, string> = {
  daky: '✦',
  nova: '◉',
  sage: '◈',
  aria: '⊕',
  flux: '⟳',
};

function AgentActivityFeed() {
  const [activities, setActivities] = useState<AgentActivity[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/agent-activity`, {
      headers: { Authorization: `Bearer ${tok()}` },
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.success) {
          setActivities(d.activities);
          setUnread(d.unread ?? 0);
        }
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  const markRead = (id: string) => {
    fetch(`${API_BASE_URL}/api/agent-activity/${id}/read`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tok()}` },
    }).catch(() => undefined);
    setActivities((prev) => prev.map((a) => (a.id === id ? { ...a, is_read: true } : a)));
    setUnread((n) => Math.max(0, n - 1));
  };

  const dismiss = (id: string) => {
    fetch(`${API_BASE_URL}/api/agent-activity/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tok()}` },
    }).catch(() => undefined);
    setActivities((prev) => prev.filter((a) => a.id !== id));
  };

  return (
    <section data-tour-id="dashboard-agent-activity" className="os-panel">
      <header className="os-panel-heading">
        <div>
          <span className="os-caption">Workforce</span>
          <h2 className="flex items-center gap-2">
            Team activity
            {unread > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-blue px-1.5 font-mono text-[10.5px] font-medium text-white">
                {unread}
              </span>
            )}
          </h2>
        </div>
        <Bell size={15} className="text-faint" />
      </header>

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-xs text-muted">
          <Loader2 size={13} className="animate-spin text-blue" /> Loading…
        </div>
      ) : activities.length === 0 ? (
        <EmptyState message="No agent activity yet. Your AI team will surface insights here automatically." />
      ) : (
        <ul className="divide-y divide-line">
          {activities.slice(0, 5).map((a) => {
            const icon = AGENT_ICONS[a.agent_key] || '✦';
            return (
              <li
                key={a.id}
                onClick={() => !a.is_read && markRead(a.id)}
                className={`group relative flex items-start gap-3 py-3 px-2 rounded-[10px] transition-colors cursor-default ${
                  a.is_read ? 'hover:bg-soft' : 'bg-pale/40 hover:bg-pale/70'
                }`}
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border border-line bg-white text-xs font-mono text-blue mt-0.5">
                  {icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-ink leading-snug">{a.title}</p>
                  <p className="text-[11.5px] text-muted leading-snug line-clamp-2 mt-0.5">{a.content}</p>
                  <p className="font-mono text-[10.5px] text-faint mt-1">
                    {a.agent_name} · {relativeDate(a.created_at)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    dismiss(a.id);
                  }}
                  className="shrink-0 opacity-0 group-hover:opacity-100 flex h-6 w-6 items-center justify-center rounded-[8px] text-faint hover:bg-soft hover:text-ink transition-all"
                  aria-label="Dismiss activity"
                >
                  <X size={12} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ── Custom tooltip for chart ──────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-[10px] border border-line bg-white px-3 py-2 shadow-menu text-xs">
      <p className="font-medium text-ink">{label}</p>
      <p className="font-mono text-blue">{payload[0]?.value} posts</p>
    </div>
  );
}

// ── Onboarding Checklist ─────────────────────────────────────────────────────

function OnboardingChecklist({
  hasBrief,
  hasAccounts,
  hasPosts,
  hasDesigns,
  hasEmails,
  userId,
}: {
  hasBrief: boolean;
  hasAccounts: boolean;
  hasPosts: boolean;
  hasDesigns: boolean;
  hasEmails: boolean;
  userId?: string | null;
}) {
  const storageKey = `onboarding_dismissed_${userId ?? 'anon'}`;
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(storageKey) === '1');

  const steps = [
    { label: 'Brief your AI team about your brand', done: hasBrief, href: '/memory', icon: Sparkles },
    { label: 'Connect a social platform', done: hasAccounts, href: '/integrations', icon: Link2 },
    { label: 'Create your first post', done: hasPosts, href: '/posts', icon: FileText },
    { label: 'Design a card in Visual Studio', done: hasDesigns, href: '/cards', icon: Palette },
    { label: 'Send a marketing email', done: hasEmails, href: '/marketing/email', icon: Bell },
  ];
  const completed = steps.filter((s) => s.done).length;
  const allDone = completed === steps.length;

  if (dismissed) return null;

  const dismiss = () => {
    localStorage.setItem(storageKey, '1');
    setDismissed(true);
  };

  const navigate = (path: string) => {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  return (
    <section className="os-panel mb-6">
      <header className="os-panel-heading">
        <div>
          <span className="os-caption">Getting started</span>
          <h2>
            {allDone ? 'Workspace setup complete' : `Setup checklist (${completed}/${steps.length})`}
          </h2>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="rounded-[8px] p-1.5 text-faint hover:bg-soft hover:text-ink transition-colors"
          aria-label="Dismiss checklist"
        >
          <X size={14} />
        </button>
      </header>

      {!allDone && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-muted">Complete these steps to unlock the full workflow</span>
            <span className="font-mono text-xs text-ink">
              {Math.round((completed / steps.length) * 100)}%
            </span>
          </div>
          <div className="os-bar-track">
            <div style={{ width: `${(completed / steps.length) * 100}%` }} />
          </div>
        </div>
      )}

      <ul className="divide-y divide-line border-t border-line">
        {steps.map((step) => (
          <li key={step.label}>
            <button
              type="button"
              disabled={step.done}
              onClick={() => navigate(step.href)}
              className={`flex w-full items-center gap-3 py-3 px-2 text-left transition-colors ${
                step.done ? 'opacity-60 cursor-default' : 'hover:bg-soft cursor-pointer'
              }`}
            >
              <div
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-all ${
                  step.done ? 'border-positive bg-positive text-white' : 'border-line-strong bg-white'
                }`}
              >
                {step.done && <CheckCircle2 size={12} />}
              </div>
              <span
                className={`flex-1 text-sm ${
                  step.done ? 'line-through text-faint' : 'font-medium text-ink'
                }`}
              >
                {step.label}
              </span>
              {!step.done && <ArrowRight size={13} className="shrink-0 text-blue" />}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

export default function Dashboard({ currentUser }: DashboardProps) {
  const { currentProject } = useWorkspace();
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [designs, setDesigns] = useState<UserDesign[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [emailsSent, setEmailsSent] = useState(false);
  const [hasBrief, setHasBrief] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    const fetchAll = async () => {
      const [postData, accountData, designData] = await Promise.all([
        blogService.listPosts(),
        socialPostService.listAccounts(),
        designService.list().catch(() => [] as UserDesign[]),
      ]);
      if (!active) return;
      setPosts(postData);
      setAccounts(accountData);
      setDesigns(designData);
      fetch(`${API_BASE_URL}/api/mailing/analytics`, {
        headers: { Authorization: `Bearer ${tok()}` },
      })
        .then((r) => r.json())
        .then((d) => {
          if (active && d?.campaigns?.sent > 0) setEmailsSent(true);
        })
        .catch(() => undefined);
      fetch(`${API_BASE_URL}/api/memory`, {
        headers: { Authorization: `Bearer ${tok()}` },
      })
        .then((r) => r.json())
        .then((d) => {
          if (active && (d?.memories?.length ?? 0) > 0) setHasBrief(true);
        })
        .catch(() => undefined);
    };

    fetchAll()
      .catch((e) => {
        if (!active) return;
        setError(e instanceof Error ? e.message : 'Failed to load dashboard data');
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!currentProject?.id) return;
    fetch(`${API_BASE_URL}/api/projects/${currentProject.id}/tasks`, {
      headers: { Authorization: `Bearer ${tok()}` },
    })
      .then((r) => r.json())
      .then((d) => setTasks(d.tasks ?? []))
      .catch(() => undefined);
  }, [currentProject?.id]);

  const greetingName =
    currentUser?.name?.trim() ||
    currentUser?.username?.trim() ||
    currentUser?.email.split('@')[0] ||
    'there';
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const dateStr = now.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const publishedPosts = useMemo(() => posts.filter((p) => p.status === 'published'), [posts]);
  const scheduledPosts = useMemo(() => posts.filter((p) => p.status === 'scheduled'), [posts]);
  const draftPosts = useMemo(() => posts.filter((p) => p.status === 'draft'), [posts]);
  const recentPosts = useMemo(
    () =>
      [...posts]
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        .slice(0, 6),
    [posts]
  );

  const tasksDone = useMemo(() => tasks.filter((t) => t.status === 'done'), [tasks]);
  const tasksInProgress = useMemo(() => tasks.filter((t) => t.status === 'in_progress'), [tasks]);

  const chartData = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      return {
        day: d.toLocaleDateString(undefined, { weekday: 'short' }),
        date: d.toDateString(),
        posts: 0,
      };
    });
    posts.forEach((p) => {
      const created = new Date(p.created_at ?? p.updated_at).toDateString();
      const slot = days.find((d) => d.date === created);
      if (slot) slot.posts++;
    });
    return days;
  }, [posts]);

  const navigate = (path: string) => {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const shortcuts = [
    {
      to: '/posts',
      title: 'Content & posts',
      description: 'Draft, schedule, and publish across your connected channels.',
    },
    {
      to: '/tasks',
      title: 'Task board',
      description: 'Keep campaign delivery, milestones, and reviews in view.',
    },
    {
      to: '/cards',
      title: 'Visual studio',
      description: 'Create social cards, carousels, and AI visuals from templates.',
    },
    {
      to: '/integrations',
      title: 'Connected channels',
      description: 'Manage OAuth accounts, webhooks, and platform integrations.',
    },
  ];

  return (
    <div className="os-dashboard">
      <PageHeader
        eyebrow="Workspace overview"
        title="The bigger picture. Clear direction."
        subtitle={`${greeting}, ${greetingName}. ${dateStr} — here is where your workspace stands.`}
        action={
          <Button variant="accent" onClick={() => navigate('/posts')}>
            <Plus size={15} /> Create a post
          </Button>
        }
      />

      {loading ? (
        <Loading rows={5} />
      ) : error ? (
        <Notice tone="danger" title="Overview unavailable">
          {error}
        </Notice>
      ) : (
        <>
          {/* ── 4-column Executive KPI Seam Bar (.os-financials) ── */}
          <section
            data-tour-id="dashboard-stats"
            className="os-financials"
            aria-label="Workspace metrics"
          >
            <div className="os-revenue dot-field">
              <div className="os-caption">Total content</div>
              <div className="os-revenue-value">{posts.length.toLocaleString()}</div>
              <div className="os-revenue-bottom">
                <span>
                  {publishedPosts.length} published · {draftPosts.length} drafts
                </span>
                <button type="button" onClick={() => navigate('/posts')}>
                  View posts
                </button>
              </div>
            </div>

            <div
              className="os-financial-detail cursor-pointer transition-colors hover:bg-soft"
              onClick={() => navigate('/posts')}
            >
              <div className="os-caption">Scheduled queue</div>
              <div className="os-metric-value">{scheduledPosts.length.toLocaleString()}</div>
              <p>Queued for upcoming delivery</p>
            </div>

            <div
              className="os-financial-detail cursor-pointer transition-colors hover:bg-soft"
              onClick={() => navigate('/integrations')}
            >
              <div className="os-caption">Connected channels</div>
              <div className="os-metric-value">{accounts.length.toLocaleString()}</div>
              <p>Active social accounts linked</p>
            </div>

            <div
              className="os-financial-detail cursor-pointer transition-colors hover:bg-soft"
              onClick={() => navigate('/cards')}
            >
              <div className="os-caption">Visual studio</div>
              <div className="os-metric-value">{designs.length.toLocaleString()}</div>
              <p>Saved card &amp; carousel designs</p>
            </div>
          </section>

          {/* ── Onboarding Checklist ── */}
          <OnboardingChecklist
            hasBrief={hasBrief}
            hasAccounts={accounts.length > 0}
            hasPosts={posts.length > 0}
            hasDesigns={designs.length > 0}
            hasEmails={emailsSent}
            userId={currentUser?.id}
          />

          {/* ── Active Project Summary (if project selected) ── */}
          {currentProject && (
            <section className="os-panel mb-6">
              <header className="os-panel-heading">
                <div className="flex items-center gap-3">
                  <span
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium text-white"
                    style={{ background: currentProject.color || '#091833' }}
                  >
                    {currentProject.name[0]?.toUpperCase()}
                  </span>
                  <div>
                    <span className="os-caption">Active project</span>
                    <h2>{currentProject.name}</h2>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/tasks')}
                  className="os-text-link"
                >
                  View all tasks
                </button>
              </header>

              <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-line rounded-[12px] border border-line bg-soft">
                {[
                  { label: 'Total tasks', value: tasks.length },
                  { label: 'In progress', value: tasksInProgress.length },
                  { label: 'Completed', value: tasksDone.length },
                  {
                    label: 'Completion rate',
                    value: tasks.length
                      ? `${Math.round((tasksDone.length / tasks.length) * 100)}%`
                      : '—',
                  },
                ].map((s) => (
                  <div key={s.label} className="p-4">
                    <div className="os-caption">{s.label}</div>
                    <div className="mt-2 text-2xl font-normal tracking-[-0.04em] text-ink tabular-nums">
                      {typeof s.value === 'number' ? s.value.toLocaleString() : s.value}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Primary 2-Column Overview Grid (.os-overview-grid) ── */}
          <div className="os-overview-grid">
            {/* Left column */}
            <div className="space-y-6">
              {/* Post Activity (7 days) */}
              <section className="os-panel">
                <header className="os-panel-heading">
                  <div>
                    <span className="os-caption">Publishing cadence</span>
                    <h2>Post activity (7 days)</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate('/analytics')}
                    className="os-text-link"
                  >
                    Analytics
                  </button>
                </header>

                {chartData.every((d) => d.posts === 0) ? (
                  <EmptyState message="No posts created in the last 7 days." />
                ) : (
                  <ResponsiveContainer width="100%" height={140}>
                    <BarChart data={chartData} barSize={18}>
                      <XAxis
                        dataKey="day"
                        tick={{ fontSize: 11, fill: '#8A91A0' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis hide allowDecimals={false} />
                      <Tooltip
                        content={<ChartTooltip />}
                        cursor={{ fill: 'rgba(37, 99, 235, 0.06)' }}
                      />
                      <Bar dataKey="posts" fill="#2563EB" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
                <p className="os-panel-footnote">
                  Daily count of drafted, scheduled, and published posts over the past week.
                </p>
              </section>

              {/* Recent Posts */}
              <section className="os-panel">
                <header className="os-panel-heading">
                  <div>
                    <span className="os-caption">Content ledger</span>
                    <h2>Recent posts</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate('/posts')}
                    className="os-text-link"
                  >
                    New post
                  </button>
                </header>

                {recentPosts.length === 0 ? (
                  <EmptyState
                    message="No posts yet. Create your first post to start your publishing queue."
                    action={
                      <Button variant="accent" size="sm" onClick={() => navigate('/posts')}>
                        Create a post
                      </Button>
                    }
                  />
                ) : (
                  <ul className="divide-y divide-line">
                    {recentPosts.map((post) => (
                      <li
                        key={post.id}
                        onClick={() => navigate('/posts')}
                        className="flex items-center justify-between gap-3 py-3 px-2 rounded-[10px] hover:bg-soft transition-colors cursor-pointer"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-line bg-soft text-muted">
                            <FileText size={13} />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-ink">
                              {post.title || '(Untitled)'}
                            </p>
                            <p className="font-mono text-[11px] text-faint">
                              {relativeDate(post.updated_at)}
                            </p>
                          </div>
                        </div>
                        <StatusBadge status={post.status} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            {/* Right column */}
            <div className="space-y-6">
              {/* Connected Accounts */}
              <section className="os-panel">
                <header className="os-panel-heading">
                  <div>
                    <span className="os-caption">Distribution</span>
                    <h2>Connected channels</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate('/integrations')}
                    className="os-text-link"
                  >
                    Manage
                  </button>
                </header>

                {accounts.length === 0 ? (
                  <EmptyState
                    message="No social channels connected yet."
                    action={
                      <Button variant="secondary" size="sm" onClick={() => navigate('/integrations')}>
                        Connect channel
                      </Button>
                    }
                  />
                ) : (
                  <ul className="divide-y divide-line">
                    {accounts.map((account) => (
                      <li
                        key={account.id}
                        className="flex items-center gap-3 py-3 px-2 rounded-[10px] hover:bg-soft transition-colors"
                      >
                        <div className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-pale text-blue-d">
                          <Users size={13} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium capitalize text-ink">
                            {account.platform}
                          </p>
                          <p className="truncate text-xs text-muted">
                            {account.account_name || account.account_id}
                          </p>
                        </div>
                        <Badge tone="positive">Active</Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Recent Designs */}
              <section className="os-panel">
                <header className="os-panel-heading">
                  <div>
                    <span className="os-caption">Visual studio</span>
                    <h2>Recent designs</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate('/cards')}
                    className="os-text-link"
                  >
                    Open studio
                  </button>
                </header>

                {designs.length === 0 ? (
                  <EmptyState
                    message="No card designs saved yet."
                    action={
                      <Button variant="secondary" size="sm" onClick={() => navigate('/cards')}>
                        Create design
                      </Button>
                    }
                  />
                ) : (
                  <div className="grid grid-cols-3 gap-2.5">
                    {designs.slice(0, 6).map((d) => (
                      <div
                        key={d.id}
                        onClick={() => navigate('/cards')}
                        className="aspect-square cursor-pointer overflow-hidden rounded-[12px] border border-line bg-soft hover:border-blue transition-colors"
                      >
                        {d.thumbnail_url ? (
                          <img
                            src={d.thumbnail_url}
                            alt={d.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center">
                            <ImageIcon size={18} className="text-faint" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Upcoming Scheduled Posts */}
              {scheduledPosts.length > 0 && (
                <section className="os-panel">
                  <header className="os-panel-heading">
                    <div>
                      <span className="os-caption">Upcoming queue</span>
                      <h2>Scheduled posts</h2>
                    </div>
                    <Calendar size={15} className="text-blue" />
                  </header>
                  <ul className="divide-y divide-line">
                    {scheduledPosts.slice(0, 3).map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-2 py-2.5">
                        <p className="truncate text-xs font-medium text-ink">
                          {p.title || '(Untitled)'}
                        </p>
                        <span className="shrink-0 font-mono text-[11px] text-blue">
                          {formatDate((p as any).scheduled_at || p.updated_at)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* Agent Activity Feed */}
              <AgentActivityFeed />
            </div>
          </div>

          {/* ── Numbered Workspace Shortcuts (.os-shortcuts) ── */}
          <section
            data-tour-id="dashboard-quick-actions"
            className="os-shortcuts"
            aria-label="Workspace shortcuts"
          >
            <div className="os-section-label">
              <h2>Your workspace</h2>
              <span>Continue where it matters</span>
            </div>
            <div className="os-shortcut-grid">
              {shortcuts.map((item, index) => (
                <button
                  type="button"
                  key={item.to}
                  onClick={() => navigate(item.to)}
                  className="os-shortcut"
                >
                  <span className="os-shortcut-number">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <h3>{item.title}</h3>
                  <p>{item.description}</p>
                  <span className="os-shortcut-action">Open module →</span>
                </button>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
