import React, { useEffect, useMemo, useState } from "react";

const formatInputDate = (date: Date) =>
  date.toISOString().split("T")[0];

const formatInputTime = (date: Date) =>
  date.toTimeString().slice(0, 5);

type Props = {
  scheduledAt: Date | null;
  onChange: (date: Date | null) => void;
};

export const ScheduleSelector: React.FC<Props> = ({
  scheduledAt,
  onChange,
}) => {
  const defaultTimezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    []
  );
  const [mode, setMode] = useState<"now" | "later">(
    scheduledAt ? "later" : "now"
  );
  const [dateValue, setDateValue] = useState("");
  const [timeValue, setTimeValue] = useState("");
  const [timezone, setTimezone] = useState(defaultTimezone);
  const [error, setError] = useState("");

  useEffect(() => {
    if (scheduledAt) {
      setMode("later");
      setDateValue(formatInputDate(scheduledAt));
      setTimeValue(formatInputTime(scheduledAt));
    }
  }, [scheduledAt]);

  useEffect(() => {
    if (mode === "now") {
      setError("");
      onChange(null);
      return;
    }

    if (!dateValue || !timeValue) return;

    const [year, month, day] = dateValue.split("-").map(Number);
    const [hours, minutes] = timeValue.split(":").map(Number);

    const scheduledDate =
      timezone === "UTC"
        ? new Date(Date.UTC(year, month - 1, day, hours, minutes))
        : new Date(year, month - 1, day, hours, minutes);

    if (Number.isNaN(scheduledDate.getTime())) {
      setError("Invalid date/time");
      return;
    }

    if (scheduledDate.getTime() <= Date.now()) {
      setError("Schedule time must be in the future");
      return;
    }

    setError("");
    onChange(scheduledDate);
  }, [dateValue, timeValue, timezone, mode, onChange]);

  const previewText =
    mode === "later" && dateValue && timeValue
      ? `Will post on ${dateValue} at ${timeValue} (${timezone})`
      : "";

  return (
    <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm text-slate-200">
          <input
            type="radio"
            name="schedule"
            checked={mode === "now"}
            onChange={() => setMode("now")}
          />
          Post Now
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-200">
          <input
            type="radio"
            name="schedule"
            checked={mode === "later"}
            onChange={() => setMode("later")}
          />
          Schedule for Later
        </label>
      </div>

      {mode === "later" && (
        <div className="grid gap-3 sm:grid-cols-3">
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
      )}

      {previewText && <p className="text-xs text-slate-400">{previewText}</p>}
      {error && (
        <p className="text-xs text-red-300">{error}</p>
      )}
    </div>
  );
};
