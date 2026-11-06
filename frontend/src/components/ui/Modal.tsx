import React from "react";

type ModalProps = {
  open: boolean;
  title?: string;
  description?: string;
  size?: "sm" | "md" | "lg";
  onClose: () => void;
  children: React.ReactNode;
};

const sizeMap: Record<NonNullable<ModalProps["size"]>, string> = {
  sm: "max-w-md",
  md: "max-w-xl",
  lg: "max-w-2xl",
};

export const Modal: React.FC<ModalProps> = ({
  open,
  title,
  description,
  size = "lg",
  onClose,
  children,
}) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-950/80 px-6">
      <div
        className={`w-full ${sizeMap[size]} rounded-2xl border border-slate-800 bg-slate-900 p-6`}
      >
        {(title || description) && (
          <div className="flex items-start justify-between">
            <div>
              {title && <h2 className="text-xl font-semibold">{title}</h2>}
              {description && (
                <p className="text-xs text-slate-400">{description}</p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-200"
            >
              Close
            </button>
          </div>
        )}
        <div className={title || description ? "mt-6" : ""}>{children}</div>
      </div>
    </div>
  );
};
