import React from "react";

type Props = {
  selectedDays: 30 | 60;
  onChange: (days: 30 | 60) => void;
};

export const DateRangeSelector: React.FC<Props> = ({
  selectedDays,
  onChange,
}) => {
  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => onChange(30)}
        className={`rounded-full px-3 py-2 text-xs font-semibold ${
          selectedDays === 30
            ? "bg-indigo-500 text-white"
            : "bg-slate-800 text-slate-300"
        }`}
      >
        Last 30 days
      </button>
      <button
        type="button"
        onClick={() => onChange(60)}
        className={`rounded-full px-3 py-2 text-xs font-semibold ${
          selectedDays === 60
            ? "bg-indigo-500 text-white"
            : "bg-slate-800 text-slate-300"
        }`}
      >
        Last 60 days
      </button>
    </div>
  );
};
