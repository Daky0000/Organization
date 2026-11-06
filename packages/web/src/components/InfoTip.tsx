import { useState, useRef, useEffect, type ReactNode } from 'react';
import { HelpCircle } from 'lucide-react';

// Small "?" icon that reveals a plain-language explanation on hover, keyboard
// focus, or tap (mobile). Use next to any label or term a first-time user
// might not know. Keep the text to 1–2 short sentences — say what the thing
// does for the user, not how it works internally.
//
//   <InfoTip text="Credits are your AI budget. Every AI action uses a few; they refill monthly with your plan." />
//
// Optional `label` renders the term and the icon together:
//   <InfoTip label="UTM tracking" text="Adds tags to your links so you can see which campaign each visitor came from." />

type Props = {
  text: ReactNode;
  label?: ReactNode;
  /** Tooltip position relative to the icon. Default: top. */
  side?: 'top' | 'bottom';
  className?: string;
};

export default function InfoTip({ text, label, side = 'top', className = '' }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  // Tap-to-toggle needs an outside-tap close on touch devices
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent | TouchEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    document.addEventListener('touchstart', handle);
    return () => {
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('touchstart', handle);
    };
  }, [open]);

  const pos = side === 'top'
    ? 'bottom-full left-1/2 -translate-x-1/2 mb-2'
    : 'top-full left-1/2 -translate-x-1/2 mt-2';
  const arrow = side === 'top'
    ? 'top-full left-1/2 -translate-x-1/2 border-t-slate-900 border-x-transparent border-b-transparent'
    : 'bottom-full left-1/2 -translate-x-1/2 border-b-slate-900 border-x-transparent border-t-transparent';

  return (
    <span ref={wrapRef} className={`relative inline-flex items-center gap-1 ${className}`}>
      {label && <span>{label}</span>}
      <button
        type="button"
        aria-label="More info"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
        className="inline-flex shrink-0 cursor-help items-center justify-center rounded-full text-slate-400 transition-colors hover:text-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-300"
      >
        <HelpCircle size={14} />
      </button>
      {open && (
        <span
          role="tooltip"
          className={`pointer-events-none absolute z-50 w-60 rounded-xl bg-slate-900 px-3.5 py-2.5 text-xs font-medium leading-relaxed text-white shadow-xl ${pos}`}
        >
          {text}
          <span className={`absolute h-0 w-0 border-[5px] ${arrow}`} />
        </span>
      )}
    </span>
  );
}
