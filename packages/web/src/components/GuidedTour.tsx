import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Compass,
  X,
} from 'lucide-react';

export type TourStep = {
  id?: string;
  title: string;
  description: string;
  emoji?: string;
  target?: string;
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'center';
  page?: string;
  badge?: string;
  actionLabel?: string;
};

export type GuidedTourProps = {
  isOpen: boolean;
  steps: TourStep[];
  initialStepIndex?: number;
  tourTitle?: string;
  onClose: () => void;
  onComplete?: () => void;
  currentPage?: string;
  onNavigate?: (page: string) => void;
};

export const SYSTEM_TOUR_STEPS: TourStep[] = [
  {
    id: 'intro',
    title: 'Welcome to DakyXTech Marketing OS',
    description:
      'Your complete autonomous AI marketing operating system. In 60 seconds, explore how your AI agent team, multi-platform studio, brand memory, and social integrations work together.',
    emoji: '🚀',
    placement: 'center',
    badge: 'System Tour',
    actionLabel: 'Start Tour',
  },
  {
    id: 'nav',
    title: 'Unified Workspace Navigation',
    description:
      'Easily navigate between your Dashboard, Content Studio, Social Integrations, CRM Pipelines, Automations, and System Settings.',
    target: '[data-tour-id="nav-dashboard"]',
    placement: 'right',
    emoji: '🧭',
    badge: 'Navigation',
  },
  {
    id: 'dashboard-stats',
    title: 'Executive Performance Metrics',
    description:
      'Track your total posts, scheduled queue, active campaigns, and connected social reach in one unified real-time overview.',
    target: '[data-tour-id="dashboard-stats"]',
    placement: 'bottom',
    page: 'dashboard',
    emoji: '📊',
    badge: 'Metrics',
  },
  {
    id: 'agent-activity',
    title: 'Autonomous AI Agent Workforce',
    description:
      'Meet Nova, Sage, Aria, and Flux. Your AI agents work 24/7 in the background — monitoring competitor niches, generating campaign angles, and optimizing your copy.',
    target: '[data-tour-id="dashboard-agent-activity"]',
    placement: 'left',
    page: 'dashboard',
    emoji: '🤖',
    badge: 'AI Agents',
  },
  {
    id: 'quick-actions',
    title: 'Quick Action Shortcuts',
    description:
      'One-click shortcuts to compose a new post, launch the visual card builder, brainstorm fresh angles, or import new leads.',
    target: '[data-tour-id="dashboard-quick-actions"]',
    placement: 'top',
    page: 'dashboard',
    emoji: '⚡',
    badge: 'Quick Launch',
  },
  {
    id: 'posts',
    title: 'Omnichannel Post Publishing',
    description:
      'Compose once and schedule everywhere. Live previews show how your post will render on Instagram, LinkedIn, X, Facebook, and TikTok with platform constraints enforced.',
    target: '[data-tour-id="btn-new-post"]',
    placement: 'bottom',
    page: 'posts',
    emoji: '✍️',
    badge: 'Publishing',
  },
  {
    id: 'memory',
    title: 'Brand Knowledge Base & Memory',
    description:
      'Teach your AI once about your brand values, target audience, and offerings. All agents read your brand memory so all generated copy sounds 100% authentically yours.',
    target: '[data-tour-id="btn-generate-memory"]',
    placement: 'bottom',
    page: 'memory',
    emoji: '🧠',
    badge: 'Personalization',
  },
  {
    id: 'integrations',
    title: 'OAuth Social Connections',
    description:
      'Securely connect your real-world social platforms with one-click OAuth to enable automatic scheduling, audience syncing, and AI analytics.',
    target: '[data-tour-id="integrations-cards"]',
    placement: 'top',
    page: 'integrations',
    emoji: '🔌',
    badge: 'Integrations',
  },
  {
    id: 'chat-widget',
    title: 'Daky — Your 24/7 AI Marketing Butler',
    description:
      'Click this bubble anytime in the bottom right to brainstorm viral hooks, write long-form copy, review strategy, or ask marketing questions.',
    target: '[data-tour-id="chat-widget-button"]',
    placement: 'left',
    emoji: '💬',
    badge: 'AI Butler',
  },
  {
    id: 'complete',
    title: "You're All Set to Launch! 🎉",
    description:
      'You now know your way around Marketing OS. Ready to create your first post, brief your agents, or connect your social accounts?',
    placement: 'center',
    page: 'dashboard',
    emoji: '🏆',
    badge: 'Ready to Roll',
    actionLabel: 'Go to Dashboard',
  },
];

