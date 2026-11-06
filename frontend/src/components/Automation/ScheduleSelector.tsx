import React, { useMemo, useState } from "react";

export type AutomationSchedule = {
  type: "now" | "later" | "recurring";
  scheduledAt?: Date | null;
  timeZone?: string;
  pattern?: "DAILY" | "WEEKLY" | "MONTHLY" | "CUSTOM";
  daysOfWeek?: number[];
  dayOfMonth?: number;
  time?: string;
  endDate?: string | null;
};

const TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
];

const toDateInput = (value?: Date | null) =>
  value ? value.toISOString().slice(0, 10) : "";

const toTimeInput = (value?: Date | null) =>
  value ? value.toTimeString().slice(0, 5) : "";

const buildDateTime = (dateValue: string, timeValue: string) => {
  if (!dateValue || !timeValue) return null;
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date();
  date.setFullYear(year, month - 1, day);
  date.setHours(hour || 0, minute || 0, 0, 0);
  return date;
};

const nextDaily = (base: Date, time: string) => {
  const next = new Date(base);
  const [h, m] = time.split(":").map(Number);
  next.setHours(h || 0, m || 0, 0, 0);
  if (next.getTime() <= Date.now()) {
    next.setDate(next.getDate() + 1);
  }
  return next;
};

const nextWeekly = (base: Date, time: string, days: number[]) => {
  const ordered = [...new Set(days)].sort((a, b) => a - b);
  const today = base.getDay();
  let bestDiff = 7;
  ordered.forEach((day) => {
    let diff = day - today;
    const candidate = new Date(base);
    candidate.setDate(candidate.getDate() + diff);
    candidate.setHours(...time.split(":").map(Number), 0, 0);
    if (diff < 0 || (diff === 0 && candidate.getTime() <= Date.now())) {
      diff += 7;
    }
    if (diff < bestDiff) bestDiff = diff;
  });
  const next = new Date(base);
  next.setDate(next.getDate() + bestDiff);
  next.setHours(...time.split(":").map(Number), 0, 0);
  return next;
};

const nextMonthly = (base: Date, time: string, dayOfMonth: number) => {
  const [h, m] = time.split(":").map(Number);
  const next = new Date(base.getFullYear(), base.getMonth(), dayOfMonth, h || 0, m || 0, 0, 0);
  if (next.getTime() <= Date.now()) {
    return new Date(base.getFullYear(), base.getMonth() + 1, dayOfMonth, h || 0, m || 0, 0, 0);
  }
  return next;
};

type Props = {
  schedule: AutomationSchedule;
  onChange: (value: AutomationSchedule) => void;
  onSuggest?: () => Promise<Date | null>;
};

