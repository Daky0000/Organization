import React, { useMemo } from "react";
import type { UserIntegration } from "../../hooks/useIntegrations";

const iconStyles: Record<string, { label: string; bg: string }> = {
  facebook: { label: "F", bg: "bg-blue-500" },
  instagram: { label: "I", bg: "bg-pink-500" },
  twitter: { label: "X", bg: "bg-slate-100 text-slate-900" },
  linkedin: { label: "in", bg: "bg-sky-500" },
  pinterest: { label: "P", bg: "bg-red-500" },
  wordpress: { label: "W", bg: "bg-indigo-500" },
};

const statusColors: Record<string, string> = {
  CONNECTED: "bg-emerald-400",
  DISCONNECTED: "bg-slate-400",
  ERROR: "bg-red-400",
  EXPIRED: "bg-red-400",
};

type PanelIntegration = {
  id: string;
  platform: string;
  accountName?: string | null;
  status?: string | null;
  lastUsed?: string | null;
};

type Props = {
  postId?: string | null;
  selectedIntegrationIds: string[];
  availableIntegrations:
    | Record<string, PanelIntegration[]>
    | UserIntegration[]
    | null
    | undefined;
  onChange: (integrationIds: string[]) => void;
  onConnect: () => void;
};

const formatLastUsed = (value?: string | null) => {
  if (!value) return "No posts yet";
  const diff = Date.now() - new Date(value).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (Number.isNaN(days) || days < 0) return "No posts yet";
  if (days === 0) return "Last posted today";
  if (days === 1) return "Last posted 1 day ago";
  return `Last posted ${days} days ago`;
};

export const PlatformSelectionPanel: React.FC<Props> = ({
  selectedIntegrationIds,
  availableIntegrations,
  onChange,
  onConnect,
}) => {
  const grouped = useMemo(() => {
    if (!availableIntegrations) return {} as Record<string, PanelIntegration[]>;
    if (Array.isArray(availableIntegrations)) {
      const mapped: Record<string, PanelIntegration[]> = {};
      availableIntegrations.forEach((integration) => {
        const platform = integration.integration?.slug || "unknown";
        if (!mapped[platform]) mapped[platform] = [];
        mapped[platform].push({
          id: integration.id,
          platform,
          accountName: integration.accountName,
          status: integration.status,
          lastUsed: integration.lastUsed ?? null,
        });
      });
      return mapped;
    }
    return availableIntegrations;
  }, [availableIntegrations]);

  const totalIntegrations = Object.values(grouped).reduce(
    (total, items) => total + items.length,
    0
  );

  if (!totalIntegrations) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-300">
        <p>No platforms connected yet.</p>
        <button
          type="button"
          onClick={onConnect}
          className="mt-3 inline-flex rounded-lg border border-indigo-400 px-3 py-2 text-xs text-indigo-200"
        >
          + Connect Your First Platform
        </button>
      </div>
    );
  }

  const toggle = (id: string) => {
    if (selectedIntegrationIds.includes(id)) {
      onChange(selectedIntegrationIds.filter((item) => item !== id));
      return;
    }
    onChange([...selectedIntegrationIds, id]);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-300">POST TO</p>
            <p className="text-xs text-slate-500">Select platforms to post to</p>
          </div>
          <span className="text-xs text-slate-400">
            {selectedIntegrationIds.length} selected
          </span>
        </div>

        <div className="mt-4 space-y-4">
          {Object.entries(grouped).map(([platform, items]) => (
            <div key={platform} className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                {platform}
              </p>
              <div className="space-y-2">
                {items.map((integration) => {
                  const icon =
                    iconStyles[platform] || { label: "?", bg: "bg-slate-700" };
                  const status = integration.status || "DISCONNECTED";
                  const statusColor =
                    statusColors[status] || statusColors.DISCONNECTED;
                  const checked = selectedIntegrationIds.includes(integration.id);

                  return (
                    <label
                      key={integration.id}
                      className={`flex items-start gap-3 rounded-xl border p-3 transition ${
                        checked
                          ? "border-indigo-400 bg-indigo-500/10"
                          : "border-slate-800 bg-slate-950/40 hover:border-slate-700"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 accent-indigo-500"
                        checked={checked}
                        onChange={() => toggle(integration.id)}
                      />
                      <div
                        className={`flex h-8 w-8 items-center justify-center rounded-xl text-xs font-semibold ${icon.bg}`}
                      >
                        {icon.label}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold text-slate-100">
                            {integration.accountName || "Primary account"}
                          </p>
                          <span className={`h-2 w-2 rounded-full ${statusColor}`} />
                        </div>
                        <p className="text-xs text-slate-400">
                          {formatLastUsed(integration.lastUsed)}
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
          <span>You have {totalIntegrations} connected</span>
          <button
            type="button"
            onClick={onConnect}
            className="text-indigo-300"
          >
            + Connect More Platforms
          </button>
        </div>
      </div>
    </div>
  );
};

