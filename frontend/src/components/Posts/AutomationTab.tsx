import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAutomation } from "../../hooks/useAutomation";
import { usePosts } from "../../hooks/usePosts";
import { Toast } from "../ui/Toast";
import { Modal } from "../ui/Modal";
import { AccountSelector } from "../Automation/AccountSelector";
import { ScheduleSelector, type AutomationSchedule } from "../Automation/ScheduleSelector";
import { AutomationRules } from "../Automation/AutomationRules";

const formatDateTime = (value?: string | null) => {
  if (!value) return "";
  return new Date(value).toLocaleString();
};

const getCountdown = (value?: string | null) => {
  if (!value) return "Now";
  const diff = new Date(value).getTime() - Date.now();
  if (diff <= 0) return "Due";
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${minutes}m`;
};

export const AutomationTab: React.FC = () => {
  const {
    availableIntegrations,
    scheduledPosts,
    recurringPosts,
    automationRules,
    loading,
    error,
    getAvailableIntegrations,
    refreshAutomationPosts,
    createRecurringPost,
    getUpcomingInstances,
    pauseAutomation,
    resumeAutomation,
    cancelRecurring,
    optimizePostTiming,
    getAutomationRules,
    createRule,
    applyRule,
    getAutomationLogs,
  } = useAutomation();

  const { createPostWithIntegrations } = usePosts();

  const [activeTab, setActiveTab] = useState<
    "new" | "scheduled" | "recurring" | "history" | "rules"
  >("new");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [schedule, setSchedule] = useState<AutomationSchedule>({
    type: "now",
    timeZone: "UTC",
    pattern: "DAILY",
  });
  const [toast, setToast] = useState<
    { type: "success" | "error"; message: string } | null
  >(null);
  const [upcoming, setUpcoming] = useState<{ postId: string; dates: any[] } | null>(null);
  const [logs, setLogs] = useState<{ postId: string; entries: any[] } | null>(null);
  const [lastCreatedPostId, setLastCreatedPostId] = useState<string | null>(null);

  const hasAccounts = selectedAccounts.length > 0;

  const loadData = useCallback(async () => {
    await Promise.all([getAvailableIntegrations(), getAutomationRules()]);
    await refreshAutomationPosts();
  }, [getAvailableIntegrations, getAutomationRules, refreshAutomationPosts]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const interval = setInterval(() => {
      refreshAutomationPosts();
    }, 10000);
    return () => clearInterval(interval);
  }, [refreshAutomationPosts]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!error) return;
    setToast({ type: "error", message: error });
  }, [error]);

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !content.trim()) {
      setToast({ type: "error", message: "Title and content are required." });
      return;
    }
    if (!hasAccounts) {
      setToast({ type: "error", message: "Select at least one account." });
      return;
    }

    if (schedule.type === "later" && !schedule.scheduledAt) {
      setToast({ type: "error", message: "Select a schedule time." });
      return;
    }

    try {
      const scheduledAt =
        schedule.type === "later" ? schedule.scheduledAt || undefined : undefined;

      const post = await createPostWithIntegrations(
        title,
        content,
        selectedAccounts,
        scheduledAt
      );

      setLastCreatedPostId(post.id);

      if (schedule.type === "recurring") {
        await createRecurringPost(post.id, {
          pattern: schedule.pattern || "DAILY",
          time: schedule.time,
          daysOfWeek: schedule.daysOfWeek,
          endDate: schedule.endDate ? new Date(schedule.endDate) : null,
          integrationIds: selectedAccounts,
        });
      }

      setToast({ type: "success", message: "Automation scheduled." });
      setTitle("");
      setContent("");
      setSelectedAccounts([]);
      setSchedule({ type: "now", timeZone: "UTC", pattern: "DAILY" });
      await refreshAutomationPosts();
    } catch (err: any) {
      setToast({
        type: "error",
        message: err?.response?.data?.error || "Failed to schedule automation.",
      });
    }
  };

  const handleSuggest = async () => {
    if (!lastCreatedPostId) {
      setToast({ type: "error", message: "Create a draft post first." });
      return null;
    }
    const result = await optimizePostTiming(lastCreatedPostId);
    return result?.suggestedTime ? new Date(result.suggestedTime) : null;
  };

  const handleApplyRule = async (ruleId: string) => {
    if (!lastCreatedPostId) {
      setToast({ type: "error", message: "Create a post before applying a rule." });
      return;
    }
    await applyRule(lastCreatedPostId, ruleId);
    setToast({ type: "success", message: "Rule applied." });
  };

  const selectedAccountNames = useMemo(() => {
    return availableIntegrations
      .filter((account) => selectedAccounts.includes(account.id))
      .map((account) => account.accountName || account.platform);
  }, [availableIntegrations, selectedAccounts]);

  return (
    <div className="mt-6">
      {toast && (
        <div className="mb-6">
          <Toast message={toast.message} variant={toast.type} onClose={() => setToast(null)} />
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        {
          [
            { key: "new", label: "New Post" },
            { key: "scheduled", label: "Scheduled" },
            { key: "recurring", label: "Recurring" },
            { key: "history", label: "Past Automation" },
            { key: "rules", label: "Rules" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${
              activeTab === tab.key
                ? "bg-indigo-500 text-white"
                : "bg-slate-900/60 text-slate-300"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "new" && (
        <form onSubmit={handleCreate} className="mt-8 space-y-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
            <h2 className="text-lg font-semibold">Post Content</h2>
            <div className="mt-4 space-y-4">
              <input
                type="text"
                placeholder="Post title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950/40 px-4 py-2 text-slate-100"
              />
              <textarea
                placeholder="Write your post content"
                value={content}
                onChange={(event) => setContent(event.target.value)}
                rows={6}
                className="w-full rounded-lg border border-slate-700 bg-slate-950/40 px-4 py-2 text-slate-100"
              />
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
            <h3 className="text-sm font-semibold text-slate-100">Platform Selection</h3>
            {!availableIntegrations.length && (
              <div className="mt-3 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-xs text-indigo-200">
                No platforms connected. Go to Integrations to connect.
              </div>
            )}
            <div className="mt-4">
              <AccountSelector
                accounts={availableIntegrations}
                selectedIds={selectedAccounts}
                onChange={setSelectedAccounts}
              />
            </div>
            {hasAccounts && (
              <div className="mt-3 text-xs text-slate-400">
                Selected: {selectedAccountNames.join(", ")}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
            <h3 className="text-sm font-semibold text-slate-100">Scheduling Options</h3>
            <div className="mt-4">
              <ScheduleSelector schedule={schedule} onChange={setSchedule} onSuggest={handleSuggest} />
            </div>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
            <div className="text-sm font-semibold text-slate-100">Optimization Panel</div>
            <p className="mt-2 text-xs text-slate-400">
              Analyze best time to post or apply a saved automation rule.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={async () => {
                  const suggested = await handleSuggest();
                  if (suggested) {
                    setSchedule((prev) => ({ ...prev, type: "later", scheduledAt: suggested }));
                    setToast({ type: "success", message: "Best time applied." });
                  }
                }}
                className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200"
                disabled={!lastCreatedPostId}
              >
                Analyze best time
              </button>
              <select
                onChange={(event) => handleApplyRule(event.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2 text-xs text-slate-200"
                defaultValue=""
              >
                <option value="" disabled>
                  Apply saved rule
                </option>
                {automationRules.map((rule) => (
                  <option key={rule.id} value={rule.id}>
                    {rule.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              className="rounded-lg bg-indigo-500 px-6 py-3 text-sm font-semibold text-white"
              disabled={loading}
            >
              Schedule Post
            </button>
          </div>
        </form>
      )}

      {activeTab === "scheduled" && (
        <div className="mt-8 space-y-4">
          {scheduledPosts.length ? (
            scheduledPosts.map((post) => (
              <div
                key={post.id}
                className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-lg font-semibold text-slate-100">
                      {post.title}
                    </p>
                    <p className="text-xs text-slate-400">
                      Scheduled for {formatDateTime(post.scheduledAt)}
                    </p>
                    <p className="text-xs text-indigo-300">
                      Countdown: {getCountdown(post.scheduledAt)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => pauseAutomation(post.id)}
                      className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200"
                    >
                      Pause
                    </button>
                    <button
                      type="button"
                      onClick={() => resumeAutomation(post.id)}
                      className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200"
                    >
                      Resume
                    </button>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-slate-400">No scheduled posts.</p>
          )}
        </div>
      )}

      {activeTab === "recurring" && (
        <div className="mt-8 space-y-4">
          {recurringPosts.length ? (
            recurringPosts.map((post) => (
              <div
                key={post.id}
                className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-lg font-semibold text-slate-100">
                      {post.title}
                    </p>
                    <p className="text-xs text-slate-400">
                      Next run: {formatDateTime(post.nextScheduledRun)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        const dates = await getUpcomingInstances(post.id, 5);
                        setUpcoming({ postId: post.id, dates });
                      }}
                      className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200"
                    >
                      View Instances
                    </button>
                    <button
                      type="button"
                      onClick={() => pauseAutomation(post.id)}
                      className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200"
                    >
                      Pause
                    </button>
                    <button
                      type="button"
                      onClick={() => cancelRecurring(post.id)}
                      className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200"
                    >
                      Stop Recurring
                    </button>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-slate-400">No recurring posts.</p>
          )}
        </div>
      )}

      {activeTab === "history" && (
        <div className="mt-8 space-y-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
            <h3 className="text-lg font-semibold">Automation History</h3>
            <p className="mt-2 text-xs text-slate-400">
              Select a post from Scheduled or Recurring tabs to view logs.
            </p>
            {logs && (
              <div className="mt-4 space-y-2 text-xs text-slate-300">
                {logs.entries.map((entry) => (
                  <div key={entry.id} className="rounded-lg border border-slate-800 p-3">
                    <div className="flex justify-between">
                      <span>{entry.status}</span>
                      <span>{new Date(entry.executedAt).toLocaleString()}</span>
                    </div>
                    {entry.message && <p className="mt-2 text-slate-400">{entry.message}</p>}
                  </div>
                ))}
              </div>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {[...scheduledPosts, ...recurringPosts].map((post) => (
                <button
                  key={post.id}
                  type="button"
                  onClick={async () => {
                    const entries = await getAutomationLogs(post.id);
                    setLogs({ postId: post.id, entries });
                  }}
                  className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200"
                >
                  {post.title}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === "rules" && (
        <div className="mt-8">
          <AutomationRules
            rules={automationRules}
            availableIntegrations={availableIntegrations}
            onCreate={createRule}
            onApply={handleApplyRule}
          />
        </div>
      )}

      <Modal
        open={!!upcoming}
        title="Upcoming Instances"
        size="md"
        onClose={() => setUpcoming(null)}
      >
        <div className="space-y-2 text-sm text-slate-200">
          {upcoming?.dates?.map((item: any, index: number) => {
            const date = item.date ? new Date(item.date) : new Date(item);
            return (
              <div key={`${date.toISOString()}-${index}`}>{date.toLocaleString()}</div>
            );
          })}
        </div>
      </Modal>


    </div>
  );
};




