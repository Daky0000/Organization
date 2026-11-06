import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { PlatformSelectionPanel } from "../components/Posts/PlatformSelectionPanel";
import { RescheduleDialog } from "../components/Posts/RescheduleDialog";
import { RescheduleDropdown } from "../components/Posts/RescheduleDropdown";
import { ScheduleSelector } from "../components/Posts/ScheduleSelector";
import { PostPreview } from "../components/Posts/PostPreview";
import { Toast } from "../components/ui/Toast";
import { useIntegrations } from "../hooks/useIntegrations";
import {
  AvailableIntegrations,
  PlatformSelection,
  usePosts,
} from "../hooks/usePosts";

const normalizeContent = (value: any) => {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const candidate =
    value.original ||
    value.text ||
    value.default ||
    value.caption ||
    Object.values(value)[0] ||
    "";
  return typeof candidate === "string" ? candidate : JSON.stringify(candidate);
};
export const PostEditorPage: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id || id === "new";

  const {
    createPostWithIntegrations,
    createDraft,
    getPostWithIntegrations,
    savePlatformSelection,
    updatePostWithIntegrations,
    reschedulePost,
    postNow,
  } = usePosts();
  const { myIntegrations, getMyIntegrations } = useIntegrations();

  const [postId, setPostId] = useState<string | null>(isNew ? null : id || null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [status, setStatus] = useState("DRAFT");
  const [scheduledAt, setScheduledAt] = useState<Date | null>(null);
  const [selectedIntegrationIds, setSelectedIntegrationIds] = useState<string[]>(
    []
  );
  const [availableIntegrations, setAvailableIntegrations] = useState<
    AvailableIntegrations | null
  >(null);
  const [loading, setLoading] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [toast, setToast] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);

  useEffect(() => {
    getMyIntegrations();
  }, [getMyIntegrations]);

  useEffect(() => {
    if (!isNew) return;
    const grouped: AvailableIntegrations = {};
    myIntegrations.forEach((integration) => {
      const platform = integration.integration?.slug || "unknown";
      if (!grouped[platform]) grouped[platform] = [];
      grouped[platform].push({
        id: integration.id,
        accountName: integration.accountName,
        accountId: integration.accountId,
        status: integration.status,
        lastUsed: integration.lastUsed ?? null,
      });
    });
    setAvailableIntegrations(grouped);
  }, [isNew, myIntegrations]);

  useEffect(() => {
    if (isNew || !id) return;
    setLoading(true);
    getPostWithIntegrations(id)
      .then((data) => {
        setPostId(data.post.id);
        setTitle(data.post.title || "");
        setContent(normalizeContent(data.post.content));
        setStatus(data.post.status || "DRAFT");
        setScheduledAt(
          data.post.scheduledAt ? new Date(data.post.scheduledAt) : null
        );
        setSelectedIntegrationIds(
          data.selectedIntegrations.map((integration) => integration.id)
        );
        setAvailableIntegrations(data.availableIntegrations);
        setIsDirty(false);
      })
      .catch((err: any) => {
        setToast({
          type: "error",
          message: err?.response?.data?.error || "Failed to load post",
        });
      })
      .finally(() => setLoading(false));
  }, [isNew, id, getPostWithIntegrations]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const selectedIntegrationRecords = useMemo(
    () => myIntegrations.filter((item) => selectedIntegrationIds.includes(item.id)),
    [myIntegrations, selectedIntegrationIds]
  );

  const platformSummary: PlatformSelection[] = useMemo(() => {
    return selectedIntegrationRecords.map((integration) => ({
      id: integration.id,
      platform: integration.integration?.name || integration.integration?.slug || "Platform",
      accountName: integration.accountName,
    }));
  }, [selectedIntegrationRecords]);

  const handleBack = () => {
    if (isDirty && !confirm("You have unsaved changes. Leave anyway?")) {
      return;
    }
    navigate("/posts");
  };

  const handlePlatformChange = async (ids: string[]) => {
    setSelectedIntegrationIds(ids);
    setIsDirty(true);
    if (!postId) return;
    try {
      await savePlatformSelection(postId, ids);
      setToast({ type: "success", message: "Platform selection updated" });
    } catch (err: any) {
      setToast({
        type: "error",
        message: err?.response?.data?.error || "Failed to update platforms",
      });
    }
  };

  const handleSaveDraft = async () => {
    if (!title.trim() || !content.trim()) {
      setToast({ type: "error", message: "Title and content are required" });
      return;
    }
    setLoading(true);
    try {
      if (!postId) {
        const created = await createDraft(title, content);
        setPostId(created.id);
        setStatus(created.status);
        setIsDirty(false);
        navigate(`/posts/${created.id}`);
      } else {
        const updated = await updatePostWithIntegrations(postId, {
          title,
          content,
        });
        setStatus(updated.status || status);
        setIsDirty(false);
        setToast({ type: "success", message: "Draft saved" });
      }
    } catch (err: any) {
      setToast({
        type: "error",
        message: err?.response?.data?.error || "Failed to save draft",
      });
    } finally {
      setLoading(false);
    }
  };

  const handlePublish = async () => {
    if (!title.trim() || !content.trim()) {
      setToast({ type: "error", message: "Title and content are required" });
      return;
    }
    if (!selectedIntegrationIds.length) {
      setToast({ type: "error", message: "Select at least one platform" });
      return;
    }
    setLoading(true);
    try {
      if (!postId) {
        const created = await createPostWithIntegrations(
          title,
          content,
          selectedIntegrationIds,
          scheduledAt || undefined
        );
        setPostId(created.id);
        setStatus(created.status);
        setIsDirty(false);
        navigate(`/posts/${created.id}`);
        setToast({ type: "success", message: "Post published" });
      } else {
        await updatePostWithIntegrations(postId, { title, content });
        if (scheduledAt) {
          await reschedulePost(postId, scheduledAt);
        } else {
          await postNow(postId);
        }
        setIsDirty(false);
        setToast({ type: "success", message: "Post published" });
      }
    } catch (err: any) {
      setToast({
        type: "error",
        message: err?.response?.data?.error || "Failed to publish",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-6 pb-28 pt-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleBack}
              className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200"
            >
              ¡û Back
            </button>
            <div>
              <h1 className="text-2xl font-semibold">
                {isNew ? "Create Post" : "Edit Post"}
              </h1>
              {!isNew && (
                <p className="text-xs text-slate-400">Status: {status}</p>
              )}
            </div>
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

        {loading && (
          <div className="mt-6 text-sm text-slate-300">Loading...</div>
        )}

        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
              <h2 className="text-lg font-semibold">Post Editor</h2>
              <div className="mt-4 space-y-4">
                <input
                  type="text"
                  placeholder="Post title"
                  value={title}
                  onChange={(event) => {
                    setTitle(event.target.value);
                    setIsDirty(true);
                  }}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950/40 px-4 py-2 text-slate-100"
                />
                <textarea
                  placeholder="Write your post content"
                  value={content}
                  onChange={(event) => {
                    setContent(event.target.value);
                    setIsDirty(true);
                  }}
                  rows={8}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950/40 px-4 py-2 text-slate-100"
                />
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
              <h3 className="text-sm font-semibold text-slate-100">Media</h3>
              <div className="mt-3 rounded-xl border border-dashed border-slate-700 bg-slate-950/40 p-6 text-center text-xs text-slate-400">
                Drag media here or click to upload.
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-100">
                    Platform Variations Preview
                  </h3>
                  <p className="text-xs text-slate-400">
                    Preview how your post looks per platform.
                  </p>
                </div>
                <button
                  type="button"
                  className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200"
                >
                  Generate Variations
                </button>
              </div>
              <div className="mt-4">
                <PostPreview
                  post={{ id: postId || "draft", title, content, status }}
                  integrations={selectedIntegrationRecords}
                />
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <PlatformSelectionPanel
              postId={postId}
              selectedIntegrationIds={selectedIntegrationIds}
              availableIntegrations={availableIntegrations}
              onChange={handlePlatformChange}
              onConnect={() => navigate("/integrations")}
            />

            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
              <p className="text-xs font-semibold text-slate-300">SCHEDULE</p>
              <div className="mt-3">
                <ScheduleSelector
                  scheduledAt={scheduledAt}
                  onChange={(date) => {
                    setScheduledAt(date);
                    setIsDirty(true);
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 border-t border-slate-800 bg-slate-950/95">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-4">
          <button
            type="button"
            onClick={handleBack}
            className="rounded-lg border border-slate-700 px-4 py-2 text-xs text-slate-200"
          >
            Back
          </button>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleSaveDraft}
              className="rounded-lg border border-slate-700 px-4 py-2 text-xs text-slate-200"
            >
              Save Draft
            </button>
            <RescheduleDropdown
              disabled={!postId || status === "POSTED"}
              onReschedule={() => setRescheduleOpen(true)}
              onViewHistory={() =>
                setToast({
                  type: "error",
                  message: "Schedule history not available yet",
                })
              }
              onArchive={() =>
                setToast({
                  type: "error",
                  message: "Archive not implemented yet",
                })
              }
            />
            <button
              type="button"
              onClick={handlePublish}
              disabled={!selectedIntegrationIds.length}
              className="rounded-lg bg-indigo-500 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              Publish
            </button>
          </div>
        </div>
      </div>

      <RescheduleDialog
        open={rescheduleOpen}
        postId={postId}
        postTitle={title}
        currentScheduledAt={scheduledAt ? scheduledAt.toISOString() : null}
        platforms={platformSummary}
        onClose={() => setRescheduleOpen(false)}
        onRescheduled={(newTime) => {
          setScheduledAt(newTime);
          setStatus("SCHEDULED");
          setToast({
            type: "success",
            message: `Post rescheduled to ${newTime.toLocaleString()}`,
          });
        }}
      />
    </div>
  );
};


