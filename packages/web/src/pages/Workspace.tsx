import { useEffect, useState } from 'react';
import {
  Building2,
  Check,
  ChevronDown,
  Copy,
  Loader2,
  Mail,
  Plus,
  Trash2,
  UserMinus,
  Users,
  X,
} from 'lucide-react';
import { API_BASE_URL } from '../utils/apiBase';
import { useWorkspace, Organization, OrgRole } from '../contexts/WorkspaceContext';

function authHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchJson<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json', ...authHeaders() }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error || `Request failed ${res.status}`);
  return data as T;
}

type Member = {
  id: string;
  role: OrgRole;
  created_at: string;
  user_id: string;
  full_name: string | null;
  email: string;
  username: string | null;
  avatar_url: string | null;
};

type Invitation = {
  id: string;
  email: string;
  role: OrgRole;
  expires_at: string;
  created_at: string;
  token: string;
  invited_by_name: string | null;
};

const ROLE_LABELS: Record<OrgRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Viewer',
};

const ROLE_COLORS: Record<OrgRole, string> = {
  owner: 'bg-purple-100 text-purple-700',
  admin: 'bg-blue-100 text-blue-700',
  editor: 'bg-emerald-100 text-emerald-700',
  viewer: 'bg-slate-100 text-slate-600',
};

