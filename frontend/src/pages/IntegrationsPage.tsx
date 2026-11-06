import React, { useEffect, useMemo, useState } from "react";
import { useIntegrations } from "../hooks/useIntegrations";
import type {
  Integration,
  IntegrationLog,
  UserIntegration,
} from "../hooks/useIntegrations";
import { Toast } from "../components/ui/Toast";
import { Modal } from "../components/ui/Modal";

const DEFAULT_PLATFORMS: Array<Integration & { description: string }> = [
  {
    id: "facebook",
    name: "Facebook",
    slug: "facebook",
    type: "social",
    description: "Share posts, pages, and reels with your audience.",
  },
  {
    id: "instagram",
    name: "Instagram",
    slug: "instagram",
    type: "social",
    description: "Publish captions and media to your feed.",
  },
  {
    id: "twitter",
    name: "Twitter",
    slug: "twitter",
    type: "social",
    description: "Post updates and threads with scheduling control.",
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    slug: "linkedin",
    type: "social",
    description: "Share updates with your professional network.",
  },
  {
    id: "pinterest",
    name: "Pinterest",
    slug: "pinterest",
    type: "social",
    description: "Publish pins to boards and track performance.",
  },
  {
    id: "wordpress",
    name: "WordPress",
    slug: "wordpress",
    type: "cms",
    description: "Publish posts and pages to your CMS instantly.",
  },
];

const iconStyles: Record<string, string> = {
  facebook: "bg-blue-500",
  instagram: "bg-pink-500",
  twitter: "bg-slate-100 text-slate-900",
  linkedin: "bg-sky-500",
  pinterest: "bg-red-500",
  wordpress: "bg-indigo-500",
};

const statusLabel = (status: string) => {
  if (status === "CONNECTED") return "Connected";
  if (status === "ERROR" || status === "EXPIRED") return "Error";
  return "Disconnected";
};

const statusColor = (status: string) => {
  if (status === "CONNECTED") return "bg-emerald-400";
  if (status === "ERROR" || status === "EXPIRED") return "bg-red-400";
  return "bg-slate-400";
};

const GearIcon = () => (
  <svg
    viewBox="0 0 24 24"
    className="h-4 w-4"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M11.1 2.3a1 1 0 0 1 1.8 0l.5 1a1 1 0 0 0 .7.5l1.1.2a1 1 0 0 1 .6 1.6l-.7.8a1 1 0 0 0-.2.8l.2 1.1a1 1 0 0 1-1.2 1.2l-1.1-.2a1 1 0 0 0-.8.2l-.8.7a1 1 0 0 1-1.6-.6l-.2-1.1a1 1 0 0 0-.5-.7l-1-.5a1 1 0 0 1 0-1.8l1-.5a1 1 0 0 0 .5-.7l.2-1.1a1 1 0 0 1 .6-.6l1.1-.2a1 1 0 0 0 .7-.5l.5-1Z"
    />
    <circle cx="12" cy="12" r="3.5" />
  </svg>
);

