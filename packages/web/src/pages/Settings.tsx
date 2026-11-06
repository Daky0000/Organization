import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react';
import OutboundWebhooksPanel from '../components/OutboundWebhooksPanel';
import {
  Bell,
  Camera,
  Check,
  CreditCard,
  Eye,
  EyeOff,
  Image as ImageIcon,
  KeyRound,
  Loader2,
  Save,
  Shield,
  Sparkles,
  Trash2,
  User,
} from 'lucide-react';
import { AppUser, normalizeUser } from '../utils/userSession';
import { mediaService } from '../services/mediaService';
import { compressImage } from '../utils/imageCompression';
import { API_BASE_URL } from '../utils/apiBase';

// ─── types ────────────────────────────────────────────────────────────────────

type SettingsProps = {
  currentUser: AppUser | null;
  onUserUpdated: (user: AppUser) => void;
  onNavigateToBilling?: () => void;
};

type ProfileForm = {
  name: string; username: string; email: string;
  phone: string; country: string; website: string;
  bio: string; avatar: string; cover: string;
};

type NotifPrefs = {
  post_published: boolean;
  team_activity: boolean;
  billing_alerts: boolean;
  weekly_digest: boolean;
  marketing_emails: boolean;
};

type BillingSummary = {
  plan_name: string;
  status: string;
  posts_this_period: number;
  posts_limit: number;
  current_period_end: string | null;
};

// ─── helpers ──────────────────────────────────────────────────────────────────

const tok = () => localStorage.getItem('auth_token') ?? '';
const authHdr = () => ({ Authorization: `Bearer ${tok()}` });

async function safeJson<T>(r: Response): Promise<T | null> {
  try { return (await r.json()) as T; } catch { return null; }
}

const defaultCover = 'linear-gradient(135deg, rgba(15,23,42,0.88), rgba(37,99,235,0.72) 42%, rgba(56,189,248,0.62) 100%)';

function toForm(u: AppUser | null): ProfileForm {
  return {
    name: u?.name ?? '', username: u?.username ?? '', email: u?.email ?? '',
    phone: u?.phone ?? '', country: u?.country ?? '', website: u?.website ?? '',
    bio: '', avatar: u?.avatar ?? '', cover: u?.cover ?? '',
  };
}

const DEFAULT_NOTIFS: NotifPrefs = {
  post_published: true, team_activity: true,
  billing_alerts: true, weekly_digest: false, marketing_emails: false,
};

// ─── sub-components ───────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${checked ? 'bg-indigo-600' : 'bg-slate-200'}`}
    >
      <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
    </button>
  );
}

function SectionCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-6 ${className}`}>
      {children}
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export default function Settings({ currentUser, onUserUpdated, onNavigateToBilling }: SettingsProps) {
  const [tab, setTab] = useState<'account' | 'security' | 'notifications' | 'billing' | 'apikeys'>('account');

  // ── Account tab ──────────────────────────────────────────────────────────
  const [form, setForm] = useState<ProfileForm>(() => toForm(currentUser));
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [uploadingField, setUploadingField] = useState<'avatar' | 'cover' | null>(null);
  const avatarRef = useRef<HTMLInputElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setForm(toForm(currentUser)); }, [currentUser]);

  const setField = (k: keyof ProfileForm, v: string) => {
    setForm((p) => ({ ...p, [k]: v }));
    setProfileMsg(null);
  };

  const handleImageUpload = async (e: ChangeEvent<HTMLInputElement>, field: 'avatar' | 'cover') => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setUploadingField(field);
      const compressed = await compressImage(file);
      const saved = await mediaService.upload({
        url: compressed.url, thumbnail_url: compressed.thumbnail_url,
        file_name: `${field}-${Date.now()}-${file.name}`, original_name: file.name,
        file_size: compressed.file_size, file_type: compressed.file_type,
        width: compressed.width, height: compressed.height, force: true,
      });
      setField(field, saved.url);
    } catch (err) {
      const dup = err as Error & { isDuplicate?: boolean; existingImage?: { url?: string } };
      if (dup?.isDuplicate && dup.existingImage?.url) setField(field, dup.existingImage.url);
      else setProfileMsg({ ok: false, text: err instanceof Error ? err.message : 'Upload failed' });
    } finally {
      setUploadingField(null);
      e.target.value = '';
    }
  };

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.username.trim() || !form.email.trim()) {
      setProfileMsg({ ok: false, text: 'Name, username, and email are required.' });
      return;
    }
    setSavingProfile(true);
    setProfileMsg(null);
    try {
      const r = await fetch(`${API_BASE_URL}/api/auth/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHdr() },
        body: JSON.stringify({
          name: form.name.trim(), username: form.username.trim(), email: form.email.trim(),
          phone: form.phone.trim(), country: form.country.trim(), website: form.website.trim(),
          avatar: form.avatar, cover: form.cover,
        }),
      });
      type PR = { success: boolean; error?: string; user?: Partial<AppUser> & { id?: string; email?: string } };
      const data = await safeJson<PR>(r);
      if (!r.ok || !data?.success || !data.user?.id || !data.user?.email) {
        throw new Error(data?.error ?? 'Failed to save profile');
      }
      const updated = normalizeUser({
        id: data.user.id, email: data.user.email,
        name: data.user.name ?? null, username: data.user.username ?? null,
        phone: data.user.phone ?? null, country: data.user.country ?? null,
        website: data.user.website ?? null,
        role: data.user.role === 'admin' ? 'admin' : 'user',
        avatar: data.user.avatar ?? null, cover: data.user.cover ?? null,
      });
      onUserUpdated(updated);
      setProfileMsg({ ok: true, text: 'Profile saved.' });
    } catch (err) {
      setProfileMsg({ ok: false, text: err instanceof Error ? err.message : 'Failed to save' });
    } finally {
      setSavingProfile(false);
    }
  };

  // ── Security tab ─────────────────────────────────────────────────────────
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [changingPw, setChangingPw] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (newPw !== confirmPw) { setPwMsg({ ok: false, text: 'New passwords do not match.' }); return; }
    if (newPw.length < 8) { setPwMsg({ ok: false, text: 'New password must be at least 8 characters.' }); return; }
    setChangingPw(true);
    setPwMsg(null);
    try {
      const r = await fetch(`${API_BASE_URL}/api/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHdr() },
        body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
      });
      const data = await safeJson<{ success: boolean; error?: string }>(r);
      if (!r.ok || !data?.success) throw new Error(data?.error ?? 'Failed to change password');
      setPwMsg({ ok: true, text: 'Password changed successfully.' });
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
    } catch (err) {
      setPwMsg({ ok: false, text: err instanceof Error ? err.message : 'Failed' });
    } finally {
      setChangingPw(false);
    }
  };

  // ── Notifications tab ────────────────────────────────────────────────────
  const [notifs, setNotifs] = useState<NotifPrefs>(DEFAULT_NOTIFS);
  const [loadingNotifs, setLoadingNotifs] = useState(false);
  const [savingNotifs, setSavingNotifs] = useState(false);
  const [notifMsg, setNotifMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (tab !== 'notifications') return;
    setLoadingNotifs(true);
    fetch(`${API_BASE_URL}/api/user-settings/notification_preferences`, { headers: authHdr() })
      .then((r) => r.json())
      .then((d: { value?: NotifPrefs }) => { if (d.value) setNotifs({ ...DEFAULT_NOTIFS, ...d.value }); })
      .catch(() => undefined)
      .finally(() => setLoadingNotifs(false));
  }, [tab]);

  const saveNotifs = async () => {
    setSavingNotifs(true);
    setNotifMsg(null);
    try {
      const r = await fetch(`${API_BASE_URL}/api/user-settings/notification_preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHdr() },
        body: JSON.stringify({ value: notifs }),
      });
      if (!r.ok) throw new Error('Save failed');
      setNotifMsg({ ok: true, text: 'Preferences saved.' });
    } catch {
      setNotifMsg({ ok: false, text: 'Failed to save preferences.' });
    } finally {
      setSavingNotifs(false);
    }
  };

  const NOTIF_ROWS: { key: keyof NotifPrefs; label: string; desc: string }[] = [
    { key: 'post_published', label: 'Post published', desc: 'When a scheduled post goes live' },
    { key: 'team_activity', label: 'Team activity', desc: 'Member joins, role changes, invitations' },
    { key: 'billing_alerts', label: 'Billing alerts', desc: 'Payment failures, plan changes, renewals' },
    { key: 'weekly_digest', label: 'Weekly digest', desc: 'Summary of your activity every Monday' },
    { key: 'marketing_emails', label: 'Product updates', desc: 'New features, tips, and announcements' },
  ];

  // ── Billing tab ──────────────────────────────────────────────────────────
  const [billing, setBilling] = useState<BillingSummary | null>(null);
  const [loadingBilling, setLoadingBilling] = useState(false);

  // ── API keys state ──
  type ApiKeyRow = { id: string; name: string; key_prefix: string; created_at: string; last_used_at: string | null; revoked_at: string | null };
  const [apiKeys, setApiKeys] = useState<ApiKeyRow[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [creatingKey, setCreatingKey] = useState(false);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [keyMsg, setKeyMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [copiedSnippet, setCopiedSnippet] = useState(false);
  const trackingSnippet = `<script async src="${API_BASE_URL}/t.js?u=${currentUser?.id ?? ''}"></script>`;

  const loadApiKeys = async () => {
    setLoadingKeys(true);
    try {
      const r = await fetch(`${API_BASE_URL}/api/keys`, { headers: authHdr() });
      const j = await safeJson<{ success: boolean; keys: ApiKeyRow[] }>(r);
      if (j?.success) setApiKeys(j.keys);
    } finally {
      setLoadingKeys(false);
    }
  };

  useEffect(() => {
    if (tab === 'apikeys') void loadApiKeys();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const createApiKey = async () => {
    setCreatingKey(true);
    setKeyMsg(null);
    setCreatedSecret(null);
    try {
      const r = await fetch(`${API_BASE_URL}/api/keys`, {
        method: 'POST',
        headers: { ...authHdr(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newKeyName.trim() || 'API key' }),
      });
      const j = await safeJson<{ success: boolean; key?: { secret: string }; error?: string }>(r);
      if (!j?.success || !j.key) throw new Error(j?.error || 'Failed to create key');
      setCreatedSecret(j.key.secret);
      setNewKeyName('');
      void loadApiKeys();
    } catch (err) {
      setKeyMsg({ ok: false, text: err instanceof Error ? err.message : 'Failed to create key' });
    } finally {
      setCreatingKey(false);
    }
  };

  const revokeApiKey = async (id: string) => {
    if (!window.confirm('Revoke this API key? Integrations using it will stop working immediately.')) return;
    const r = await fetch(`${API_BASE_URL}/api/keys/${id}`, { method: 'DELETE', headers: authHdr() });
    const j = await safeJson<{ success: boolean; error?: string }>(r);
    if (j?.success) {
      setKeyMsg({ ok: true, text: 'Key revoked.' });
      void loadApiKeys();
    } else {
      setKeyMsg({ ok: false, text: j?.error || 'Failed to revoke key' });
    }
  };

  // ── Dakyworld OS Bridge state ──
  const [osManifest, setOsManifest] = useState<{ version?: string; credits?: number; agents?: any[] } | null>(null);
  const [osWebhooks, setOsWebhooks] = useState<Array<{ id: string; url: string; events: string; active: boolean; created_at: string }>>([]);
  const [newWebhookUrl, setNewWebhookUrl] = useState('');
  const [createdWebhookSecret, setCreatedWebhookSecret] = useState<string | null>(null);
  const [osCopiedEndpoint, setOsCopiedEndpoint] = useState<string | null>(null);

  const loadOsBridge = async () => {
    try {
      const [mRes, wRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/v1/os/manifest`, { headers: authHdr() }),
        fetch(`${API_BASE_URL}/api/v1/os/webhooks`, { headers: authHdr() }),
      ]);
      const mJson = await safeJson<{ success: boolean; version: string; credits: number; agents: any[] }>(mRes);
      const wJson = await safeJson<{ success: boolean; webhooks: any[] }>(wRes);
      if (mJson?.success) setOsManifest(mJson);
      if (wJson?.success) setOsWebhooks(wJson.webhooks ?? []);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (tab === 'apikeys') void loadOsBridge();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const registerOsWebhook = async () => {
    if (!newWebhookUrl.trim()) return;
    setCreatedWebhookSecret(null);
    try {
      const r = await fetch(`${API_BASE_URL}/api/v1/os/webhooks`, {
        method: 'POST',
        headers: { ...authHdr(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: newWebhookUrl.trim(), events: ['post.published', 'agent.completed', 'lead.captured', 'credit.low'] }),
      });
      const j = await safeJson<{ success: boolean; webhook?: { signingSecret: string } }>(r);
      if (j?.success && j.webhook) {
        setCreatedWebhookSecret(j.webhook.signingSecret);
        setNewWebhookUrl('');
        void loadOsBridge();
      }
    } catch {
      /* ignore */
    }
  };

  const deleteOsWebhook = async (id: string) => {
    await fetch(`${API_BASE_URL}/api/v1/os/webhooks/${id}`, { method: 'DELETE', headers: authHdr() }).catch(() => undefined);
    void loadOsBridge();
  };

  const [creditInfo, setCreditInfo] = useState<{ credits: number; reset_date: string | null } | null>(null);
  const [creditHistory, setCreditHistory] = useState<Array<{ delta: number; reason: string; created_at: string }>>([]);

  useEffect(() => {
    if (tab !== 'billing') return;
    fetch(`${API_BASE_URL}/api/credits/balance`, { headers: authHdr() })
      .then((r) => r.json())
      .then((d: { success?: boolean; credits?: number; reset_date?: string | null }) => {
        if (d?.success) setCreditInfo({ credits: d.credits ?? 0, reset_date: d.reset_date ?? null });
      })
      .catch(() => undefined);
    fetch(`${API_BASE_URL}/api/credits/history`, { headers: authHdr() })
      .then((r) => r.json())
      .then((d: { success?: boolean; entries?: Array<{ delta: number; reason: string; created_at: string }> }) => {
        if (d?.success && Array.isArray(d.entries)) setCreditHistory(d.entries);
      })
      .catch(() => undefined);
  }, [tab]);

  useEffect(() => {
    if (tab !== 'billing') return;
    setLoadingBilling(true);
    fetch(`${API_BASE_URL}/api/v1/billing/subscription`, { headers: authHdr() })
      .then((r) => r.json())
      .then((d: { plan?: { name?: string }; subscription?: { status?: string; current_period_end?: string }; usage?: { posts_this_period?: number; posts_limit?: number } }) => {
        setBilling({
          plan_name: d.plan?.name ?? 'Free Plan',
          status: d.subscription?.status ?? 'active',
          posts_this_period: d.usage?.posts_this_period ?? 0,
          posts_limit: d.usage?.posts_limit ?? 0,
          current_period_end: d.subscription?.current_period_end ?? null,
        });
      })
      .catch(() => undefined)
      .finally(() => setLoadingBilling(false));
  }, [tab]);

  // ── render ────────────────────────────────────────────────────────────────

  const TABS = [
    { id: 'account', label: 'Account', icon: User },
    { id: 'security', label: 'Security', icon: Shield },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'billing', label: 'Billing', icon: CreditCard },
    { id: 'apikeys', label: 'API Keys', icon: KeyRound },
  ] as const;

  const inputCls = 'h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition';
  const msgCls = (ok: boolean) => `mt-3 rounded-xl border px-4 py-2.5 text-sm ${ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`;

  return (
    <div className="pb-10">
      {/* header */}
      <div className="mb-6">
        <h1 className="text-4xl font-black tracking-[-0.04em] text-slate-950">Settings</h1>
        <p className="mt-2 text-base text-slate-500">Manage your account, security, and preferences.</p>
      </div>

      {/* tab bar */}
      <div className="mb-6 flex gap-1 rounded-2xl border border-slate-200 bg-white p-1.5">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition-colors ${tab === id ? 'bg-slate-950 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
          >
            <Icon size={14} />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {/* ── Account ── */}
      {tab === 'account' && (
        <form onSubmit={(e) => void saveProfile(e)} className="space-y-5">
          {/* cover + avatar */}
          <SectionCard className="p-0 overflow-hidden">
            <div className="relative h-40">
              <div
                className="absolute inset-0"
                style={form.cover
                  ? { backgroundImage: `url("${form.cover}")`, backgroundSize: 'cover', backgroundPosition: 'center' }
                  : { backgroundImage: defaultCover }}
              />
              <div className="absolute inset-0 bg-black/10" />
              <button
                type="button"
                onClick={() => coverRef.current?.click()}
                className="absolute right-4 top-4 inline-flex items-center gap-1.5 rounded-xl bg-white/90 px-3 py-1.5 text-xs font-semibold text-slate-800 backdrop-blur"
              >
                <ImageIcon size={13} />
                {uploadingField === 'cover' ? 'Uploading…' : 'Change cover'}
              </button>
              <input ref={coverRef} type="file" accept="image/*" onChange={(e) => void handleImageUpload(e, 'cover')} className="hidden" />
            </div>
            <div className="px-6 pb-6">
              <div className="-mt-12 flex items-end gap-4">
                <div className="relative h-24 w-24 shrink-0 rounded-full border-4 border-white bg-slate-100 shadow">
                  {form.avatar
                    ? <img src={form.avatar} alt={form.name} className="h-full w-full rounded-full object-cover" />
                    : <div className="flex h-full w-full items-center justify-center rounded-full text-slate-400"><User size={30} /></div>
                  }
                  <button
                    type="button"
                    onClick={() => avatarRef.current?.click()}
                    className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-slate-950 text-white"
                  >
                    <Camera size={14} />
                  </button>
                  <input ref={avatarRef} type="file" accept="image/*" onChange={(e) => void handleImageUpload(e, 'avatar')} className="hidden" />
                </div>
                <div className="pb-1">
                  <p className="text-lg font-black text-slate-950">{form.name || 'Your name'}</p>
                  <p className="text-sm text-slate-500">@{form.username || 'username'}</p>
                </div>
              </div>
            </div>
          </SectionCard>

          {/* fields */}
          <SectionCard>
            <h2 className="mb-4 text-lg font-black text-slate-950">Personal information</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {([
                { key: 'name', label: 'Full name', type: 'text' },
                { key: 'username', label: 'Username', type: 'text' },
                { key: 'email', label: 'Email address', type: 'email' },
                { key: 'phone', label: 'Phone number', type: 'tel' },
                { key: 'country', label: 'Country', type: 'text' },
                { key: 'website', label: 'Website', type: 'url' },
              ] as { key: keyof ProfileForm; label: string; type: string }[]).map(({ key, label, type }) => (
                <label key={key} className="block space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">{label}</span>
                  <input
                    type={type}
                    value={form[key]}
                    onChange={(e) => setField(key, e.target.value)}
                    className={inputCls}
                  />
                </label>
              ))}
            </div>
            <label className="mt-4 block space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">Bio</span>
              <textarea
                rows={4}
                value={form.bio}
                onChange={(e) => setField('bio', e.target.value)}
                placeholder="Tell your audience what you do…"
                className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition"
              />
            </label>
            {profileMsg && <p className={msgCls(profileMsg.ok)}>{profileMsg.text}</p>}
          </SectionCard>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={savingProfile || uploadingField !== null}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-6 py-2.5 text-sm font-bold text-white disabled:opacity-50"
            >
              {savingProfile ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {savingProfile ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      )}

      {/* ── Security ── */}
      {tab === 'security' && (
        <div className="space-y-5">
          <SectionCard>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-100">
                <KeyRound size={16} className="text-indigo-600" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900">Change password</p>
                <p className="text-xs text-slate-500">Use a strong password you don't use elsewhere</p>
              </div>
            </div>
            <form onSubmit={(e) => void changePassword(e)} className="space-y-3">
              {([
                { label: 'Current password', val: currentPw, set: setCurrentPw },
                { label: 'New password', val: newPw, set: setNewPw },
                { label: 'Confirm new password', val: confirmPw, set: setConfirmPw },
              ] as { label: string; val: string; set: (v: string) => void }[]).map(({ label, val, set }) => (
                <label key={label} className="block space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">{label}</span>
                  <div className="relative">
                    <input
                      type={showPw ? 'text' : 'password'}
                      value={val}
                      onChange={(e) => { set(e.target.value); setPwMsg(null); }}
                      className={`${inputCls} pr-10`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                    >
                      {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </label>
              ))}
              {pwMsg && <p className={msgCls(pwMsg.ok)}>{pwMsg.text}</p>}
              <button
                type="submit"
                disabled={changingPw || !currentPw || !newPw || !confirmPw}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              >
                {changingPw ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {changingPw ? 'Updating…' : 'Update password'}
              </button>
            </form>
          </SectionCard>

          {/* danger zone */}
          <SectionCard className="border-red-200">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-100">
                <Trash2 size={16} className="text-red-600" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900">Delete account</p>
                <p className="text-xs text-slate-500">Permanently remove your account and all data</p>
              </div>
            </div>
            <p className="mb-4 text-sm text-slate-600 leading-relaxed">
              Once deleted, all your posts, designs, integrations, and billing history will be gone. This action is irreversible.
            </p>
            <a
              href="/data-deletion"
              onClick={(e) => {
                e.preventDefault();
                window.history.pushState({}, '', '/data-deletion');
                window.dispatchEvent(new PopStateEvent('popstate'));
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-5 py-2.5 text-sm font-bold text-red-700 hover:bg-red-100 transition-colors"
            >
              <Trash2 size={14} /> Request account deletion
            </a>
          </SectionCard>
        </div>
      )}

      {/* ── Notifications ── */}
      {tab === 'notifications' && (
        <div className="space-y-5">
          <SectionCard>
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-100">
                <Bell size={16} className="text-indigo-600" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900">Email notifications</p>
                <p className="text-xs text-slate-500">Choose which emails you receive</p>
              </div>
            </div>
            {loadingNotifs
              ? <div className="flex items-center justify-center py-8"><Loader2 size={20} className="animate-spin text-slate-300" /></div>
              : (
                <div className="divide-y divide-slate-100">
                  {NOTIF_ROWS.map(({ key, label, desc }) => (
                    <div key={key} className="flex items-center justify-between py-4">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{label}</p>
                        <p className="text-xs text-slate-500">{desc}</p>
                      </div>
                      <Toggle
                        checked={notifs[key]}
                        onChange={(v) => setNotifs((p) => ({ ...p, [key]: v }))}
                      />
                    </div>
                  ))}
                </div>
              )
            }
            {notifMsg && <p className={msgCls(notifMsg.ok)}>{notifMsg.text}</p>}
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => void saveNotifs()}
                disabled={savingNotifs || loadingNotifs}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              >
                {savingNotifs ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {savingNotifs ? 'Saving…' : 'Save preferences'}
              </button>
            </div>
          </SectionCard>
        </div>
      )}

      {/* ── Billing ── */}
      {tab === 'billing' && (
        <div className="space-y-5">
          <SectionCard>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-100">
                <CreditCard size={16} className="text-indigo-600" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900">Current plan</p>
                <p className="text-xs text-slate-500">Your subscription and usage</p>
              </div>
            </div>

            {loadingBilling
              ? <div className="flex items-center justify-center py-8"><Loader2 size={20} className="animate-spin text-slate-300" /></div>
              : billing
                ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-5 py-4">
                      <div>
                        <p className="text-xl font-black text-slate-950">{billing.plan_name}</p>
                        <p className="mt-0.5 text-xs font-semibold capitalize text-slate-500">{billing.status}</p>
                      </div>
                      {billing.current_period_end && (
                        <p className="text-right text-xs text-slate-400">
                          Renews<br />
                          <span className="font-semibold text-slate-700">
                            {new Date(billing.current_period_end).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                          </span>
                        </p>
                      )}
                    </div>

                    {billing.posts_limit > 0 && (
                      <div>
                        <div className="mb-1.5 flex items-center justify-between text-xs font-semibold text-slate-500">
                          <span>Posts this period</span>
                          <span>{billing.posts_this_period} / {billing.posts_limit}</span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-2 rounded-full bg-indigo-600 transition-all"
                            style={{ width: `${Math.min(100, (billing.posts_this_period / billing.posts_limit) * 100)}%` }}
                          />
                        </div>
                      </div>
                    )}

                    <div className="flex gap-3 pt-1">
                      <button
                        type="button"
                        onClick={onNavigateToBilling}
                        className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 transition-colors"
                      >
                        <CreditCard size={14} /> Manage billing
                      </button>
                    </div>
                  </div>
                )
                : (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-4">
                    <p className="text-sm font-black text-slate-950">Free Plan</p>
                    <p className="mt-1 text-xs text-slate-500">Upgrade to unlock more posts, team members, and integrations.</p>
                    <button
                      type="button"
                      onClick={onNavigateToBilling}
                      className="mt-3 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 transition-colors"
                    >
                      View plans
                    </button>
                  </div>
                )
            }
          </SectionCard>

          <SectionCard>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100">
                <Sparkles size={16} className="text-amber-600" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900">AI credits</p>
                <p className="text-xs text-slate-500">Powers AI chat, agents, and automations · resets monthly with your plan</p>
              </div>
            </div>
            {creditInfo ? (
              <>
                <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-5 py-4">
                  <p className="text-2xl font-black text-slate-950">{creditInfo.credits.toLocaleString()} <span className="text-sm font-semibold text-slate-400">credits</span></p>
                  {creditInfo.reset_date && (
                    <p className="text-right text-xs text-slate-400">
                      Resets<br />
                      <span className="font-semibold text-slate-700">{new Date(creditInfo.reset_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                    </p>
                  )}
                </div>
                {creditHistory.length > 0 && (
                  <div className="mt-4">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Recent activity</p>
                    <div className="divide-y divide-slate-100">
                      {creditHistory.slice(0, 8).map((e, i) => (
                        <div key={i} className="flex items-center justify-between py-2">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold text-slate-700">{e.reason.replace(/_/g, ' ')}</p>
                            <p className="text-[11px] text-slate-400">{new Date(e.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                          </div>
                          <span className={`shrink-0 text-xs font-black ${e.delta < 0 ? 'text-slate-500' : 'text-emerald-600'}`}>
                            {e.delta > 0 ? '+' : ''}{e.delta}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-center justify-center py-6"><Loader2 size={18} className="animate-spin text-slate-300" /></div>
            )}
          </SectionCard>
        </div>
      )}

      {/* ── API Keys ── */}
      {tab === 'apikeys' && (
        <div className="space-y-5">
          <SectionCard>
            <h2 className="text-lg font-black text-slate-950">API Keys</h2>
            <p className="mt-1 text-sm text-slate-500">
              Trigger your automations and add contacts from external tools. Send a POST request to{' '}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-700">{API_BASE_URL}/api/v1/trigger</code>{' '}
              with your key as a Bearer token and a JSON body like{' '}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-700">{'{ "event": "api", "email": "lead@example.com", "tags": ["webinar"] }'}</code>.
            </p>

            <div className="mt-5 flex gap-3">
              <input
                type="text"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="Key name (e.g. Zapier, my website form)"
                className={inputCls}
              />
              <button
                type="button"
                onClick={() => void createApiKey()}
                disabled={creatingKey}
                className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 transition-colors disabled:opacity-50"
              >
                {creatingKey ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />} Create key
              </button>
            </div>

            {createdSecret && (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-amber-700">Copy your key now — it won't be shown again</p>
                <div className="mt-2 flex items-center gap-2">
                  <code className="flex-1 overflow-x-auto rounded-lg bg-white px-3 py-2 text-xs font-semibold text-slate-800 border border-amber-200">{createdSecret}</code>
                  <button
                    type="button"
                    onClick={() => { void navigator.clipboard.writeText(createdSecret); setCopiedSecret(true); setTimeout(() => setCopiedSecret(false), 2000); }}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-slate-950 px-3 py-2 text-xs font-bold text-white"
                  >
                    {copiedSecret ? <Check size={12} /> : null} {copiedSecret ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            )}

            {keyMsg && <div className={msgCls(keyMsg.ok)}>{keyMsg.text}</div>}

            <div className="mt-5 divide-y divide-slate-100">
              {loadingKeys && <p className="py-4 text-sm text-slate-400">Loading keys…</p>}
              {!loadingKeys && apiKeys.length === 0 && (
                <p className="py-4 text-sm text-slate-400">No API keys yet. Create one to connect external tools.</p>
              )}
              {apiKeys.map((k) => (
                <div key={k.id} className="flex items-center gap-3 py-3">
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-bold ${k.revoked_at ? 'text-slate-400 line-through' : 'text-slate-900'}`}>{k.name}</p>
                    <p className="text-xs text-slate-400">
                      {k.key_prefix} · created {new Date(k.created_at).toLocaleDateString()}
                      {k.last_used_at ? ` · last used ${new Date(k.last_used_at).toLocaleDateString()}` : ' · never used'}
                      {k.revoked_at ? ' · revoked' : ''}
                    </p>
                  </div>
                  {!k.revoked_at && (
                    <button
                      type="button"
                      onClick={() => void revokeApiKey(k.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50"
                    >
                      <Trash2 size={12} /> Revoke
                    </button>
                  )}
                </div>
              ))}
            </div>
          </SectionCard>

          {/* ── Dakyworld OS Bridge Connection Panel ── */}
          <SectionCard className="border-indigo-200 bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-white">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-indigo-500/20 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-indigo-300">
                  <Sparkles size={12} /> Dakyworld OS Bridge API · {osManifest?.version ? `v${osManifest.version}` : 'v1.4.0'}
                </div>
                <h2 className="mt-2 text-lg font-black text-white">Connect Dakyworld Hub to Dakyworld OS</h2>
                <p className="mt-1 text-xs text-slate-300">
                  Authenticate with any <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-indigo-200">cf_live_...</code> API key above as a Bearer token. Includes 300 RPM OS rate limiting, 24h <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-indigo-200">Idempotency-Key</code> protection, and 90% token-optimized batch agent execution.
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-right">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Bridge Status</p>
                <p className="text-sm font-black text-emerald-400">
                  ● ONLINE ({osManifest?.agents?.length ?? 21} Agents Ready)
                </p>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {[
                { method: 'GET', path: '/api/v1/os/manifest', desc: 'Discover 21 agents, connected channels & credit balance' },
                { method: 'GET', path: '/api/v1/os/context', desc: 'Fetch compiled brand memory & shared agent context' },
                { method: 'POST', path: '/api/v1/os/agents/invoke', desc: 'Invoke any agent or Butler tool with JSON output' },
                { method: 'POST', path: '/api/v1/os/generate', desc: 'Generate studio images/videos with credit refund safety' },
                { method: 'POST', path: '/api/v1/os/publish', desc: 'Cross-post or schedule to connected social channels' },
                { method: 'POST', path: '/api/v1/os/memory/sync', desc: 'Bidirectional memory sync with 1-call batch compilation' },
              ].map((ep) => {
                const fullUrl = `${API_BASE_URL}${ep.path}`;
                return (
                  <div key={ep.path} className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-black ${ep.method === 'GET' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-indigo-500/30 text-indigo-200'}`}>
                          {ep.method}
                        </span>
                        <code className="truncate text-xs font-bold text-white">{ep.path}</code>
                      </div>
                      <p className="mt-1 truncate text-[11px] text-slate-400">{ep.desc}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(fullUrl);
                        setOsCopiedEndpoint(ep.path);
                        setTimeout(() => setOsCopiedEndpoint(null), 1800);
                      }}
                      className="shrink-0 rounded-lg bg-white/10 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-white/20"
                    >
                      {osCopiedEndpoint === ep.path ? 'Copied' : 'Copy URL'}
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Outbound OS Webhooks */}
            <div className="mt-5 border-t border-white/10 pt-4">
              <p className="text-xs font-bold uppercase tracking-wider text-indigo-300">Outbound Dakyworld OS Event Webhooks (HMAC-SHA256 Signed)</p>
              <div className="mt-2.5 flex gap-2">
                <input
                  type="url"
                  value={newWebhookUrl}
                  onChange={(e) => setNewWebhookUrl(e.target.value)}
                  placeholder="https://os.dakyworld.com/api/webhooks/hub"
                  className="flex-1 rounded-xl border border-white/15 bg-white/10 px-3.5 py-2 text-xs text-white placeholder-slate-400 focus:border-indigo-400 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void registerOsWebhook()}
                  className="shrink-0 rounded-xl bg-indigo-500 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-400"
                >
                  Add OS Webhook
                </button>
              </div>
              {createdWebhookSecret && (
                <div className="mt-3 rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3 text-xs">
                  <p className="font-bold text-emerald-300">HMAC-SHA256 Signing Secret (Copy now):</p>
                  <code className="mt-1 block break-all font-mono text-white">{createdWebhookSecret}</code>
                </div>
              )}
              {osWebhooks.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {osWebhooks.map((wh) => (
                    <div key={wh.id} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2 text-xs">
                      <code className="truncate text-slate-200">{wh.url}</code>
                      <button
                        type="button"
                        onClick={() => void deleteOsWebhook(wh.id)}
                        className="ml-2 text-red-400 hover:text-red-300 font-bold"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </SectionCard>

          <SectionCard>
            <h2 className="text-lg font-black text-slate-950">Website tracking</h2>
            <p className="mt-1 text-sm text-slate-500">
              Paste this snippet before the closing <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-700">&lt;/body&gt;</code> tag
              on your website. It records page views from contacts who arrive via your tracked email links, powers the
              "Views a page" automation trigger, and shows visits on the contact timeline.
            </p>
            <div className="mt-4 flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-semibold text-slate-800 whitespace-nowrap">
                {trackingSnippet}
              </code>
              <button
                type="button"
                onClick={() => { void navigator.clipboard.writeText(trackingSnippet); setCopiedSnippet(true); setTimeout(() => setCopiedSnippet(false), 2000); }}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-slate-950 px-3 py-2 text-xs font-bold text-white"
              >
                {copiedSnippet ? <Check size={12} /> : null} {copiedSnippet ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-400 leading-relaxed">
              Visitors are matched to contacts automatically when they click a tracked link from your emails or campaigns.
              Anonymous visits are still counted.
            </p>
          </SectionCard>

          <OutboundWebhooksPanel />
        </div>
      )}
    </div>
  );
}
