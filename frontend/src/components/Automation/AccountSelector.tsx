import React, { useMemo } from "react";
import type { AutomationIntegration } from "../../hooks/useAutomation";

const iconStyles: Record<string, { label: string; bg: string }> = {
  facebook: { label: "F", bg: "bg-blue-500" },
  instagram: { label: "I", bg: "bg-pink-500" },
  twitter: { label: "X", bg: "bg-slate-100 text-slate-900" },
  linkedin: { label: "in", bg: "bg-sky-500" },
  pinterest: { label: "P", bg: "bg-red-500" },
  wordpress: { label: "W", bg: "bg-indigo-500" },
  tiktok: { label: "T", bg: "bg-zinc-200 text-zinc-900" },
};

const statusColors: Record<string, string> = {
  CONNECTED: "bg-emerald-400",
  DISCONNECTED: "bg-slate-400",
  ERROR: "bg-red-400",
  EXPIRED: "bg-red-400",
};

type Props = {
  accounts: AutomationIntegration[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
};

export const AccountSelector: React.FC<Props> = ({
  accounts,
  selectedIds,
  onChange,
}) => {
  const grouped = useMemo(() => {
    const map: Record<string, AutomationIntegration[]> = {};
    accounts.forEach((account) => {
      if (!map[account.platform]) map[account.platform] = [];
      map[account.platform].push(account);
    });
    Object.values(map).forEach((list) => {
      list.sort((a, b) => {
        const timeA = a.lastUsed ? new Date(a.lastUsed).getTime() : 0;
        const timeB = b.lastUsed ? new Date(b.lastUsed).getTime() : 0;
        return timeB - timeA;
      });
    });
    return map;
  }, [accounts]);

  if (!accounts.length) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-300">
        <p>No accounts connected.</p>
        <a href="/integrations" className="mt-2 inline-flex text-indigo-300">
          Go to Integrations
        </a>
      </div>
    );
  }

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((item) => item !== id));
      return;
    }
    onChange([...selectedIds, id]);
  };

  return (
    <div className="space-y-4">
      {Object.entries(grouped).map(([platform, items]) => {
        const icon = iconStyles[platform] || { label: "?", bg: "bg-slate-700" };
        return (
          <div key={platform}>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              {platform}
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {items.map((account) => {
                const status = account.status || "DISCONNECTED";
                const statusColor =
                  statusColors[status] || statusColors.DISCONNECTED;
                const selected = selectedIds.includes(account.id);
                return (
                  <button
                    key={account.id}
                    type="button"
                    onClick={() => toggle(account.id)}
                    className={`flex items-start gap-3 rounded-xl border p-4 text-left transition ${
                      selected
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
                          {account.accountName || "Account"}
                        </p>
                        <span
                          className={`h-2 w-2 rounded-full ${statusColor}`}
                        />
                      </div>
                      <p className="text-xs text-slate-400">
                        {account.accountId
                          ? `ID ${account.accountId}`
                          : "Connected"}
                      </p>
                      <div className="mt-2 text-[11px] text-slate-500">
                        {account.lastUsed
                          ? `Last used ${new Date(
                              account.lastUsed
                            ).toLocaleDateString()}`
                          : "Not used yet"}
                      </div>
                    </div>
                    <div className="pt-1">
                      <input type="checkbox" checked={selected} readOnly />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};
