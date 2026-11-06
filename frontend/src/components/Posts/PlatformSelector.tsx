import React from "react";
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

type Props = {
  integrations: UserIntegration[];
  selected: string[];
  onChange: (ids: string[]) => void;
};

export const PlatformSelector: React.FC<Props> = ({
  integrations,
  selected,
  onChange,
}) => {
  if (!integrations.length) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-300">
        <p>No platforms connected yet.</p>
        <a href="/integrations" className="mt-2 inline-flex text-indigo-300">
          Go to Integrations
        </a>
      </div>
    );
  }

  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter((item) => item !== id));
      return;
    }
    onChange([...selected, id]);
  };

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {integrations.map((integration) => {
        const slug = integration.integration?.slug || "";
        const icon = iconStyles[slug] || { label: "?", bg: "bg-slate-700" };
        const status = integration.status || "DISCONNECTED";
        const statusColor =
          statusColors[status] || statusColors.DISCONNECTED;
        const isSelected = selected.includes(integration.id);

        return (
          <button
            key={integration.id}
            type="button"
            onClick={() => toggle(integration.id)}
            className={`flex items-start gap-3 rounded-xl border p-4 text-left transition ${
              isSelected
                ? "border-indigo-400 bg-indigo-500/10"
                : "border-slate-800 bg-slate-900/60 hover:border-slate-700"
            }`}
          >
            <div
              className={`flex h-[50px] w-[50px] items-center justify-center rounded-2xl text-sm font-semibold ${icon.bg}`}
            >
              {icon.label}
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-100">
                  {integration.integration?.name || "Platform"}
                </p>
                <span className={`h-2 w-2 rounded-full ${statusColor}`} />
              </div>
              <p className="text-xs text-slate-400">
                {integration.accountName || "Primary account"}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
};
