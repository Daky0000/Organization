import { Children, isValidElement, useEffect, useId, useRef, useState, type ReactNode } from "react";

/** Quiet section label shared by every workspace page (DESIGN-SYSTEM.md §3). */
export function Eyebrow({ children }: { children: ReactNode }) {
  return <span className="os-eyebrow">{children}</span>;
}

export function PageHeader({
  title,
  subtitle,
  eyebrow,
  action,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="os-page-header">
      <div className="min-w-0">
        {eyebrow && <div className="mb-2.5"><Eyebrow>{eyebrow}</Eyebrow></div>}
        <h1 className="os-page-title">{title}</h1>
        {subtitle && <p className="mt-2.5 max-w-2xl text-sm leading-relaxed text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/** A heading for a block inside a page — the level below PageHeader. */
export function SectionHeading({
  title,
  hint,
  action,
  className = "",
}: {
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 ${className}`}>
      <div className="min-w-0">
        <h2 className="font-display text-xl font-normal tracking-[-.03em] text-ink">{title}</h2>
        {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

/** White, one hairline, 16px corners (DESIGN-SYSTEM.md §4). */
export function Card({
  children,
  className = "",
  flush,
  interactive,
}: {
  children: ReactNode;
  className?: string;
  flush?: boolean;
  interactive?: boolean;
}) {
  return (
    <div
      className={`os-card overflow-hidden rounded-2xl border border-line bg-white transition-colors duration-200 ${
        interactive ? "cursor-pointer hover:border-blue" : ""
      } ${flush ? "" : "p-6"} ${className}`}
    >
      {children}
    </div>
  );
}

export function Badge({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "positive" | "muted" | "warn" | "danger" | "info" | "gold";
}) {
  const toneClass = {
    default: "text-ink bg-ink/10 border-ink/10",
    positive: "text-positive-text bg-positive-surface border-positive-line/50",
    warn: "text-warn-text bg-warn-surface border-warn-line/50",
    danger: "text-danger-text bg-danger-surface border-danger-line/50",
    info: "text-info-text bg-info-surface border-info-line/50",
    gold: "text-info-text bg-info-surface border-info-line/50",
    muted: "text-muted bg-sunken border-line",
  }[tone];
  return (
    <span className={`os-badge inline-flex items-center rounded-[10px] border px-2.5 py-1 text-[11px] font-medium ${toneClass}`}>
      {children}
    </span>
  );
}

export function Pip(_props: { children?: ReactNode }) {
  return null;
}

export function Button({
  children,
  onClick,
  variant = "primary",
  type = "button",
  disabled,
  size = "md",
  title,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  /** `accent` is the blue button (DESIGN-SYSTEM.md §5). Maximum one per view. */
  variant?: "primary" | "accent" | "secondary" | "ghost" | "danger";
  type?: "button" | "submit";
  disabled?: boolean;
  size?: "sm" | "md";
  title?: string;
  className?: string;
}) {
  const base =
    "os-button group inline-flex items-center justify-center gap-2 rounded-[10px] font-medium transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue";
  const sizing = size === "sm" ? "px-3.5 py-2 text-xs" : "px-4 py-2.5 text-[13px]";
  const styles = {
    primary: "bg-ink text-white hover:bg-[#1E2A44]",
    accent: "bg-blue text-white hover:bg-blue-d",
    secondary: "border border-line-2 bg-white text-ink hover:border-ink/40 hover:bg-sunken",
    ghost: "text-muted hover:text-ink",
    danger: "border border-danger-line text-danger-text hover:border-transparent hover:bg-danger hover:text-white",
  }[variant];
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title} className={`${base} ${sizing} ${styles} ${className}`}>
      {children}
    </button>
  );
}

// --- Tables ----------------------------------------------------------------

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="os-table overflow-x-auto rounded-2xl border border-line bg-white">
      <table className="w-full min-w-[640px] text-left text-sm">{children}</table>
    </div>
  );
}

export function Thead({ children }: { children: ReactNode }) {
  return (
    <thead>
      {Children.toArray(children).some((child) => isValidElement(child) && child.type === "tr") ? (
        children
      ) : (
        <tr className="border-b border-line bg-sunken text-xs font-medium text-muted">{children}</tr>
      )}
    </thead>
  );
}

export function Th({
  children,
  align = "left",
  className = "",
}: {
  children?: ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
}) {
  const alignment = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  return <th className={`px-5 py-4 font-medium ${alignment} ${className}`}>{children}</th>;
}

export function Td({
  children,
  align = "left",
  className = "",
  colSpan,
}: {
  children?: ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
  colSpan?: number;
}) {
  const alignment = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  return (
    <td colSpan={colSpan} className={`px-4 py-3 align-middle ${alignment} ${className}`}>
      {children}
    </td>
  );
}

export function Tr({
  children,
  onClick,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <tr
      onClick={onClick}
      className={`border-b border-line last:border-0 ${onClick ? "cursor-pointer transition hover:bg-sunken" : ""} ${className}`}
    >
      {children}
    </tr>
  );
}

export function Money({ amount, currency = "GHS" }: { amount: number | string; currency?: string }) {
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return <span className="text-faint">—</span>;
  return (
    <span>
      {currency} {n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </span>
  );
}

// --- States ----------------------------------------------------------------

export function EmptyState({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="os-empty rounded-2xl border border-line bg-sunken p-10 text-center text-sm leading-relaxed text-muted">
      <p>{message}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Loading({ label = "Loading", rows = 0 }: { label?: string; rows?: number }) {
  if (rows > 0) {
    return (
      <div className="space-y-2" role="status" aria-label={label}>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="h-11 animate-pulse rounded-xl bg-sunken" style={{ animationDelay: `${i * 90}ms` }} />
        ))}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2.5 text-sm text-muted" role="status">
      <span className="h-2 w-2 animate-pulse rounded-full bg-blue" aria-hidden />
      {label}…
    </div>
  );
}

export function Notice({
  tone = "info",
  title,
  children,
  action,
  className = "",
}: {
  tone?: "info" | "warn" | "danger" | "positive";
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const toneClass = {
    info: "border-info-line bg-info-surface text-info-text",
    warn: "border-warn-line bg-warn-surface text-warn-text",
    danger: "border-danger-line bg-danger-surface text-danger-text",
    positive: "border-positive-line bg-positive-surface text-positive-text",
  }[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : undefined}
      className={`os-notice flex flex-wrap items-start justify-between gap-x-4 gap-y-2 rounded-xl border px-5 py-4 text-sm ${toneClass} ${className}`}
    >
      <div className="min-w-0 flex-1">
        {title && <div className="font-medium">{title}</div>}
        {children && <div className={title ? "mt-0.5 opacity-90" : ""}>{children}</div>}
      </div>
      {action}
    </div>
  );
}

// --- Forms -----------------------------------------------------------------

export function Field({
  label,
  hint,
  children,
  full,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  full?: boolean;
}) {
  return (
    <label className={`block text-sm ${full ? "sm:col-span-2" : ""}`}>
      <span className="mb-2 block text-xs font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center gap-3 text-left"
      aria-pressed={checked}
    >
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition ${checked ? "bg-blue" : "bg-line-strong"}`}
        aria-hidden
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${checked ? "left-[1.15rem]" : "left-0.5"}`}
        />
      </span>
      <span className={`text-xs font-medium ${checked ? "text-ink" : "text-muted"}`}>{label}</span>
    </button>
  );
}

// --- Readouts --------------------------------------------------------------

export function StatGrid({ children, columns = 4 }: { children: ReactNode; columns?: 3 | 4 | 5 }) {
  const cols = { 3: "sm:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4", 5: "sm:grid-cols-3 lg:grid-cols-5" }[columns];
  return <div className={`os-stat-grid grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line ${cols}`}>{children}</div>;
}

export function StatTile({
  label,
  value,
  sub,
  standalone,
  onClick,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  standalone?: boolean;
  onClick?: () => void;
}) {
  const Component = onClick ? "button" : "div";
  return (
    <Component
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`os-stat-tile bg-white px-6 py-6 text-left ${
        standalone ? "rounded-2xl border border-line" : ""
      } ${onClick ? "cursor-pointer transition-colors hover:bg-sunken" : ""}`}
    >
      <div className="os-caption">{label}</div>
      <div className="mt-3 font-display text-3xl font-normal leading-none tracking-[-.04em] text-ink">{value}</div>
      {sub && <div className="mt-2 text-xs text-muted">{sub}</div>}
    </Component>
  );
}

export function ScoreBar({ score }: { score: number }) {
  const tone = score >= 70 ? "bg-lime" : score >= 45 ? "bg-blue" : "bg-line-strong";
  return (
    <span className="flex items-center gap-2" title={`Lead score ${score}/100`}>
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-sunken">
        <span className={`block h-full rounded-full ${tone}`} style={{ width: `${Math.max(4, score)}%` }} />
      </span>
      <span className="font-mono text-[11px] text-muted">{score}</span>
    </span>
  );
}

export function RelativeTime({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-faint">—</span>;
  const date = new Date(value);
  const diff = date.getTime() - Date.now();
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  let text: string;
  const absolute = Math.abs(diff);
  if (absolute < 60_000) text = format.format(Math.round(diff / 1000), "second");
  else if (absolute < 60 * 60_000) text = format.format(Math.round(diff / 60_000), "minute");
  else if (absolute < 24 * 60 * 60_000) text = format.format(Math.round(diff / (60 * 60_000)), "hour");
  else if (absolute < 30 * 24 * 60 * 60_000) text = format.format(Math.round(diff / (24 * 60 * 60_000)), "day");
  else text = date.toLocaleDateString();

  return <span title={date.toLocaleString()}>{text}</span>;
}

// --- Overlay ---------------------------------------------------------------

export function useOverlay(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const viewport = document.querySelector<HTMLElement>(".os-page");
    const previousBodyOverflow = document.body.style.overflow;
    const previousViewportOverflow = viewport?.style.overflow;
    document.body.style.overflow = "hidden";
    if (viewport) viewport.style.overflow = "hidden";
    const timer = requestAnimationFrame(() => {
      if (!ref.current?.contains(document.activeElement)) ref.current?.focus();
    });
    const onKey = (event: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[data-os-overlay="true"]');
      if (dialogs[dialogs.length - 1] !== ref.current) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(timer);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousBodyOverflow;
      if (viewport) viewport.style.overflow = previousViewportOverflow || "";
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);
  return ref;
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const overlayRef = useOverlay(open, onClose);
  const titleId = useId();

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-ink/35" onClick={onClose} aria-hidden />
      <div
        className={`os-drawer relative flex h-full w-full flex-col ${wide ? "max-w-3xl" : "max-w-xl"}`}
        ref={overlayRef}
        tabIndex={-1}
        data-os-overlay="true"
        aria-labelledby={titleId}
        role="dialog"
        aria-modal="true"
      >
        <header className="flex items-start justify-between gap-4 border-b border-line bg-white px-7 py-6">
          <div className="min-w-0">
            <h2 id={titleId} className="os-overlay-title">{title}</h2>
            {subtitle && <div className="mt-0.5 text-xs text-muted">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-[10px] border border-line px-3 py-1 text-[11px] font-medium text-muted transition hover:border-ink/40 hover:text-ink"
          >
            Close
          </button>
        </header>
        <div className="os-overlay-body flex-1 overflow-y-auto px-7 py-6">{children}</div>
        {footer && <footer className="border-t border-line bg-white px-7 py-5">{footer}</footer>}
      </div>
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = "wide",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "wide" | "full";
}) {
  const overlayRef = useOverlay(open, onClose);
  const titleId = useId();

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <div className="fixed inset-0 bg-ink/40" onClick={onClose} aria-hidden />
      <div
        className={`os-modal relative flex w-full flex-col overflow-hidden ${
          size === "full" ? "max-w-[92rem]" : "max-w-4xl"
        }`}
        ref={overlayRef}
        tabIndex={-1}
        data-os-overlay="true"
        aria-labelledby={titleId}
        role="dialog"
        aria-modal="true"
      >
        <header className="flex items-start justify-between gap-4 border-b border-line bg-white px-7 py-6">
          <div className="min-w-0">
            <h2 id={titleId} className="os-overlay-title">{title}</h2>
            {subtitle && <div className="mt-0.5 text-xs text-muted">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-[10px] border border-line px-3 py-1 text-[11px] font-medium text-muted transition hover:border-ink/40 hover:text-ink"
          >
            Close
          </button>
        </header>
        <div className="os-overlay-body max-h-[70vh] flex-1 overflow-auto px-7 py-6">{children}</div>
        {footer && <footer className="border-t border-line bg-white px-7 py-5">{footer}</footer>}
      </div>
    </div>
  );
}

export function StatusDot({ tone }: { tone: "live" | "ok" | "warn" | "bad" | "idle" }) {
  if (tone === "live") {
    return (
      <span className="relative flex h-2.5 w-2.5 shrink-0 items-center justify-center" aria-hidden>
        <span className="sr-only" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-lime" />
      </span>
    );
  }
  const colour = {
    ok: "bg-positive",
    warn: "bg-warn",
    bad: "bg-danger",
    idle: "bg-line-strong",
  }[tone];
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${colour}`} aria-hidden />;
}

export function Tooltip({
  content,
  children,
  placement = "top",
}: {
  content: ReactNode;
  children: ReactNode;
  placement?: "top" | "bottom" | "left" | "right";
}) {
  const [visible, setVisible] = useState(false);
  const positionClasses = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
  }[placement];

  return (
    <span
      className="relative inline-flex items-center"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}
      {visible && (
        <span
          role="tooltip"
          className={`pointer-events-none absolute z-50 whitespace-nowrap rounded-[10px] bg-ink px-2.5 py-1 font-mono text-[11px] font-medium tracking-wide text-white shadow-lift transition-all duration-150 ${positionClasses}`}
        >
          {content}
        </span>
      )}
    </span>
  );
}

export function CopyButton({
  text,
  label,
  className = "",
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? "Copied to clipboard!" : `Copy ${label || text}`}
      className={`group inline-flex items-center gap-1.5 rounded-[10px] border border-line bg-white px-2.5 py-1 text-[11px] font-medium text-muted transition-all duration-150 hover:border-ink/40 hover:text-ink ${className}`}
    >
      {copied ? "Copied" : label || "Copy"}
    </button>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-sunken ${className}`} aria-hidden />;
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="os-card rounded-2xl border border-line bg-white p-6">
      <Skeleton className="mb-4 h-6 w-1/3" />
      <div className="space-y-2">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className={`h-4 ${i === lines - 1 ? "w-2/3" : "w-full"}`} />
        ))}
      </div>
    </div>
  );
}