export default function GuidedTour({
  isOpen,
  steps,
  initialStepIndex = 0,
  tourTitle = 'Guided Tour',
  onClose,
  onComplete,
  currentPage,
  onNavigate,
}: GuidedTourProps) {
  const [stepIndex, setStepIndex] = useState(initialStepIndex);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [cardPlacement, setCardPlacement] = useState<'top' | 'bottom' | 'left' | 'right' | 'center'>('center');
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({});
  const [isNavigatingPage, setIsNavigatingPage] = useState(false);

  const cardRef = useRef<HTMLDivElement>(null);

  // Sync stepIndex when initialStepIndex changes
  useEffect(() => {
    if (isOpen) {
      setStepIndex(initialStepIndex);
    }
  }, [isOpen, initialStepIndex]);

  const currentStep = steps[stepIndex] ?? steps[0];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;

  // Handle cross-page navigation
  useEffect(() => {
    if (!isOpen || !currentStep?.page || !onNavigate) return;
    if (currentPage && currentPage !== currentStep.page) {
      setIsNavigatingPage(true);
      onNavigate(currentStep.page);
      const timer = setTimeout(() => {
        setIsNavigatingPage(false);
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [isOpen, currentStep?.page, currentPage, onNavigate]);

  // Find target element with retries and compute bounding box
  const updateTargetRect = useCallback(() => {
    if (!isOpen || !currentStep) return;

    if (!currentStep.target) {
      setTargetRect(null);
      setCardPlacement(currentStep.placement ?? 'center');
      return;
    }

    let attempts = 0;
    const maxAttempts = 12;

    const locate = () => {
      const el = document.querySelector(currentStep.target!) as HTMLElement | null;
      if (el) {
        const rect = el.getBoundingClientRect();
        // If element is visible
        if (rect.width > 0 && rect.height > 0) {
          // Scroll element into view if partly off-screen
          const inViewport =
            rect.top >= 0 &&
            rect.left >= 0 &&
            rect.bottom <= window.innerHeight &&
            rect.right <= window.innerWidth;

          if (!inViewport) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
            // re-read after brief scroll
            setTimeout(() => {
              const freshRect = el.getBoundingClientRect();
              setTargetRect(freshRect);
            }, 180);
          } else {
            setTargetRect(rect);
          }
          return;
        }
      }

      attempts++;
      if (attempts < maxAttempts) {
        setTimeout(locate, 70);
      } else {
        // Fallback to center if element cannot be found or is hidden
        setTargetRect(null);
        setCardPlacement('center');
      }
    };

    locate();
  }, [isOpen, currentStep]);

  useEffect(() => {
    updateTargetRect();
  }, [updateTargetRect, isNavigatingPage]);

  // Listen to window resize and scroll
  useEffect(() => {
    if (!isOpen) return;
    const handleReposition = () => {
      if (currentStep?.target) {
        const el = document.querySelector(currentStep.target) as HTMLElement | null;
        if (el) {
          setTargetRect(el.getBoundingClientRect());
        }
      }
    };
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);
    return () => {
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [isOpen, currentStep]);

  // Compute Popover Position based on Target Rect & Desired Placement
  useLayoutEffect(() => {
    if (!isOpen) return;

    const CARD_WIDTH = Math.min(380, window.innerWidth - 32);
    const CARD_HEIGHT = cardRef.current?.offsetHeight ?? 240;
    const SPACING = 14;

    if (!targetRect || currentStep?.placement === 'center') {
      setCardPlacement('center');
      setPopoverStyle({
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: CARD_WIDTH,
      });
      return;
    }

    let desired = currentStep?.placement ?? 'bottom';
    let top = 0;
    let left = 0;

    // Check bottom placement
    if (desired === 'bottom') {
      top = targetRect.bottom + SPACING;
      left = targetRect.left + targetRect.width / 2 - CARD_WIDTH / 2;
      // Flip to top if not enough room on bottom
      if (top + CARD_HEIGHT > window.innerHeight - 16 && targetRect.top - CARD_HEIGHT - SPACING > 16) {
        desired = 'top';
        top = targetRect.top - CARD_HEIGHT - SPACING;
      }
    } else if (desired === 'top') {
      top = targetRect.top - CARD_HEIGHT - SPACING;
      left = targetRect.left + targetRect.width / 2 - CARD_WIDTH / 2;
      // Flip to bottom if not enough room on top
      if (top < 16 && targetRect.bottom + CARD_HEIGHT + SPACING < window.innerHeight - 16) {
        desired = 'bottom';
        top = targetRect.bottom + SPACING;
      }
    } else if (desired === 'right') {
      top = targetRect.top + targetRect.height / 2 - CARD_HEIGHT / 2;
      left = targetRect.right + SPACING;
      // Flip to left if not enough room on right
      if (left + CARD_WIDTH > window.innerWidth - 16 && targetRect.left - CARD_WIDTH - SPACING > 16) {
        desired = 'left';
        left = targetRect.left - CARD_WIDTH - SPACING;
      }
    } else if (desired === 'left') {
      top = targetRect.top + targetRect.height / 2 - CARD_HEIGHT / 2;
      left = targetRect.left - CARD_WIDTH - SPACING;
      // Flip to right if not enough room on left
      if (left < 16 && targetRect.right + CARD_WIDTH + SPACING < window.innerWidth - 16) {
        desired = 'right';
        left = targetRect.right + SPACING;
      }
    }

    // Clamp inside viewport
    left = Math.max(16, Math.min(left, window.innerWidth - CARD_WIDTH - 16));
    top = Math.max(16, Math.min(top, window.innerHeight - CARD_HEIGHT - 16));

    setCardPlacement(desired);
    setPopoverStyle({
      position: 'fixed',
      top,
      left,
      width: CARD_WIDTH,
    });
  }, [isOpen, targetRect, currentStep, stepIndex]);

  // Keyboard navigation: Enter/Right = Next, Left = Prev, Esc = Exit
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault();
        if (isLast) {
          handleFinish();
        } else {
          setStepIndex((i) => Math.min(steps.length - 1, i + 1));
        }
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (!isFirst) {
          setStepIndex((i) => Math.max(0, i - 1));
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isFirst, isLast, steps.length, onClose]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleNext = () => {
    if (isLast) {
      handleFinish();
    } else {
      setStepIndex((i) => i + 1);
    }
  };

  const handlePrev = () => {
    if (!isFirst) {
      setStepIndex((i) => i - 1);
    }
  };

  const handleFinish = () => {
    localStorage.setItem('system_tour_completed', '1');
    onComplete?.();
    onClose();
  };

  if (!isOpen || !currentStep) return null;

  const pad = 8;
  const progressPercent = ((stepIndex + 1) / steps.length) * 100;

  return (
    <div className="guided-tour-root">
      {/* ── Dark Backdrop with Cutout Spotlight ── */}
      <svg
        className="fixed inset-0 w-full h-full pointer-events-auto z-[9990] transition-opacity duration-300"
        style={{ pointerEvents: 'auto' }}
        onClick={(e) => {
          // Prevent accidental backdrop clicks from interfering
          e.stopPropagation();
        }}
      >
        <defs>
          <mask id="guided-tour-spotlight-mask">
            <rect width="100%" height="100%" fill="white" />
            {targetRect && cardPlacement !== 'center' && (
              <rect
                x={targetRect.left - pad}
                y={targetRect.top - pad}
                width={targetRect.width + pad * 2}
                height={targetRect.height + pad * 2}
                rx="12"
                ry="12"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(15, 23, 42, 0.68)"
          mask="url(#guided-tour-spotlight-mask)"
          className="transition-all duration-300"
        />
      </svg>

      {/* ── Highlight Border Ring around Target ── */}
      {targetRect && cardPlacement !== 'center' && (
        <div
          className="fixed pointer-events-none z-[9992] transition-all duration-300 ease-out"
          style={{
            left: targetRect.left - pad,
            top: targetRect.top - pad,
            width: targetRect.width + pad * 2,
            height: targetRect.height + pad * 2,
            borderRadius: 12,
            boxShadow:
              '0 0 0 2px #3B82F6, 0 0 0 6px rgba(59, 130, 246, 0.28), 0 0 24px rgba(59, 130, 246, 0.45)',
          }}
        >
          {/* Animated beacon badge */}
          <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-4 w-4 bg-blue-600 border-2 border-white" />
          </span>
        </div>
      )}

      {/* ── Floating Popover Card ── */}
      <div
        ref={cardRef}
        style={popoverStyle}
        className="fixed z-[9995] rounded-2xl border border-slate-200/80 bg-white shadow-2xl shadow-slate-900/30 overflow-hidden transition-all duration-200 ease-out animate-in fade-in zoom-in-95"
      >
        {/* Top Progress Bar */}
        <div className="h-1.5 w-full bg-slate-100">
          <div
            className="h-full bg-gradient-to-r from-blue-500 via-indigo-600 to-violet-600 transition-all duration-300 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Card Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700">
              <Compass size={12} className="text-blue-600" />
              {currentStep.badge || tourTitle}
            </span>
            <span className="text-[11.5px] font-mono font-medium text-slate-400">
              {stepIndex + 1} / {steps.length}
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
            title="Exit tour (Esc)"
          >
            <X size={15} />
          </button>
        </div>

        {/* Card Content */}
        <div className="px-5 py-3">
          <div className="flex items-start gap-3.5 mb-2.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-50 to-indigo-100 text-2xl shadow-inner border border-blue-100/60">
              {currentStep.emoji || '✨'}
            </div>
            <div className="flex-1 min-w-0 pt-0.5">
              <h3 className="text-[15px] font-bold text-slate-900 leading-snug tracking-tight">
                {currentStep.title}
              </h3>
            </div>
          </div>

          <p className="text-[13px] text-slate-600 leading-relaxed font-normal">
            {currentStep.description}
          </p>
        </div>

        {/* Card Footer with Controls */}
        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3.5 bg-slate-50/70">
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-medium text-slate-400 hover:text-slate-600 transition-colors"
          >
            Skip tour
          </button>

          <div className="flex items-center gap-2">
            {!isFirst && (
              <button
                type="button"
                onClick={handlePrev}
                className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors shadow-sm"
              >
                <ArrowLeft size={13} />
                Back
              </button>
            )}

            <button
              type="button"
              onClick={handleNext}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-blue-700 transition-colors shadow-md shadow-blue-500/20"
            >
              <span>{currentStep.actionLabel || (isLast ? 'Complete' : 'Next')}</span>
              {isLast ? <Check size={13} /> : <ArrowRight size={13} />}
            </button>
          </div>
        </div>

        {/* Keyboard Hint */}
        <div className="px-5 py-1.5 bg-slate-100/60 border-t border-slate-200/50 flex items-center justify-between text-[10.5px] text-slate-400 font-mono">
          <span>Navigate: ↵ or →</span>
          <span>Close: Esc</span>
        </div>
      </div>
    </div>
  );
}
