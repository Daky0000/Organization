import { PlatformLogo } from '../PlatformLogo';
import type { SocialTemplateNetworkConfig } from './networkConfig';

export default function SocialTemplateNetworkTabs({
  networks,
  selectedPlatform,
  onSelectPlatform,
}: {
  networks: SocialTemplateNetworkConfig[];
  selectedPlatform: string;
  onSelectPlatform: (platform: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3">
      <div className="px-2 pb-2 text-xs font-bold uppercase tracking-widest text-slate-400">
        Connected Networks
      </div>

      <div className="space-y-2">
        {networks.map((network) => {
          const isActive = network.platform === selectedPlatform;
          return (
            <button
              key={network.platform}
              type="button"
              onClick={() => onSelectPlatform(network.platform)}
              className={`w-full flex items-center gap-3 rounded-xl px-3 py-2 text-left transition ${
                isActive
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                  isActive ? 'bg-white/10' : 'bg-slate-50'
                }`}
              >
                <PlatformLogo platform={network.platform} size={28} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{network.label}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

