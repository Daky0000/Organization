import { useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Loader2, Save } from 'lucide-react';
import { API_BASE_URL } from '../../utils/apiBase';

type PlatformConfig = {
  platform: string;
  config: Record<string, string>;
  enabled: boolean;
  updated_at: string | null;
};

function authHeaders() {
  return {
    Authorization: `Bearer ${localStorage.getItem('auth_token') ?? ''}`,
    'Content-Type': 'application/json',
  };
}

const PLATFORM_FIELDS: Record<string, { key: string; label: string; secret?: boolean; placeholder?: string }[]> = {
  app: [
    { key: 'appName', label: 'App Name', placeholder: 'My SaaS' },
    { key: 'appUrl', label: 'App URL', placeholder: 'https://myapp.com' },
    { key: 'supportEmail', label: 'Support Email', placeholder: 'support@myapp.com' },
  ],
};

const PLATFORM_LABELS: Record<string, string> = {
  app: 'App Settings',
};


function PlatformCard({
  config,
  onSave,
}: {
  config: PlatformConfig;
  onSave: (platform: string, values: Record<string, string>, enabled: boolean) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(config.config);
  const [enabled, setEnabled] = useState(config.enabled);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const fields = PLATFORM_FIELDS[config.platform] ?? Object.keys(config.config).map((k) => ({ key: k, label: k }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(config.platform, values, enabled);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-5 py-4 hover:bg-slate-50"
      >
        <div className="flex items-center gap-3">
          <span className={`h-2 w-2 rounded-full ${config.enabled ? 'bg-emerald-500' : 'bg-slate-300'}`} />
          <span className="text-sm font-bold text-slate-900">
            {PLATFORM_LABELS[config.platform] ?? config.platform}
          </span>
          {config.updated_at && (
            <span className="text-xs text-slate-400">
              Updated {new Date(config.updated_at).toLocaleDateString()}
            </span>
          )}
        </div>
        {open ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
      </button>

      {open && (
        <div className="border-t border-slate-100 px-5 pb-5 pt-4 space-y-4">
          {/* Enabled toggle */}
          <label className="flex items-center gap-3 cursor-pointer">
            <div
              onClick={() => setEnabled((e) => !e)}
              className={`relative h-5 w-9 rounded-full transition-colors ${enabled ? 'bg-indigo-600' : 'bg-slate-200'}`}
            >
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </div>
            <span className="text-sm font-medium text-slate-700">Enabled</span>
          </label>

          {/* Fields */}
          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map((f) => (
              <div key={f.key}>
                <label className="mb-1 block text-xs font-semibold text-slate-500">{f.label}</label>
                <input
                  type={f.secret ? 'password' : 'text'}
                  value={values[f.key] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  placeholder={f.placeholder ?? ''}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400"
                  autoComplete="off"
                />
              </div>
            ))}
          </div>

          <div className="flex justify-end">
            <button
              onClick={() => void handleSave()}
              disabled={saving}
              className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : <Save size={14} />}
              {saved ? 'Saved!' : 'Save'}
            </button>
          </div>

        </div>
      )}
    </div>
  );
}

export default function AdminPlatformSettings() {
  const [configs, setConfigs] = useState<PlatformConfig[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/platform-configs`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      if (data.success) {
        const known = ['app'];
        const existing = new Map<string, PlatformConfig>(
          (data.configs as PlatformConfig[]).map((c) => [c.platform, c])
        );
        for (const p of known) {
          if (!existing.has(p)) {
            existing.set(p, { platform: p, config: {}, enabled: false, updated_at: null });
          }
        }
        setConfigs(Array.from(existing.values()));
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const handleSave = async (platform: string, values: Record<string, string>, enabled: boolean) => {
    await fetch(`${API_BASE_URL}/api/admin/platform-configs/${platform}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({ config: values, enabled }),
    });
    await load();
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20 text-slate-400">
        <Loader2 size={22} className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-black tracking-tight text-slate-950">App Settings</h2>
        <p className="text-sm text-slate-500">
          Global app metadata — name, URL, and support email used across emails and notifications.
          Email and payment integrations are configured under <strong>Integrations</strong>.
        </p>
      </div>

      <div className="space-y-3">
        {configs.map((c) => (
          <PlatformCard key={c.platform} config={c} onSave={handleSave} />
        ))}
      </div>
    </div>
  );
}