export const IntegrationsPage: React.FC = () => {
  const {
    integrations,
    myIntegrations,
    error,
    getIntegrations,
    getMyIntegrations,
    getAuthUrl,
    disconnectIntegration,
    getAccounts,
    getLogs,
  } = useIntegrations();

  const [activeTab, setActiveTab] = useState<"cms" | "social">("social");
  const [toast, setToast] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [connectingSlug, setConnectingSlug] = useState<string | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const [manageIntegration, setManageIntegration] = useState<Integration | null>(
    null
  );
  const [manageAccounts, setManageAccounts] = useState<UserIntegration[]>([]);
  const [manageLogs, setManageLogs] = useState<IntegrationLog[]>([]);
  const [manageLoading, setManageLoading] = useState(false);
  const [manageError, setManageError] = useState<string | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState<string | null>(null);

  const platformList = integrations.length
    ? integrations.map((platform) => {
        const fallback = DEFAULT_PLATFORMS.find(
          (item) => item.slug === platform.slug
        );
        return {
          ...platform,
          description: platform.description || fallback?.description || "",
        };
      })
    : DEFAULT_PLATFORMS;

  const groupedIntegrations = useMemo(() => {
    const grouped = new Map<string, UserIntegration[]>();
    myIntegrations.forEach((item) => {
      const key = item.integration?.slug || item.integrationId;
      const list = grouped.get(key) || [];
      list.push(item);
      grouped.set(key, list);
    });
    return grouped;
  }, [myIntegrations]);

  useEffect(() => {
    getIntegrations();
    getMyIntegrations();
  }, [getIntegrations, getMyIntegrations]);

  useEffect(() => {
    const interval = setInterval(() => {
      getMyIntegrations();
    }, 15000);
    return () => clearInterval(interval);
  }, [getMyIntegrations]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("status");
    const connected = params.get("connected");
    const message = params.get("message");

    if (connected || status === "success") {
      setToast({ type: "success", message: "Connected successfully" });
      getMyIntegrations();
    } else if (status) {
      setToast({ type: "error", message: message || "Connection failed" });
    }

    if (status || connected) {
      window.history.replaceState({}, "", "/integrations");
    }
  }, [getMyIntegrations]);

  const handleConnect = async (slug: string) => {
    try {
      setConnectingSlug(slug);
      const result = await getAuthUrl(slug);
      if (result?.authUrl) {
        window.location.href = result.authUrl;
      }
    } catch (err: any) {
      setToast({
        type: "error",
        message: err?.response?.data?.error || "Failed to connect",
      });
    } finally {
      setConnectingSlug(null);
    }
  };

  const openManageModal = async (
    platform: Integration,
    accountIntegrationId: string,
    integrationId?: string
  ) => {
    setManageIntegration(platform);
    setManageAccounts([]);
    setManageLogs([]);
    setManageError(null);
    setManageLoading(true);
    setManageOpen(true);

    try {
      const accounts = await getAccounts(accountIntegrationId);
      setManageAccounts(accounts || []);
      if (integrationId) {
        const logs = await getLogs(integrationId);
        setManageLogs(logs || []);
      }
    } catch (err: any) {
      setManageError(
        err?.response?.data?.error || "Unable to load integration details"
      );
    } finally {
      setManageLoading(false);
    }
  };

  const handleDisconnect = async (integrationId: string) => {
    try {
      await disconnectIntegration(integrationId);
      await getMyIntegrations();
    } catch (err: any) {
      setToast({
        type: "error",
        message: err?.response?.data?.error || "Disconnect failed",
      });
    }
  };

  const filteredPlatforms = platformList.filter(
    (platform) => platform.type === activeTab
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold">Connected Integrations</h1>
            <p className="text-sm text-slate-400">
              Connect your social media and CMS platforms
            </p>
          </div>
        </div>

        {toast && (
          <div className="mt-6">
            <Toast
              message={toast.message}
              variant={toast.type}
              onClose={() => setToast(null)}
            />
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="mt-8 flex gap-3">
          <button
            type="button"
            onClick={() => setActiveTab("social")}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${
              activeTab === "social"
                ? "bg-indigo-500 text-white"
                : "bg-slate-900/60 text-slate-300"
            }`}
          >
            Social Media
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("cms")}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${
              activeTab === "cms"
                ? "bg-indigo-500 text-white"
                : "bg-slate-900/60 text-slate-300"
            }`}
          >
            CMS Platforms
          </button>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {filteredPlatforms.map((platform) => {
            const group = groupedIntegrations.get(platform.slug) || [];
            const status = group.length
              ? group[0].status || "DISCONNECTED"
              : "DISCONNECTED";
            const displayStatus = group.some(
              (item) => item.status === "ERROR" || item.status === "EXPIRED"
            )
              ? "ERROR"
              : group.some((item) => item.status === "CONNECTED")
                ? "CONNECTED"
                : status;

            const primaryAccount = group[0]?.accountName;
            const iconStyle = iconStyles[platform.slug] || "bg-slate-700";
            const manageId = group[0]?.id;
            const integrationId = group[0]?.integration?.id;

            return (
              <div
                key={platform.slug}
                className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5"
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`flex h-[50px] w-[50px] items-center justify-center rounded-2xl text-sm font-semibold ${iconStyle}`}
                  >
                    {platform.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-slate-100">
                        {platform.name}
                      </p>
                      <span className="flex items-center gap-2 text-xs text-slate-300">
                        <span
                          className={`h-2 w-2 rounded-full ${statusColor(
                            displayStatus
                          )}`}
                        />
                        {statusLabel(displayStatus)}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-slate-400">
                      {platform.description}
                    </p>
                    {displayStatus === "CONNECTED" && primaryAccount && (
                      <p className="mt-2 text-xs text-slate-300">
                        {primaryAccount}
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between">
                  {displayStatus === "CONNECTED" ? (
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() =>
                          setDropdownOpen(
                            dropdownOpen === platform.slug
                              ? null
                              : platform.slug
                          )
                        }
                        className="rounded-lg bg-slate-800 px-3 py-2 text-xs text-slate-200"
                      >
                        Manage
                      </button>
                      {dropdownOpen === platform.slug && manageId && (
                        <div className="absolute left-0 top-11 z-10 w-40 rounded-lg border border-slate-800 bg-slate-950 p-2 text-xs text-slate-200 shadow-xl">
                          <button
                            type="button"
                            className="w-full rounded-md px-2 py-2 text-left hover:bg-slate-800"
                            onClick={() => {
                              setDropdownOpen(null);
                              openManageModal(platform, manageId, integrationId);
                            }}
                          >
                            Manage Accounts
                          </button>
                          <button
                            type="button"
                            className="w-full rounded-md px-2 py-2 text-left hover:bg-slate-800"
                            onClick={() => {
                              setDropdownOpen(null);
                              openManageModal(platform, manageId, integrationId);
                            }}
                          >
                            View Logs
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleConnect(platform.slug)}
                      disabled={connectingSlug === platform.slug}
                      className="rounded-lg bg-indigo-500 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {connectingSlug === platform.slug
                        ? "Connecting..."
                        : "Connect"}
                    </button>
                  )}

                  <button
                    type="button"
                    className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300"
                  >
                    <GearIcon />
                    Settings
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Modal
        open={manageOpen && !!manageIntegration}
        title={manageIntegration ? `Manage ${manageIntegration.name}` : ""}
        description="Connected accounts and activity logs."
        size="lg"
        onClose={() => setManageOpen(false)}
      >
        {manageLoading && (
          <div className="text-sm text-slate-300">Loading...</div>
        )}
        {manageError && (
          <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {manageError}
          </div>
        )}

        {!manageLoading && (
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                Accounts
              </p>
              {manageAccounts.length ? (
                manageAccounts.map((account) => (
                  <div
                    key={account.id}
                    className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-3"
                  >
                    <div>
                      <p className="text-sm text-slate-100">
                        {account.accountName || "N/A"}
                      </p>
                      <p className="text-xs text-slate-400">
                        {account.accountEmail || "N/A"} ¡¤ {account.createdAt ? new Date(account.createdAt).toLocaleDateString() : "N/A"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDisconnect(account.id)}
                      className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-200"
                    >
                      Disconnect
                    </button>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-400">No accounts connected.</p>
              )}
              {manageIntegration && (
                <button
                  type="button"
                  onClick={() => handleConnect(manageIntegration.slug)}
                  className="mt-2 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200"
                >
                  Add Another Account
                </button>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                Activity
              </p>
              {manageLogs.length ? (
                <div className="space-y-2">
                  {manageLogs.slice(0, 5).map((log) => (
                    <div
                      key={log.id}
                      className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs text-slate-300"
                    >
                      <span>{log.eventType}</span>
                      <span className="text-slate-500">
                        {new Date(log.createdAt).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400">No recent activity.</p>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

