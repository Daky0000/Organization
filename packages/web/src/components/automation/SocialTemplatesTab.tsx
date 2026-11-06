import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Sparkles } from 'lucide-react';
import { socialPostService, type SocialAccount } from '../../services/socialPostService';
import SocialTemplateNetworkTabs from './SocialTemplateNetworkTabs';
import SocialTemplateSettingsPanel from './SocialTemplateSettings';
import { getNetworkConfig, normalizeSocialTemplatePlatform, type SocialTemplateNetworkConfig } from './networkConfig';

type Toast = { type: 'success' | 'error'; message: string } | null;

export default function SocialTemplatesTab() {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlatform, setSelectedPlatform] = useState('');
  const [toast, setToast] = useState<Toast>(null);

  useEffect(() => {
    let canceled = false;
    setLoading(true);

    socialPostService
      .listAccounts()
      .then((accs) => {
        if (canceled) return;
        setAccounts(accs || []);
      })
      .catch(() => {
        if (canceled) return;
        setAccounts([]);
      })
      .finally(() => {
        if (canceled) return;
        setLoading(false);
      });

    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  const networks = useMemo(() => {
    const platforms = Array.from(
      new Set(accounts.map((a) => normalizeSocialTemplatePlatform(a.platform)).filter(Boolean))
    );
    return platforms
      .map((platform) => getNetworkConfig(platform))
      .filter((cfg): cfg is SocialTemplateNetworkConfig => Boolean(cfg));
  }, [accounts]);

  useEffect(() => {
    if (networks.length === 0) {
      setSelectedPlatform('');
      return;
    }

    if (!selectedPlatform || !networks.some((n) => n.platform === selectedPlatform)) {
      setSelectedPlatform(networks[0].platform);
    }
  }, [networks, selectedPlatform]);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-fuchsia-600 text-white">
            <Sparkles size={18} />
          </div>
          <div>
            <div className="text-sm font-bold text-slate-900">Social Templates</div>
            <div className="text-xs text-slate-500">
              Create reusable captions per network for consistent publishing.
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-2 text-sm text-slate-600">
          <div className="flex items-start gap-2">
            <CheckCircle2 size={16} className="text-emerald-500 mt-0.5" />
            <span>
              Use placeholders like <span className="font-mono">{'{title}'}</span>,{' '}
              <span className="font-mono">{'{url}'}</span>, and{' '}
              <span className="font-mono">{'{featured_image}'}</span>.
            </span>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle2 size={16} className="text-emerald-500 mt-0.5" />
            <span>Preview templates against an existing post before saving.</span>
          </div>
        </div>
      </div>

      {toast ? (
        <div
          className={`rounded-2xl border p-4 text-sm font-semibold ${
            toast.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {toast.message}
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 size={20} className="animate-spin mr-2" /> Loading networks…
        </div>
      ) : networks.length === 0 ? (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
          <div className="flex items-start gap-3">
            <AlertCircle size={18} className="text-blue-600 mt-0.5" />
            <div>
              <div className="text-sm font-bold text-blue-900">No connected social accounts</div>
              <div className="text-xs text-blue-800 mt-1">
                Connect at least one social platform in Integrations to configure templates.
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <SocialTemplateNetworkTabs
            networks={networks}
            selectedPlatform={selectedPlatform}
            onSelectPlatform={setSelectedPlatform}
          />

          <SocialTemplateSettingsPanel
            platform={selectedPlatform}
            onSaved={(message) => setToast({ type: 'success', message })}
            onError={(message) => setToast({ type: 'error', message })}
          />
        </div>
      )}
    </div>
  );
}

