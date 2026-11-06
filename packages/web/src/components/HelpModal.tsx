import { Compass, ExternalLink, Mail, MessageCircle, Sparkles, X } from 'lucide-react';

type Props = {
  onClose: () => void;
  onStartTour?: () => void;
};

const DOCS = [
  { label: 'Getting started', href: 'https://docs.dakyworld.com/getting-started' },
  { label: 'Scheduling posts', href: 'https://docs.dakyworld.com/posts' },
  { label: 'Marketing automations', href: 'https://docs.dakyworld.com/automations' },
  { label: 'Billing & plans', href: 'https://docs.dakyworld.com/billing' },
];

export default function HelpModal({ onClose, onStartTour }: Props) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-navy/35 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-[22px] bg-white shadow-menu border border-line">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div className="flex items-center gap-2.5">
            <img src="/brand/mark-on-light-96.png" alt="DakyXTech" className="h-7 w-7 rounded-[8px]" />
            <div>
              <h2 className="text-[15px] font-medium text-ink leading-tight">Help &amp; Support</h2>
              <p className="text-[11px] text-muted">DakyXTech Marketing OS</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-[8px] text-muted hover:bg-soft hover:text-ink transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Guided Tour Banner */}
          {onStartTour && (
            <div className="rounded-xl border border-blue/20 bg-pale/60 p-3.5 flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue text-white shadow-sm">
                <Compass size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-xs font-semibold text-ink">Interactive Guided Tour</h3>
                <p className="text-[11.5px] text-muted leading-relaxed mt-0.5">
                  Take a 60-second guided walkthrough of your dashboard, AI agents, publishing studio, and connected channels.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onStartTour();
                  }}
                  className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-blue px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-d transition-colors shadow-sm"
                >
                  <Sparkles size={12} />
                  Start Guided Tour
                </button>
              </div>
            </div>
          )}

          {/* Docs */}
          <div>
            <p className="mb-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted">Documentation</p>
            <div className="space-y-1">
              {DOCS.map((d) => (
                <a
                  key={d.label}
                  href={d.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between rounded-[10px] px-3.5 py-2.5 text-[13px] font-medium text-ink hover:bg-soft hover:text-blue transition-colors group"
                >
                  {d.label}
                  <ExternalLink size={12} className="text-faint group-hover:text-blue transition-colors" />
                </a>
              ))}
            </div>
          </div>

          <div className="h-px bg-line" />

          {/* Contact */}
          <div>
            <p className="mb-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted">Contact us</p>
            <div className="space-y-1">
              <a
                href="mailto:support@dakyworld.com"
                className="flex items-center gap-3 rounded-[10px] px-3.5 py-2.5 text-[13px] font-medium text-ink hover:bg-soft hover:text-blue transition-colors"
              >
                <Mail size={14} className="text-muted shrink-0" />
                support@dakyworld.com
              </a>
              <a
                href="https://dakyworld.com/chat"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 rounded-[10px] px-3.5 py-2.5 text-[13px] font-medium text-ink hover:bg-soft hover:text-blue transition-colors"
              >
                <MessageCircle size={14} className="text-muted shrink-0" />
                Live chat
              </a>
            </div>
          </div>

          <div className="h-px bg-line" />

          <div className="flex items-center justify-between text-[11.5px] text-muted">
            <img src="/brand/lockup-on-light.png" alt="DakyXTech" className="h-4 w-auto opacity-85" />
            <span>Response time within 24h</span>
          </div>
        </div>
      </div>
    </div>
  );
}