function RoleBadge({ role }: { role: OrgRole }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${ROLE_COLORS[role]}`}>
      {ROLE_LABELS[role]}
    </span>
  );
}

function OrgSwitcher({
  organizations,
  currentOrg,
  onSwitch,
}: {
  organizations: Organization[];
  currentOrg: Organization | null;
  onSwitch: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (organizations.length <= 1 && currentOrg) return null;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
      >
        <Building2 size={15} className="text-slate-500" />
        {currentOrg?.name ?? 'Select organization'}
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-60 rounded-2xl border border-slate-200 bg-white shadow-lg">
          {organizations.map((org) => (
            <button
              key={org.id}
              type="button"
              onClick={() => { onSwitch(org.id); setOpen(false); }}
              className={`flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold transition hover:bg-slate-50 first:rounded-t-2xl last:rounded-b-2xl ${
                currentOrg?.id === org.id ? 'text-blue-600' : 'text-slate-800'
              }`}
            >
              <Building2 size={14} />
              <span className="flex-1 truncate">{org.name}</span>
              {currentOrg?.id === org.id && <Check size={13} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────
function SettingsTab({ org, onUpdated }: { org: Organization; onUpdated: (o: Organization) => void }) {
  const { refresh } = useWorkspace();
  const [name, setName] = useState(org.name);
  const [description, setDescription] = useState(org.description ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setName(org.name); setDescription(org.description ?? ''); }, [org]);

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      const data = await fetchJson<{ organization: Organization }>(
        `${API_BASE_URL}/api/organizations/${org.id}`,
        { method: 'PUT', body: JSON.stringify({ name, description }) }
      );
      onUpdated(data.organization);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const canEdit = org.role === 'owner' || org.role === 'admin';

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
        <h3 className="text-sm font-bold text-slate-800">Organization details</h3>
        <div>
          <label className="mb-1 block text-sm font-semibold text-slate-700">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!canEdit}
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 disabled:opacity-60"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-semibold text-slate-700">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={!canEdit}
            rows={3}
            className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 disabled:opacity-60"
          />
        </div>
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        {canEdit && (
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : null}
            {saving ? 'Saving…' : saved ? 'Saved!' : 'Save changes'}
          </button>
        )}
      </div>

      <ProjectsSection orgId={org.id} canManage={canEdit} />
    </div>
  );
}

// ─── Projects Section ─────────────────────────────────────────────────────────
function ProjectsSection({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const { projects, refresh } = useWorkspace();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#2563EB');
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createProject = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await fetchJson(`${API_BASE_URL}/api/organizations/${orgId}/projects`, {
        method: 'POST',
        body: JSON.stringify({ name: newName.trim(), color: newColor }),
      });
      setNewName('');
      setShowCreate(false);
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  };

  const deleteProject = async (projectId: string) => {
    setDeletingId(projectId);
    setError(null);
    try {
      await fetchJson(`${API_BASE_URL}/api/organizations/${orgId}/projects/${projectId}`, { method: 'DELETE' });
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-800">Projects</h3>
        {canManage && (
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Plus size={13} /> New project
          </button>
        )}
      </div>

      {showCreate && (
        <div className="flex items-center gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Project name"
            onKeyDown={(e) => e.key === 'Enter' && createProject()}
            className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-400"
          />
          <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} className="h-9 w-9 cursor-pointer rounded-lg border border-slate-200" />
          <button
            type="button"
            onClick={createProject}
            disabled={creating || !newName.trim()}
            className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {creating ? <Loader2 size={14} className="animate-spin" /> : 'Add'}
          </button>
          <button type="button" onClick={() => setShowCreate(false)} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100">
            <X size={14} />
          </button>
        </div>
      )}

      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      <div className="space-y-2">
        {projects.map((proj) => (
          <div key={proj.id} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
            <span className="h-3 w-3 rounded-full flex-shrink-0" style={{ backgroundColor: proj.color }} />
            <span className="flex-1 text-sm font-semibold text-slate-800">{proj.name}</span>
            {proj.description && <span className="text-xs text-slate-500 truncate max-w-[200px]">{proj.description}</span>}
            {canManage && projects.length > 1 && (
              <button
                type="button"
                onClick={() => deleteProject(proj.id)}
                disabled={deletingId === proj.id}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                title="Delete project"
              >
                {deletingId === proj.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              </button>
            )}
          </div>
        ))}
        {projects.length === 0 && <p className="text-sm text-slate-500">No projects yet.</p>}
      </div>
    </div>
  );
}

// ─── Team Tab ─────────────────────────────────────────────────────────────────
function TeamTab({ org }: { org: Organization }) {
  const { refresh } = useWorkspace();
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'editor' | 'viewer'>('editor');
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ link: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canManage = org.role === 'owner' || org.role === 'admin';

  const loadTeam = async () => {
    setLoadingMembers(true);
    try {
      const [mData, iData] = await Promise.all([
        fetchJson<{ members: Member[] }>(`${API_BASE_URL}/api/organizations/${org.id}/members`),
        canManage
          ? fetchJson<{ invitations: Invitation[] }>(`${API_BASE_URL}/api/organizations/${org.id}/invitations`).catch(() => ({ invitations: [] }))
          : Promise.resolve({ invitations: [] }),
      ]);
      setMembers(mData.members ?? []);
      setInvitations(iData.invitations ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoadingMembers(false);
    }
  };

  useEffect(() => { void loadTeam(); }, [org.id]);

  const sendInvite = async () => {
    if (!inviteEmail.trim()) return;
    setError(null);
    setInviting(true);
    setInviteResult(null);
    try {
      const data = await fetchJson<{ inviteLink: string }>(`${API_BASE_URL}/api/organizations/${org.id}/invite`, {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      setInviteResult({ link: `${window.location.origin}${data.inviteLink}` });
      setInviteEmail('');
      void loadTeam();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setInviting(false);
    }
  };

  const cancelInvite = async (invId: string) => {
    try {
      await fetchJson(`${API_BASE_URL}/api/organizations/${org.id}/invitations/${invId}`, { method: 'DELETE' });
      setInvitations((prev) => prev.filter((i) => i.id !== invId));
    } catch (e: any) {
      setError(e.message);
    }
  };

  const updateRole = async (userId: string, role: 'admin' | 'editor' | 'viewer') => {
    try {
      await fetchJson(`${API_BASE_URL}/api/organizations/${org.id}/members/${userId}`, {
        method: 'PUT',
        body: JSON.stringify({ role }),
      });
      setMembers((prev) => prev.map((m) => (m.user_id === userId ? { ...m, role } : m)));
    } catch (e: any) {
      setError(e.message);
    }
  };

  const removeMember = async (userId: string) => {
    try {
      await fetchJson(`${API_BASE_URL}/api/organizations/${org.id}/members/${userId}`, { method: 'DELETE' });
      setMembers((prev) => prev.filter((m) => m.user_id !== userId));
      await refresh();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const copyLink = () => {
    if (inviteResult?.link) {
      navigator.clipboard.writeText(inviteResult.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="space-y-5">
      {error && <p className="rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>}

      {/* Invite section */}
      {canManage && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-4">
          <h3 className="text-sm font-bold text-slate-800">Invite team member</h3>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendInvite()}
              placeholder="colleague@example.com"
              className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as 'admin' | 'editor' | 'viewer')}
              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-medium text-slate-700 outline-none"
            >
              <option value="editor">Editor</option>
              <option value="admin">Admin</option>
              <option value="viewer">Viewer</option>
            </select>
            <button
              type="button"
              onClick={sendInvite}
              disabled={inviting || !inviteEmail.trim()}
              className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {inviting ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
              {inviting ? 'Sending…' : 'Send invite'}
            </button>
          </div>

          {inviteResult && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <p className="mb-2 text-xs font-semibold text-emerald-700">Invitation created. Share this link:</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded-lg bg-white px-2 py-1.5 text-xs text-slate-700 border border-slate-200">
                  {inviteResult.link}
                </code>
                <button
                  type="button"
                  onClick={copyLink}
                  className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Members list */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-3">
        <div className="flex items-center gap-2">
          <Users size={16} className="text-slate-500" />
          <h3 className="text-sm font-bold text-slate-800">Members ({members.length})</h3>
        </div>

        {loadingMembers ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : (
          <div className="space-y-2">
            {members.map((m) => (
              <div key={m.user_id} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                <div className="h-8 w-8 flex-shrink-0 rounded-full bg-blue-100 flex items-center justify-center text-xs font-bold text-blue-700">
                  {(m.full_name || m.email)[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-900 truncate">{m.full_name || m.email}</p>
                  {m.full_name && <p className="text-xs text-slate-500 truncate">{m.email}</p>}
                </div>
                {canManage && m.role !== 'owner' ? (
                  <select
                    value={m.role}
                    onChange={(e) => updateRole(m.user_id, e.target.value as 'admin' | 'editor' | 'viewer')}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
                  >
                    <option value="admin">Admin</option>
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                  </select>
                ) : (
                  <RoleBadge role={m.role} />
                )}
                {canManage && m.role !== 'owner' && (
                  <button
                    type="button"
                    onClick={() => removeMember(m.user_id)}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500"
                    title="Remove member"
                  >
                    <UserMinus size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pending invitations */}
      {canManage && invitations.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-3">
          <h3 className="text-sm font-bold text-slate-800">Pending invitations</h3>
          <div className="space-y-2">
            {invitations.map((inv) => (
              <div key={inv.id} className="flex items-center gap-3 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
                <Mail size={14} className="text-amber-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{inv.email}</p>
                  <p className="text-xs text-slate-500">
                    Invited as <span className="font-medium">{ROLE_LABELS[inv.role]}</span> · expires{' '}
                    {new Date(inv.expires_at).toLocaleDateString()}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => cancelInvite(inv.id)}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500"
                  title="Cancel invitation"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Create Org Modal ─────────────────────────────────────────────────────────
function CreateOrgModal({ onClose, onCreated }: { onClose: () => void; onCreated: (org: Organization) => void }) {
  const { refresh } = useWorkspace();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const data = await fetchJson<{ organization: Organization }>(`${API_BASE_URL}/api/organizations`, {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), description: description.trim() }),
      });
      await refresh();
      onCreated(data.organization);
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">New organization</h2>
          <button type="button" onClick={onClose} className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>
        <div>
          <label className="mb-1 block text-sm font-semibold text-slate-700">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
            autoFocus
            placeholder="My company"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-semibold text-slate-700">Description <span className="font-normal text-slate-400">(optional)</span></label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
          />
        </div>
        {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button
            type="button"
            onClick={create}
            disabled={saving || !name.trim()}
            className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
type WorkspaceTab = 'settings' | 'team';

export default function Workspace() {
  const { organizations, currentOrg, loading, switchOrg, refresh } = useWorkspace();
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('settings');
  const [localOrg, setLocalOrg] = useState<Organization | null>(null);
  const [showCreateOrg, setShowCreateOrg] = useState(false);

  useEffect(() => { setLocalOrg(currentOrg); }, [currentOrg]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  const org = localOrg ?? currentOrg;

  if (!org) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <Building2 size={48} className="text-slate-300" />
        <p className="text-slate-500">No organization found.</p>
        <button
          type="button"
          onClick={() => setShowCreateOrg(true)}
          className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700"
        >
          <Plus size={15} /> Create organization
        </button>
        {showCreateOrg && (
          <CreateOrgModal
            onClose={() => setShowCreateOrg(false)}
            onCreated={(o) => { setLocalOrg(o); void switchOrg(o.id); }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600">
            <Building2 className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">{org.name}</h2>
            <p className="text-sm text-slate-500">
              <RoleBadge role={org.role} /> · {org.member_count} {org.member_count === 1 ? 'member' : 'members'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <OrgSwitcher organizations={organizations} currentOrg={org} onSwitch={switchOrg} />
          <button
            type="button"
            onClick={() => setShowCreateOrg(true)}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Plus size={13} /> New org
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200">
        {(['settings', 'team'] as WorkspaceTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`px-5 py-3 text-sm font-semibold border-b-2 -mb-px transition-colors capitalize ${
              activeTab === tab
                ? 'border-slate-950 text-slate-950'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {tab === 'settings' ? 'Settings' : 'Team'}
          </button>
        ))}
      </div>

      {activeTab === 'settings' && <SettingsTab org={org} onUpdated={(o) => { setLocalOrg(o); }} />}
      {activeTab === 'team' && <TeamTab org={org} />}

      {showCreateOrg && (
        <CreateOrgModal
          onClose={() => setShowCreateOrg(false)}
          onCreated={(o) => { setLocalOrg(o); void switchOrg(o.id); void refresh(); }}
        />
      )}
    </div>
  );
}
