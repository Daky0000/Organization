import React, { useEffect, useMemo, useState } from "react";
import { Modal } from "../ui/Modal";
import { usePosts, PlatformSelection, RescheduleOption } from "../../hooks/usePosts";

const formatInputDate = (date: Date) => date.toISOString().split("T")[0];
const formatInputTime = (date: Date) => date.toTimeString().slice(0, 5);

const formatReadable = (date: Date) =>
  date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const timeLabelToValue = (label: string) => {
  const [time, meridiem] = label.split(" ");
  const [rawHour, rawMinute] = time.split(":");
  const hourNum = Number.parseInt(rawHour, 10) || 0;
  const minuteNum = Number.parseInt(rawMinute ?? "0", 10) || 0;
  const isPm = (meridiem || "").toLowerCase() === "pm";
  let hours = hourNum % 12;
  if (isPm) hours += 12;
  const paddedHour = String(hours).padStart(2, "0");
  const paddedMinute = String(minuteNum).padStart(2, "0");
  return `${paddedHour}:${paddedMinute}`;
};

type Props = {
  open: boolean;
  postId: string | null;
  postTitle?: string;
  currentScheduledAt?: string | null;
  platforms?: PlatformSelection[];
  onClose: () => void;
  onRescheduled?: (newTime: Date) => void;
};

export const RescheduleDialog: React.FC<Props> = ({
  open,
  postId,
  postTitle,
  currentScheduledAt,
  platforms = [],
  onClose,
  onRescheduled,
}) => {
  const { reschedulePost, getRescheduleOptions } = usePosts();
  const defaultTimezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    []
  );
  const [dateValue, setDateValue] = useState("");
  const [timeValue, setTimeValue] = useState("");
  const [timezone, setTimezone] = useState(defaultTimezone);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [suggestions, setSuggestions] = useState<RescheduleOption[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => {
    if (!open) return;
    const base = currentScheduledAt
      ? new Date(currentScheduledAt)
      : new Date(Date.now() + 60 * 60 * 1000);
    setDateValue(formatInputDate(base));
    setTimeValue(formatInputTime(base));
    setTimezone(defaultTimezone);
    setError("");
    setSuggestions([]);
    setShowSuggestions(false);
  }, [open, currentScheduledAt, defaultTimezone]);

  const scheduledDate = useMemo(() => {
    if (!dateValue || !timeValue) return null;
    const [year, month, day] = dateValue.split("-").map(Number);
    const [hours, minutes] = timeValue.split(":").map(Number);
    const next =
      timezone === "UTC"
        ? new Date(Date.UTC(year, month - 1, day, hours, minutes))
        : new Date(year, month - 1, day, hours, minutes);
    return Number.isNaN(next.getTime()) ? null : next;
  }, [dateValue, timeValue, timezone]);

  useEffect(() => {
    if (!open) return;
    if (!scheduledDate) {
      setError("Select a valid date and time");
      return;
    }
    if (scheduledDate.getTime() <= Date.now()) {
      setError("Reschedule time must be in the future");
      return;
    }
    setError("");
  }, [scheduledDate, open]);

  const handleSuggest = async () => {
    if (!postId) return;
    const data = await getRescheduleOptions(postId, 7);
    setSuggestions(data);
    setShowSuggestions(true);
  };

  const handleSuggestionSelect = (option: RescheduleOption) => {
    setDateValue(option.date);
    setTimeValue(timeLabelToValue(option.time));
    setShowSuggestions(false);
  };

  const handleSubmit = async () => {
    if (!postId || !scheduledDate || error) return;
    setSubmitting(true);
    try {
      await reschedulePost(postId, scheduledDate);
      onRescheduled?.(scheduledDate);
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error || "Reschedule failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Reschedule Post"
      size="md"
      onClose={onClose}
    >
      <div className="space-y-4 text-sm text-slate-200">
        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
          <p className="text-xs uppercase text-slate-400">Post</p>
          <p className="mt-1 font-semibold text-slate-100">
            {postTitle || "Untitled post"}
          </p>
          {currentScheduledAt && (
            <p className="mt-1 text-xs text-slate-400">
              Current schedule: {formatReadable(new Date(currentScheduledAt))}
            </p>
          )}
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
          <p className="text-xs uppercase text-slate-400">New Schedule</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div>
              <label className="text-xs text-slate-400">Date</label>
              <input
                type="date"
                value={dateValue}
                onChange={(event) => setDateValue(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm text-slate-100"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400">Time</label>
              <input
                type="time"
                value={timeValue}
                onChange={(event) => setTimeValue(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm text-slate-100"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400">Timezone</label>
              <select
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2 text-sm text-slate-100"
              >
                <option value={defaultTimezone}>Local ({defaultTimezone})</option>
                <option value="UTC">UTC</option>
              </select>
            </div>
          </div>
          {scheduledDate && !error && (
            <p className="mt-3 text-xs text-slate-400">
              Will post on {formatReadable(scheduledDate)} ({timezone})
            </p>
          )}
          {error && <p className="mt-3 text-xs text-red-300">{error}</p>}

          <div className="mt-3">
            <button
              type="button"
              onClick={handleSuggest}
              className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200"
            >
              Suggest Best Time
            </button>
            {showSuggestions && suggestions.length > 0 && (
              <div className="mt-3 space-y-2 rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-xs text-slate-200">
                {suggestions.map((option) => (
                  <button
                    key={`${option.date}-${option.time}`}
                    type="button"
                    onClick={() => handleSuggestionSelect(option)}
                    className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left hover:bg-slate-800"
                  >
                    <span>
                      {option.date} ¡¤ {option.time}
                    </span>
                    <span className="text-slate-400">{option.score}%</span>
                  </button>
                ))}
              </div>
            )}
            {showSuggestions && suggestions.length === 0 && (
              <p className="mt-2 text-xs text-slate-500">
                No data yet. Publish posts to see best times.
              </p>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
          <p className="text-xs uppercase text-slate-400">Posting To</p>
          <div className="mt-2 space-y-1 text-xs text-slate-300">
            {platforms.length ? (
              platforms.map((platform) => (
                <div key={platform.id} className="flex items-center gap-2">
                  <span className="text-emerald-400">?</span>
                  <span>
                    {platform.platform} - {platform.accountName || "Account"}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-xs text-slate-500">No platforms selected.</p>
            )}
            <p className="pt-2 text-[11px] text-slate-500">
              Using your current selection
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-700 px-4 py-2 text-xs text-slate-200"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!!error || submitting || !postId}
            onClick={handleSubmit}
            className="rounded-lg bg-indigo-500 px-4 py-2 text-xs text-white disabled:opacity-50"
          >
            {submitting ? "Rescheduling..." : "Reschedule"}
          </button>
        </div>
      </div>
    </Modal>
  );
};



