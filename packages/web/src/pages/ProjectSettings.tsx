import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, Check, Crown, Loader2, Mail, Save, Shield, Trash2, UserPlus, X,
} from 'lucide-react';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { API_BASE_URL } from '../utils/apiBase';
import { ColorPickerPopover } from '../components/cards/builder/ColorPicker';

const PRESET_COLORS = [
  '#2563EB', '#3b82f6', '#10b981', '#f59e0b',
  '#ef4444', '#2563EB', '#ec4899', '#14b8a6',
  '#f97316', '#64748b',
];

type Tab = 'general' | 'team';

type Member = {
  user_id: string;
  name: string;
  email: string;
  role: string;
  created_at: string;
};

type Invitation = {
  id: string;
  email: string;
  role: string;
  created_at: string;
  expires_at: string;
};

const ROLE_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  owner: { label: 'Owner', icon: Crown, color: 'text-amber-600 bg-amber-50' },
  admin: { label: 'Admin', icon: Shield, color: 'text-indigo-600 bg-indigo-50' },
  editor: { label: 'Editor', icon: Check, color: 'text-emerald-600 bg-emerald-50' },
  viewer: { label: 'Viewer', icon: Check, color: 'text-slate-500 bg-slate-100' },
};

function tok() {
  return localStorage.getItem('auth_token') ?? '';
}

