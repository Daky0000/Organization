import React, { useEffect, useRef, useState } from "react";

type Props = {
  disabled?: boolean;
  onReschedule: () => void;
  onViewHistory?: () => void;
  onArchive?: () => void;
};

export const RescheduleDropdown: React.FC<Props> = ({
  disabled,
  onReschedule,
  onViewHistory,
  onArchive,
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        title={disabled ? "Save post first" : ""}
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-4 py-2 text-xs text-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
      >
        Reschedule
        <span className="text-[10px]">¨‹</span>
      </button>

      {open && !disabled && (
        <div className="absolute right-0 z-10 mt-2 w-48 rounded-xl border border-slate-800 bg-slate-900 p-2 text-xs text-slate-200 shadow-xl">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onReschedule();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-slate-800"
          >
            Reschedule Post
          </button>
          <div className="my-1 h-px bg-slate-800" />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onViewHistory?.();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-slate-800"
          >
            View Schedule History
          </button>
          <div className="my-1 h-px bg-slate-800" />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onArchive?.();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-slate-800"
          >
            Archive Post
          </button>
        </div>
      )}
    </div>
  );
};
