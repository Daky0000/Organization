import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PlatformSelector } from "../components/Posts/PlatformSelector";
import { RescheduleDialog } from "../components/Posts/RescheduleDialog";
import { ScheduleSelector } from "../components/Posts/ScheduleSelector";
import { PostPreview } from "../components/Posts/PostPreview";
import { AutomationTab } from "../components/Posts/AutomationTab";
import { useIntegrations } from "../hooks/useIntegrations";
import { usePosts } from "../hooks/usePosts";
import type { Post } from "../hooks/usePosts";
import { Toast } from "../components/ui/Toast";
import { Modal } from "../components/ui/Modal";

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

const statusDot = (status?: string) => {
  switch (status) {
    case "POSTED":
      return "bg-emerald-400";
    case "FAILED":
      return "bg-red-400";
    case "QUEUED":
    case "RETRY":
      return "bg-amber-400";
    default:
      return "bg-slate-400";
  }
};

const looksLikeUrl = (value?: string | null) =>
  !!value && (value.startsWith("http://") || value.startsWith("https://"));

export const PostsPage: React.FC = () => {
  const navigate = useNavigate();
  const { myIntegrations, getMyIntegrations } = useIntegrations();
  const {
    createPostWithIntegrations,
    getPosts,
    postNow,
    retryPost,
    cancelPost,
    deletePost,
  } = usePosts();

  const [activeTab, setActiveTab] = useState<
    "create" | "automation" | "queue" | "posted" | "failed"
  >("queue");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [selectedIntegrations, setSelectedIntegrations] = useState<string[]>(
    []
  );
  const [scheduledAt, setScheduledAt] = useState<Date | null>(null);
  const [queueScheduled, setQueueScheduled] = useState<Post[]>([]);
  const [queuePending, setQueuePending] = useState<Post[]>([]);
  const [queuePosting, setQueuePosting] = useState<Post[]>([]);
  const [postedPosts, setPostedPosts] = useState<Post[]>([]);
  const [failedPosts, setFailedPosts] = useState<Post[]>([]);
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [toast, setToast] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<Post | null>(null);
  const [detailPost, setDetailPost] = useState<Post | null>(null);

  const selectedIntegrationRecords = useMemo(
    () => myIntegrations.filter((item) => selectedIntegrations.includes(item.id)),
    [myIntegrations, selectedIntegrations]
  );

  const refreshAll = useCallback(async () => {
    setLoadingQueue(true);
    try {
      const [scheduled, approved, posted, failed] = await Promise.all([
        getPosts({ status: "SCHEDULED" }),
        getPosts({ status: "APPROVED" }),
        getPosts({ status: "POSTED" }),
        getPosts({ status: "FAILED" }),
      ]);

      const posting = [...scheduled, ...approved].filter((post) =>
        (post.platformStatuses || []).some((status) =>
          ["QUEUED", "RETRY"].includes(status.status)
        )
      );
      const pending = approved.filter(
        (post) => !posting.find((item) => item.id === post.id)
      );

      setQueueScheduled(scheduled);
      setQueuePending(pending);
      setQueuePosting(posting);
      setPostedPosts(posted);
      setFailedPosts(failed);
    } catch (err: any) {
      setToast({
        type: "error",
        message: err?.response?.data?.error || "Failed to load posts",
      });
    } finally {
      setLoadingQueue(false);
    }
  }, [getPosts]);

  useEffect(() => {
    getMyIntegrations();
    refreshAll();
  }, [getMyIntegrations, refreshAll]);

  useEffect(() => {
    const interval = setInterval(() => {
      refreshAll();
    }, 10000);
    return () => clearInterval(interval);
  }, [refreshAll]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !content.trim()) {
      setToast({ type: "error", message: "Title and content are required" });
      return;
    }
    if (!selectedIntegrations.length) {
      setToast({ type: "error", message: "Select at least one platform" });
      return;
    }

    try {
      await createPostWithIntegrations(
        title,
        content,
        selectedIntegrations,
        scheduledAt || undefined
      );
      setToast({ type: "success", message: "Post created" });
      setTitle("");
      setContent("");
      setSelectedIntegrations([]);
      setScheduledAt(null);
      setActiveTab("queue");
      refreshAll();
    } catch (err: any) {
      setToast({
        type: "error",
        message: err?.response?.data?.error || "Failed to create post",
      });
    }
  };\n
  const handleCancel = async (postId: string) => {
    if (!confirm("Cancel the scheduled post?")) return;
    try {
      await cancelPost(postId);
      refreshAll();
    } catch (err: any) {
      setToast({
        type: "error",
        message: err?.response?.data?.error || "Cancel failed",
      });
    }
  };

  const handleDelete = async (postId: string) => {
    if (!confirm("Delete this post? This cannot be undone.")) return;
    try {
      await deletePost(postId);
      refreshAll();
    } catch (err: any) {
      setToast({
        type: "error",
        message: err?.response?.data?.error || "Delete failed",
      });
    }
  };

  const draftPost: Post = {
    id: "draft",
    title,
    content,
    status: "DRAFT",
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold">Posts</h1>
            <p className="text-sm text-slate-400">
              Create, schedule, and track multi-platform publishing.
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate("/posts/new")}
            className="rounded-full bg-indigo-500 px-4 py-2 text-sm font-semibold text-white"
          >
            New Post
          </button>
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

        <div className="mt-8 flex flex-wrap gap-3">
          {[
            { key: "create", label: "Create" },
            { key: "automation", label: "Automation" },
            { key: "queue", label: "Queue" },
            { key: "posted", label: "Posted" },
            { key: "failed", label: "Failed" },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key as any)}
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

        {activeTab === "create" && (
          <div className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
                <h2 className="text-lg font-semibold">Create Post</h2>
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
                <h3 className="text-sm font-semibold text-slate-100">
                  Select platforms
                </h3>
                {myIntegrations.length === 0 && (
                  <div className="mt-3 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 text-xs text-indigo-200">
                    No platforms connected. Go to Integrations to connect.
                  </div>
                )}
                <div className="mt-4">
                  <PlatformSelector
                    integrations={myIntegrations}
                    selected={selectedIntegrations}
                    onChange={setSelectedIntegrations}
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
                <h3 className="text-sm font-semibold text-slate-100">
                  Schedule
                </h3>
                <div className="mt-4">
                  <ScheduleSelector
                    scheduledAt={scheduledAt}
                    onChange={setScheduledAt}
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full rounded-lg bg-indigo-500 py-3 text-sm font-semibold text-white hover:bg-indigo-400"
              >
                Create & Schedule Post
              </button>
            </form>

            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
                <h3 className="text-sm font-semibold text-slate-100">
                  Platform Variations Preview
                </h3>
                <p className="mt-2 text-xs text-slate-400">
                  Variations show how content appears per platform.
                </p>
              </div>
              <PostPreview
                post={draftPost}
                integrations={selectedIntegrationRecords}
              />
            </div>
          </div>
        )}

        {activeTab === "automation" && <AutomationTab />}

        {activeTab === "queue" && (
          <div className="mt-8 space-y-6">
            {loadingQueue && (
              <div className="text-sm text-slate-300">Loading queue...</div>
            )}

            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
              <h3 className="text-lg font-semibold">Scheduled Posts</h3>
              <div className="mt-4 space-y-3">
                {queueScheduled.length ? (
                  queueScheduled.map((post) => (
                    <div
                      key={post.id}
                      className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-950/40 p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <p className="text-sm font-semibold text-slate-100">
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
                          onClick={() => navigate(`/posts/${post.id}`)}
                          className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRescheduleTarget(post);
                          }}
                          className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200"
                        >
                          Reschedule
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCancel(post.id)}
                          className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-400">No scheduled posts.</p>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
              <h3 className="text-lg font-semibold">Pending</h3>
              <div className="mt-4 space-y-3">
                {queuePending.length ? (
                  queuePending.map((post) => (
                    <div
                      key={post.id}
                      className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-950/40 p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <p className="text-sm font-semibold text-slate-100">
                          {post.title}
                        </p>
                        <p className="text-xs text-slate-400">
                          Waiting to post
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => navigate(`/posts/${post.id}`)}
                          className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => postNow(post.id).then(refreshAll)}
                          className="rounded-lg bg-indigo-500 px-3 py-2 text-xs text-white"
                        >
                          Post Now
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRescheduleTarget(post);
                          }}
                          className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200"
                        >
                          Schedule
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(post.id)}
                          className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-400">No pending posts.</p>
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
              <h3 className="text-lg font-semibold">Posting</h3>
              <div className="mt-4 space-y-3">
                {queuePosting.length ? (
                  queuePosting.map((post) => {
                    const total = post.platformStatuses?.length || 1;
                    const posted =
                      post.platformStatuses?.filter(
                        (status) => status.status === "POSTED"
                      ).length || 0;
                    const progress = Math.round((posted / total) * 100);

                    return (
                      <div
                        key={post.id}
                        className="rounded-lg border border-slate-800 bg-slate-950/40 p-4"
                      >
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-semibold text-slate-100">
                            {post.title}
                          </p>
                          <span className="text-xs text-slate-400">
                            {progress}%
                          </span>
                        </div>
                        <div className="mt-3 h-2 w-full rounded-full bg-slate-800">
                          <div
                            className="h-2 rounded-full bg-indigo-500"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-sm text-slate-400">
                    No posts in progress.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === "posted" && (
          <div className="mt-8 space-y-4">
            {postedPosts.length ? (
              postedPosts.map((post) => (
                <div
                  key={post.id}
                  className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-lg font-semibold text-slate-100">
                        {post.title}
                      </p>
                      <p className="text-xs text-slate-400">
                        Posted at {formatDateTime(post.postedAt || post.createdAt)}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setDetailPost(post)}
                        className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200"
                      >
                        View
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(post.id)}
                        className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {(post.platformStatuses || []).map((status) => (
                      <div
                        key={`${post.id}-${status.platform}-${status.accountName}`}
                        className="flex items-center gap-2 rounded-full border border-slate-800 bg-slate-950/40 px-3 py-1 text-xs text-slate-300"
                      >
                        <span
                          className={`h-2 w-2 rounded-full ${statusDot(
                            status.status
                          )}`}
                        />
                        {status.platform.toUpperCase()}
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 text-xs text-slate-400">
                    Engagement: {post.analytics ? "Available" : "No metrics yet"}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-400">No posted content yet.</p>
            )}
          </div>
        )}

        {activeTab === "failed" && (
          <div className="mt-8 space-y-4">
            {failedPosts.length ? (
              failedPosts.map((post) => (
                <div
                  key={post.id}
                  className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-lg font-semibold text-slate-100">
                        {post.title}
                      </p>
                      <p className="text-xs text-red-300">Failed</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => retryPost(post.id).then(refreshAll)}
                        className="rounded-lg bg-indigo-500 px-3 py-2 text-xs text-white"
                      >
                        Retry
                      </button>
                      <button
                        type="button"
                        onClick={() => setDetailPost(post)}
                        className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200"
                      >
                        View Details
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(post.id)}
                        className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <div className="mt-4 text-xs text-slate-400">
                    Retried {post.platformStatuses?.filter((status) => status.status === "RETRY").length || 0}/3 times
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-400">No failed posts.</p>
            )}
          </div>
        )}
      </div>

      <RescheduleDialog
        open={!!rescheduleTarget}
        postId={rescheduleTarget?.id ?? null}
        postTitle={rescheduleTarget?.title}
        currentScheduledAt={rescheduleTarget?.scheduledAt ?? null}
        platforms={
          rescheduleTarget?.platformStatuses?.map((status) => ({
            id: `${status.platform}-${status.accountName}`,
            platform: status.platform,
            accountName: status.accountName,
          })) || []
        }
        onClose={() => setRescheduleTarget(null)}
        onRescheduled={() => {
          setRescheduleTarget(null);
          setToast({ type: "success", message: "Post rescheduled" });
          refreshAll();
        }}
      />

      <Modal
        open={!!detailPost}
        title="Post Details"
        size="md"
        onClose={() => setDetailPost(null)}
      >
        <div className="space-y-3">
          {(detailPost?.platformStatuses || []).map((status) => (
            <div
              key={`${detailPost?.id}-${status.platform}-${status.accountName}`}
              className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-xs text-slate-200"
            >
              <div className="flex items-center justify-between">
                <span>{status.platform.toUpperCase()}</span>
                <span
                  className={`text-slate-400 ${
                    status.status === "FAILED" ? "text-red-300" : ""
                  }`}
                >
                  {status.status}
                </span>
              </div>
              {status.error && (
                <p className="mt-2 text-red-300">{status.error}</p>
              )}
              {looksLikeUrl(status.platformPostId || undefined) && (
                <a
                  href={status.platformPostId || undefined}
                  className="mt-2 inline-flex text-indigo-300"
                >
                  View on platform
                </a>
              )}
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
};
