export const ScheduleSelector: React.FC<Props> = ({ schedule, onChange, onSuggest }) => {
  const [suggesting, setSuggesting] = useState(false);

  const dateValue = toDateInput(schedule.scheduledAt || null);
  const timeValue = toTimeInput(schedule.scheduledAt || null);

  const update = (patch: Partial<AutomationSchedule>) => {
    onChange({ ...schedule, ...patch });
  };

  const handleSuggest = async () => {
    if (!onSuggest) return;
    setSuggesting(true);
    try {
      const suggested = await onSuggest();
      if (suggested) {
        onChange({ ...schedule, type: "later", scheduledAt: suggested });
      }
    } finally {
      setSuggesting(false);
    }
  };

  const isPast = schedule.scheduledAt
    ? schedule.scheduledAt.getTime() <= Date.now()
    : false;

  const previewInstances = useMemo(() => {
    if (schedule.type !== "recurring") return [] as Date[];
    const pattern = schedule.pattern ?? "DAILY";
    const time = schedule.time ?? "09:00";
    const base = new Date();
    const dates: Date[] = [];
    let cursor = base;
    for (let i = 0; i < 5; i += 1) {
      let next: Date;
      if (pattern === "WEEKLY") {
        next = nextWeekly(cursor, time, schedule.daysOfWeek ?? [cursor.getDay()]);
      } else if (pattern === "MONTHLY") {
        next = nextMonthly(cursor, time, schedule.dayOfMonth ?? cursor.getDate());
      } else {
        next = nextDaily(cursor, time);
      }
      dates.push(next);
      cursor = new Date(next.getTime() + 24 * 60 * 60 * 1000);
    }
    return dates;
  }, [schedule]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            checked={schedule.type === "now"}
            onChange={() => update({ type: "now" })}
          />
          Post Now
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            checked={schedule.type === "later"}
            onChange={() => update({ type: "later" })}
          />
          Schedule for Later
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            checked={schedule.type === "recurring"}
            onChange={() => update({ type: "recurring" })}
          />
          Recurring
        </label>
      </div>

      {schedule.type === "later" && (
        <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
          <div className="grid gap-3 md:grid-cols-3">
            <input
              type="date"
              value={dateValue}
              onChange={(event) => {
                const nextDate = buildDateTime(event.target.value, timeValue || "00:00");
                update({ scheduledAt: nextDate });
              }}
              className="rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2 text-xs"
            />
            <input
              type="time"
              value={timeValue}
              onChange={(event) => {
                const nextDate = buildDateTime(dateValue || "", event.target.value);
                update({ scheduledAt: nextDate });
              }}
              className="rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2 text-xs"
            />
            <select
              value={schedule.timeZone || "UTC"}
              onChange={(event) => update({ timeZone: event.target.value })}
              className="rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2 text-xs"
            >
              {TIMEZONES.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </div>
          {isPast && (
            <div className="text-xs text-red-300">Schedule time must be in the future.</div>
          )}
          <div className="text-xs text-slate-400">
            {schedule.scheduledAt
              ? `Will post on ${schedule.scheduledAt.toLocaleString()}`
              : "Select a date and time."}
          </div>
          {onSuggest && (
            <button
              type="button"
              onClick={handleSuggest}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200"
              disabled={suggesting}
            >
              {suggesting ? "Analyzing..." : "Suggest Best Time"}
            </button>
          )}
        </div>
      )}

      {schedule.type === "recurring" && (
        <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
          <div className="flex flex-wrap gap-2">
            {["DAILY", "WEEKLY", "MONTHLY"].map((pattern) => (
              <button
                key={pattern}
                type="button"
                onClick={() => update({ pattern: pattern as AutomationSchedule["pattern"] })}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  schedule.pattern === pattern
                    ? "bg-indigo-500 text-white"
                    : "bg-slate-800 text-slate-300"
                }`}
              >
                {pattern}
              </button>
            ))}
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <input
              type="time"
              value={schedule.time || "09:00"}
              onChange={(event) => update({ time: event.target.value })}
              className="rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2 text-xs"
            />
            <select
              value={schedule.timeZone || "UTC"}
              onChange={(event) => update({ timeZone: event.target.value })}
              className="rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2 text-xs"
            >
              {TIMEZONES.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={schedule.endDate || ""}
              onChange={(event) => update({ endDate: event.target.value })}
              className="rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2 text-xs"
            />
          </div>

          {schedule.pattern === "WEEKLY" && (
            <div className="flex flex-wrap gap-2">
              {[
                { label: "Sun", value: 0 },
                { label: "Mon", value: 1 },
                { label: "Tue", value: 2 },
                { label: "Wed", value: 3 },
                { label: "Thu", value: 4 },
                { label: "Fri", value: 5 },
                { label: "Sat", value: 6 },
              ].map((day) => {
                const active = schedule.daysOfWeek?.includes(day.value) ?? false;
                return (
                  <button
                    key={day.value}
                    type="button"
                    onClick={() => {
                      const current = schedule.daysOfWeek ?? [];
                      const next = active
                        ? current.filter((d) => d !== day.value)
                        : [...current, day.value];
                      update({ daysOfWeek: next });
                    }}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      active ? "bg-indigo-500 text-white" : "bg-slate-800 text-slate-300"
                    }`}
                  >
                    {day.label}
                  </button>
                );
              })}
            </div>
          )}

          {schedule.pattern === "MONTHLY" && (
            <input
              type="number"
              min={1}
              max={31}
              value={schedule.dayOfMonth || 1}
              onChange={(event) => update({ dayOfMonth: Number(event.target.value) })}
              className="w-32 rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2 text-xs"
            />
          )}

          <div className="text-xs text-slate-400">Next runs:</div>
          <div className="space-y-1 text-xs text-slate-300">
            {previewInstances.map((date, index) => (
              <div key={`${date.toISOString()}-${index}`}>
                {date.toLocaleString()}
              </div>
            ))}
          </div>

          {onSuggest && (
            <button
              type="button"
              onClick={handleSuggest}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200"
              disabled={suggesting}
            >
              {suggesting ? "Analyzing..." : "Suggest Best Time"}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