export default function ProjectSettings() {
  const { currentProject, currentOrg, refresh } = useWorkspace();

  // Read initial tab from sessionStorage (set by sidebar Team link)
  const [tab, setTab] = useState<Tab>(() => {
    const v = sessionStorage.getItem('proj_settings_tab');
    sessionStorage.removeItem('proj_settings_tab');
    return v === 'team' ? 'team' : 'general';
  });

  // General tab state
  const [name, setName] = useState(currentProject?.name ?? '');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(currentProject?.color ?? '#2563EB');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deleteInputRef = useRef<HTMLInputElement>(null);

  // Team tab state
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'editor' | 'viewer'>('editor');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [inviteSent, setInviteSent] = useState(false);

  useEffect(() => {
    if (currentProject) {
      setName(currentProject.name);
      setDescription((currentProject as any).description ?? '');
      setColor(currentProject.color ?? '#2563EB');
    }
  }, [currentProject?.id]);

  useEffect(() => {
    if (tab === 'team' && currentOrg) void loadTeam();
  }, [tab, currentOrg?.id]);

  const loadTeam = async () => {
    if (!currentOrg) return;
    setTeamLoading(true);
    try {
      const [mRes, iRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/organizations/${currentOrg.id}/members`, {
          headers: { Authorization: `Bearer ${tok()}` },
        }),
        fetch(`${API_BASE_URL}/api/organizations/${currentOrg.id}/invitations`, {
          headers: { Authorization: `Bearer ${tok()}` },
        }),
      ]);
      const mData = await mRes.json();
      const iData = await iRes.json();
      if (mData.success) setMembers(mData.members ?? []);
      if (iData.success) setInvitations(iData.invitations ?? []);
    } catch { /* silent */ } finally {
      setTeamLoading(false);
    }
  };

  if (!currentProject || !currentOrg) {
    return (
      <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-white">
        <p className="text-sm text-gray-400">Select a project to view its settings</p>
      </div>
    );
  }

  const isAdmin = currentOrg.role === 'owner' || currentOrg.role === 'admin';

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true); setError(''); setSaved(false);
    try {
      const r = await fetch(`${API_BASE_URL}/api/organizations/${currentOrg.id}/projects/${currentProject.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
        body: JSON.stringify({ name: name.trim(), description, color }),
      });
      if (!r.ok) throw new Error('Failed to save');
      await refresh();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally { setSaving(false); }
  };

  const deleteProject = async () => {
    setDeleting(true);
    setError('');
    try {
      const r = await fetch(`${API_BASE_URL}/api/organizations/${currentOrg.id}/projects/${currentProject.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${tok()}` },
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || 'Delete failed');
      await refresh();
      window.history.pushState({}, '', '/dashboard');
      window.dispatchEvent(new PopStateEvent('popstate'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
      setConfirmDelete(false);
    } finally { setDeleting(false); }
  };

  const sendInvite = async () => {
    if (!inviteEmail.trim()) return;
    setInviting(true); setInviteError(''); setInviteSent(false);
    try {
      const r = await fetch(`${API_BASE_URL}/api/organizations/${currentOrg.id}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok()}` },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error || 'Invite failed');
      setInviteSent(true);
      setInviteEmail('');
      setTimeout(() => setInviteSent(false), 3000);
      void loadTeam();
    } catch (e: any) {
      setInviteError(e.message);
    } finally { setInviting(false); }
  };

  const removeMember = async (userId: string) => {
    if (!confirm('Remove this member from the organisation?')) return;
    await fetch(`${API_BASE_URL}/api/organizations/${currentOrg.id}/members/${userId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tok()}` },
    });
    void loadTeam();
  };

  const cancelInvite = async (invId: string) => {
    await fetch(`${API_BASE_URL}/api/organizations/${currentOrg.id}/invitations/${invId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tok()}` },
    });
    void loadTeam();
  };

  return (
    <div className="max-w-2xl space-y-4">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-sm font-black text-white"
          style={{ background: color }}>
          {name[0]?.toUpperCase() ?? 'P'}
        </span>
        <div>
          <h1 className="text-xl font-black text-gray-900">{currentProject.name}</h1>
          <p className="text-xs text-gray-400">{currentOrg.name}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        {(['general', 'team'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-sm font-semibold transition-colors border-b-2 -mb-px capitalize ${
              tab === t
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── General tab ── */}
      {tab === 'general' && (
        <div className="space-y-5">
          <div className="rounded-2xl border border-gray-200 bg-white p-6 space-y-5">
            <h2 className="text-[13px] font-bold text-gray-700 uppercase tracking-wider">Project Info</h2>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Project Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} disabled={!isAdmin}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-[14px] text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:bg-gray-50 disabled:text-gray-500" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Description</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} disabled={!isAdmin} rows={3}
                placeholder="What is this project about?"
                className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2.5 text-[13px] text-gray-700 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:bg-gray-50" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Project Color</label>
              <div className="flex flex-wrap items-center gap-2">
                {PRESET_COLORS.map((c) => (
                  <button key={c} type="button" disabled={!isAdmin} onClick={() => setColor(c)}
                    className={`h-7 w-7 rounded-full border-2 transition-transform ${color === c ? 'border-gray-900 scale-110' : 'border-transparent hover:scale-110'} ${!isAdmin ? 'cursor-not-allowed opacity-50' : ''}`}
                    style={{ background: c }} />
                ))}
                <div className="flex items-center gap-2 ml-1 border-l border-gray-200 pl-3">
                  <ColorPickerPopover value={color} onChange={setColor} disabled={!isAdmin} />
                  <span className="text-[11px] font-mono text-gray-400">{color}</span>
                </div>
              </div>
            </div>
            {error && <p className="text-[12px] text-red-500">{error}</p>}
            {isAdmin && (
              <button type="button" onClick={() => void save()} disabled={saving || !name.trim()}
                className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-[13px] font-bold text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors">
                <Save size={14} />
                {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Changes'}
              </button>
            )}
          </div>

          {/* Meta */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-2 text-[12px] text-gray-500">
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-3">Details</h2>
            <p><span className="font-semibold text-gray-700">Project ID:</span> {currentProject.id}</p>
            <p><span className="font-semibold text-gray-700">Organisation:</span> {currentOrg.name}</p>
            <p><span className="font-semibold text-gray-700">Your Role:</span> {currentOrg.role}</p>
          </div>

          {/* Danger zone */}
          {isAdmin && (
            <div className="rounded-2xl border border-red-200 bg-white p-5">
              <h2 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-red-500">Danger Zone</h2>
              {!confirmDelete ? (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[13px] font-semibold text-gray-800">Delete this project</p>
                    <p className="text-[12px] text-gray-400">Permanently removes the project and all its tasks.</p>
                  </div>
                  <button type="button" onClick={() => { setConfirmDelete(true); setTimeout(() => deleteInputRef.current?.focus(), 50); }}
                    className="rounded-xl border border-red-300 px-4 py-2 text-[13px] font-semibold text-red-600 hover:bg-red-50 transition-colors">
                    Delete Project
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-[12px] text-red-600">
                    <AlertTriangle size={14} />
                    Type <strong className="mx-1">"{currentProject.name}"</strong> to confirm
                  </div>
                  <input ref={deleteInputRef} type="text" placeholder={currentProject.name}
                    className="w-full rounded-xl border border-red-300 px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-red-300"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.target as HTMLInputElement).value === currentProject.name) void deleteProject();
                      if (e.key === 'Escape') setConfirmDelete(false);
                    }} />
                  <div className="flex gap-2">
                    <button type="button" onClick={deleteProject} disabled={deleting}
                      className="flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-[13px] font-bold text-white hover:bg-red-700 disabled:opacity-40">
                      <Trash2 size={13} /> {deleting ? 'Deleting…' : 'Confirm Delete'}
                    </button>
                    <button type="button" onClick={() => setConfirmDelete(false)}
                      className="rounded-xl border border-gray-200 px-4 py-2 text-[13px] text-gray-600 hover:bg-gray-50">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Team tab ── */}
      {tab === 'team' && (
        <div className="space-y-5">
          {/* Invite form */}
          {isAdmin && (
            <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
              <div className="flex items-center gap-2">
                <UserPlus size={15} className="text-indigo-600" />
                <h2 className="text-[13px] font-bold text-gray-800">Invite to Organisation</h2>
              </div>
              <p className="text-[12px] text-gray-400">Invited members can be assigned to tasks in all projects under <strong>{currentOrg.name}</strong>.</p>
              <div className="flex gap-2">
                <input
                  type="email"
                  placeholder="colleague@email.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void sendInvite()}
                  className="flex-1 rounded-xl border border-gray-200 px-3 py-2 text-[13px] text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
                <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as any)}
                  className="rounded-xl border border-gray-200 px-3 py-2 text-[13px] text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300">
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                  <option value="admin">Admin</option>
                </select>
                <button type="button" onClick={() => void sendInvite()} disabled={inviting || !inviteEmail.trim()}
                  className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-[13px] font-bold text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors">
                  {inviting ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />}
                  {inviting ? 'Sending…' : inviteSent ? '✓ Sent!' : 'Invite'}
                </button>
              </div>
              {inviteError && <p className="text-[12px] text-red-500">{inviteError}</p>}
            </div>
          )}

          {/* Members list */}
          <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <span className="text-[13px] font-bold text-gray-800">Members</span>
              <span className="text-[11px] text-gray-400">{members.length} member{members.length !== 1 ? 's' : ''}</span>
            </div>
            {teamLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 size={18} className="animate-spin text-gray-400" />
              </div>
            ) : members.length === 0 ? (
              <p className="px-5 py-8 text-center text-[13px] text-gray-400">No members yet</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {members.map((m) => {
                  const roleMeta = ROLE_META[m.role] ?? ROLE_META.viewer;
                  const RoleIcon = roleMeta.icon;
                  return (
                    <div key={m.user_id} className="flex items-center gap-3 px-5 py-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[12px] font-black text-indigo-600">
                        {(m.name || m.email)[0]?.toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-gray-900 truncate">{m.name || m.email}</p>
                        <p className="text-[11px] text-gray-400 truncate">{m.email}</p>
                      </div>
                      <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${roleMeta.color}`}>
                        <RoleIcon size={10} />
                        {roleMeta.label}
                      </span>
                      {isAdmin && m.role !== 'owner' && (
                        <button type="button" onClick={() => void removeMember(m.user_id)}
                          className="rounded-lg p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                          <X size={13} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Pending invitations */}
          {invitations.length > 0 && (
            <div className="rounded-2xl border border-dashed border-gray-200 bg-white overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100">
                <span className="text-[13px] font-bold text-gray-500">Pending Invitations</span>
              </div>
              <div className="divide-y divide-gray-50">
                {invitations.map((inv) => (
                  <div key={inv.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-400">
                      <Mail size={13} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-gray-700 truncate">{inv.email}</p>
                      <p className="text-[11px] text-gray-400">
                        Invited as <span className="font-semibold capitalize">{inv.role}</span> · expires {new Date(inv.expires_at).toLocaleDateString()}
                      </p>
                    </div>
                    {isAdmin && (
                      <button type="button" onClick={() => void cancelInvite(inv.id)}
                        className="rounded-lg p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                        <X size={13} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
