import React from "react";

type ToastProps = {
  message: string;
  variant?: "success" | "error";
  onClose?: () => void;
};

const variantStyles: Record<NonNullable<ToastProps["variant"]>, string> = {
  success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
  error: "border-red-500/40 bg-red-500/10 text-red-200",
};

export const Toast: React.FC<ToastProps> = ({
  message,
  variant = "success",
  onClose,
}) => {
  return (
    <div
      role="status"
      className={`flex items-center justify-between gap-4 rounded-xl border px-4 py-3 text-sm ${variantStyles[variant]}`}
    >
      <span>{message}</span>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-slate-100/70 hover:text-white"
        >
          Dismiss
        </button>
      )}
    </div>
  );
};
