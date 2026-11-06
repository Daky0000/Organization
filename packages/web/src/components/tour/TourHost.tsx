import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Compass } from 'lucide-react';
import { TOUR_EVENTS, placeCard, requestTourTab, tourSettled, type Tour, type TourStep } from './tourCore';
import { recordTour, useTourState } from './tourStore';
import './tour.css';

// ─────────────────────────────────────────────────────────────────────────────
// Runs guided tours over the app (one at a time): a "New here?" card the first
// time a page with a tour opens, a spotlight + step card for each step, and a
// "You're all set" card at the end. Pages send actions (tourAction) so "Try
// it" steps move on when the user does the thing; they switch tabs for a step
// with useTourTab.
// ─────────────────────────────────────────────────────────────────────────────

type Rect = { top: number; left: number; width: number; height: number };
const PAD = 6;
const CONFETTI = ['#2563EB', '#8FB2FF', '#2F8F5B', '#F59E0B', '#0D1526'];

const check = (size = 13) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
);

/** The first matching element that is actually on screen (has a size). */
function findTarget(selector: string): HTMLElement | null {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

const sameRect = (a: Rect | null, b: Rect | null) => !!a && !!b && Math.abs(a.top - b.top) < 1 && Math.abs(a.left - b.left) < 1 && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1;

export default function TourHost({ tours, page, userId, paused = false, onNavigate }: {
  tours: Record<string, Tour>;
  page: string;
  userId: string | null;
  /** Something else has the screen (onboarding, the system tour): no welcome card. */
  paused?: boolean;
  onNavigate: (page: string) => void;
}) {
  const progress = useTourState(userId);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [finished, setFinished] = useState<string | null>(null);
  const [pendingStart, setPendingStart] = useState<string | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [missing, setMissing] = useState(false);
  const [acted, setActed] = useState(false);
  const [cardSize, setCardSize] = useState({ w: 320, h: 220 });
  const [view, setView] = useState({ width: window.innerWidth, height: window.innerHeight });
  // The "New here?" card: once per page per visit, after the page has drawn.
  const [welcomeReady, setWelcomeReady] = useState(false);
  const [welcomeHidden, setWelcomeHidden] = useState<Set<string>>(() => new Set());

  const cardRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const direction = useRef<1 | -1>(1);

  const tour = activeId ? tours[activeId] ?? null : null;
  const current: TourStep | null = tour ? tour.steps[step] ?? null : null;
  const pageTour = useMemo(() => Object.values(tours).find((t) => t.page === page) ?? null, [tours, page]);

  // ── Starting, moving, ending ───────────────────────────────────────────────
  const begin = useCallback((id: string) => {
    const t = tours[id];
    if (!t) return;
    direction.current = 1;
    setFinished(null);
    setActed(false);
    setRect(null);
    setMissing(false);
    setStep(0);
    setActiveId(id);
    recordTour(id, { status: 'started', step: 0 });
  }, [tours]);

  const start = useCallback((id: string) => {
    const t = tours[id];
    if (!t) return;
    setWelcomeHidden((s) => new Set(s).add(t.page));
    if (t.page !== page) { setPendingStart(id); onNavigate(t.page); return; }
    begin(id);
  }, [tours, page, onNavigate, begin]);

  // A tour asked for on another page starts once that page is showing.
  useEffect(() => {
    if (!pendingStart) return;
    const t = tours[pendingStart];
    if (t && t.page === page) {
      const id = pendingStart;
      // Cleared inside the timer: clearing it first would re-run this effect and cancel the timer.
      const timer = window.setTimeout(() => { setPendingStart(null); begin(id); }, 350);
      return () => window.clearTimeout(timer);
    }
  }, [pendingStart, page, tours, begin]);

  const end = useCallback((status: 'dismissed' | 'done') => {
    if (!activeId) return;
    recordTour(activeId, { status, step });
    if (status === 'done') setFinished(activeId);
    setActiveId(null);
    setRect(null);
    targetRef.current = null;
  }, [activeId, step]);

  const move = useCallback((delta: 1 | -1) => {
    if (!tour) return;
    direction.current = delta;
    const next = step + delta;
    if (next >= tour.steps.length) { end('done'); return; }
    if (next < 0) return;
    setActed(false);
    setStep(next);
    recordTour(tour.id, { status: 'started', step: next });
  }, [tour, step, end]);

  // Anything (a hub card, a help menu) can start a tour.
  useEffect(() => {
    const onStart = (e: Event) => { const id = (e as CustomEvent).detail?.id; if (typeof id === 'string') start(id); };
    window.addEventListener(TOUR_EVENTS.start, onStart);
    return () => window.removeEventListener(TOUR_EVENTS.start, onStart);
  }, [start]);

  // Leaving the page mid-tour ends it (it can be replayed from the page).
  useEffect(() => {
    if (tour && tour.page !== page && !pendingStart) { recordTour(tour.id, { status: 'dismissed', step }); setActiveId(null); setRect(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // ── Finding the step's control ─────────────────────────────────────────────
  useEffect(() => {
    if (!tour || !current) return;
    if (current.tab) requestTourTab(tour.scope, current.tab);
    targetRef.current = null;
    setMissing(false);
    if (!current.target) { setRect(null); return; }
    let cancelled = false;
    let tries = 0;
    const locate = () => {
      if (cancelled) return;
      const el = findTarget(current.target!);
      if (el) {
        targetRef.current = el;
        const r = el.getBoundingClientRect();
        if (r.top < 70 || r.bottom > window.innerHeight - 40) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        window.setTimeout(() => { if (!cancelled && targetRef.current === el) { const b = el.getBoundingClientRect(); setRect({ top: b.top, left: b.left, width: b.width, height: b.height }); } }, r.top < 70 || r.bottom > window.innerHeight - 40 ? 320 : 0);
        return;
      }
      // Pages load their data a moment after they open: keep looking for 1.5 s.
      if (++tries < 15) { window.setTimeout(locate, 100); return; }
      if (current.optional) { move(direction.current); return; }
      setRect(null);
      setMissing(true);
    };
    locate();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour?.id, step]);

  // Follow the control while the page scrolls, resizes or re-lays out.
  useEffect(() => {
    if (!tour) return;
    let frame = 0;
    const tick = () => {
      const el = targetRef.current;
      if (el && el.isConnected) {
        const b = el.getBoundingClientRect();
        const next = { top: b.top, left: b.left, width: b.width, height: b.height };
        setRect((prev) => (sameRect(prev, next) ? prev : next));
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    const onResize = () => setView({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener('resize', onResize); };
  }, [tour]);

  // ── "Try it" steps move on when the user does the thing ────────────────────
  useEffect(() => {
    if (!current?.waitFor) return;
    const want = current.waitFor;
    let timer = 0;
    const onAction = (e: Event) => {
      if ((e as CustomEvent).detail?.action !== want) return;
      setActed(true);
      timer = window.setTimeout(() => move(1), 750);
    };
    window.addEventListener(TOUR_EVENTS.action, onAction);
    return () => { window.removeEventListener(TOUR_EVENTS.action, onAction); window.clearTimeout(timer); };
  }, [current, move]);

  // ── Keyboard: Esc ends, ← → move (not while typing, not on a "Try it" step) ─
  useEffect(() => {
    if (!tour) return;
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]');
      if (e.key === 'Escape') { e.stopPropagation(); end('dismissed'); }
      else if (!typing && e.key === 'ArrowRight' && !current?.waitFor) { e.preventDefault(); move(1); }
      else if (!typing && e.key === 'ArrowLeft' && step > 0) { e.preventDefault(); move(-1); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [tour, current, step, move, end]);

  // The primary button gets the focus on every step (keyboard and screen readers follow).
  useEffect(() => { const t = window.setTimeout(() => primaryRef.current?.focus({ preventScroll: true }), 60); return () => window.clearTimeout(t); }, [activeId, step, finished, rect === null]);

  useLayoutEffect(() => {
    if (cardRef.current) setCardSize({ w: cardRef.current.offsetWidth, h: cardRef.current.offsetHeight });
  }, [activeId, step, missing, acted, rect === null, finished]);

  // ── The "New here?" card ───────────────────────────────────────────────────
  useEffect(() => {
    setWelcomeReady(false);
    const t = window.setTimeout(() => setWelcomeReady(true), 900);
    return () => window.clearTimeout(t);
  }, [page]);

  const shake = () => cardRef.current?.animate(
    [{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'none' }],
    { duration: 250 },
  );

  const root = typeof document !== 'undefined' ? document.body : null;
  if (!root) return null;

  // Finished: what was learned, with Replay.
  if (!tour && finished && tours[finished]) {
    const t = tours[finished];
    return createPortal(
      <>
        <div className="dt-veil" onClick={() => setFinished(null)} aria-hidden="true" />
        <div ref={cardRef} className="dt-card center" role="dialog" aria-modal="true" aria-label="Tour finished" style={{ top: Math.max(16, (view.height - cardSize.h) / 2), left: Math.max(12, (view.width - Math.min(420, view.width - 24)) / 2) }}>
          <div className="dt-body dt-done">
            <h3>You're all set</h3>
            <p>Here's what you just learned:</p>
            <ul>{(t.done.length ? t.done : [t.summary]).map((d) => <li key={d}>{check()}{d}</li>)}</ul>
          </div>
          <div className="dt-foot">
            <button type="button" className="dt-btn dt-ghost" onClick={() => begin(t.id)}>Replay</button>
            <span style={{ flex: 1 }} />
            <button ref={primaryRef} type="button" className="dt-btn dt-pri" onClick={() => setFinished(null)}>Start working</button>
          </div>
        </div>
        <div className="dt-confetti" aria-hidden="true">
          {Array.from({ length: 28 }, (_, i) => (
            <i key={i} style={{ left: `${(i * 37) % 100}%`, background: CONFETTI[i % CONFETTI.length], animationDelay: `${(i % 7) * 0.08}s` }} />
          ))}
        </div>
      </>,
      root,
    );
  }

  // Not running: offer the page's tour the first time it opens.
  if (!tour || !current) {
    const offer = pageTour && welcomeReady && !paused && !pendingStart && userId && !progress.tours[pageTour.id] && !tourSettled(progress, pageTour.id) && !welcomeHidden.has(pageTour.page);
    if (!offer || !pageTour) return null;
    const notNow = () => { setWelcomeHidden((s) => new Set(s).add(pageTour.page)); recordTour(pageTour.id, { status: 'dismissed', step: 0 }); };
    const w = pageTour.welcome ?? { title: `New here? Take the ${pageTour.minutes}-minute tour.`, body: pageTour.summary };
    return createPortal(
      <div className="dt-card corner" role="region" aria-label={`${pageTour.title} tour`}>
        <div className="dt-body">
          <span className="dt-step" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Compass size={12} /> {pageTour.minutes}-MINUTE TOUR</span>
          <h3>{w.title}</h3>
          <p>{w.body}</p>
        </div>
        <div className="dt-foot">
          <button type="button" className="dt-btn dt-ghost" onClick={notNow}>Not now</button>
          <span style={{ flex: 1 }} />
          <button type="button" className="dt-btn dt-pri" onClick={() => start(pageTour.id)}>Start the tour</button>
        </div>
      </div>,
      root,
    );
  }

  // ── A step ─────────────────────────────────────────────────────────────────
  const total = tour.steps.length;
  const last = step === total - 1;
  const cardW = Math.min(320, view.width - 24);
  const ring = rect ? { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 } : null;
  const pos = ring
    ? placeCard(ring, cardW, cardSize.h, view, current.side)
    : { top: Math.max(16, (view.height - cardSize.h) / 2), left: (view.width - cardW) / 2, side: 'inside' as const };
  const waiting = Boolean(current.waitFor) && !acted;

  // Arrow from the card to the control.
  let arrow: React.CSSProperties | null = null;
  if (ring && pos.side !== 'inside') {
    const cx = Math.max(16, Math.min(cardW - 28, ring.left + ring.width / 2 - pos.left - 6));
    const cy = Math.max(16, Math.min(cardSize.h - 28, ring.top + Math.min(ring.height / 2, 46) - pos.top - 6));
    if (pos.side === 'bottom') arrow = { top: -7, left: cx, borderRight: 'none', borderBottom: 'none' };
    if (pos.side === 'top') arrow = { bottom: -7, left: cx, borderLeft: 'none', borderTop: 'none' };
    if (pos.side === 'right') arrow = { left: -7, top: cy, borderTop: 'none', borderRight: 'none' };
    if (pos.side === 'left') arrow = { right: -7, top: cy, borderBottom: 'none', borderLeft: 'none' };
  }

  // Outside the spotlight is blocked (a click shakes the card). On a "Try it"
  // step the spotlighted control stays usable; otherwise it is blocked too.
  const blockers = ring && waiting
    ? [
      { top: 0, left: 0, width: view.width, height: Math.max(0, ring.top) },
      { top: ring.top + ring.height, left: 0, width: view.width, height: Math.max(0, view.height - ring.top - ring.height) },
      { top: ring.top, left: 0, width: Math.max(0, ring.left), height: ring.height },
      { top: ring.top, left: ring.left + ring.width, width: Math.max(0, view.width - ring.left - ring.width), height: ring.height },
    ]
    : [{ top: 0, left: 0, width: view.width, height: view.height }];

  return createPortal(
    <>
      {ring
        ? <div className={`dt-ring${waiting ? ' wait' : ''}`} style={ring} aria-hidden="true" />
        : <div className="dt-veil" aria-hidden="true" />}
      {blockers.map((b, i) => <div key={i} className="dt-block" style={b} onClick={shake} aria-hidden="true" />)}
      <div
        ref={cardRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="false"
        aria-labelledby="dt-step-title"
        aria-describedby="dt-step-body"
        className="dt-card"
        style={{ top: pos.top, left: pos.left, width: cardW }}
      >
        <div className="dt-body">
          <span className="dt-step">STEP {step + 1} OF {total} · {tour.title.toUpperCase()}</span>
          <h3 id="dt-step-title">{acted ? 'Done ✓' : current.title}</h3>
          <p id="dt-step-body" aria-live="polite">
            {current.body}
            {missing && ' (This part is not on screen right now.)'}
          </p>
          {current.tip && (
            <div className="dt-tip"><span>{current.tip[0]}</span>{current.tip[1] && <kbd>{current.tip[1]}</kbd>}</div>
          )}
          {current.waitFor && current.doText && !acted && !missing && (
            <div className="dt-do"><span className="dt-pulse" />{current.doText}</div>
          )}
        </div>
        <div className="dt-foot">
          <div className="dt-dots" aria-hidden="true">
            {tour.steps.map((s, i) => <i key={s.id} className={i === step ? 'on' : i < step ? 'done' : ''} />)}
          </div>
          <button type="button" className="dt-skip" onClick={() => end('dismissed')}>Skip</button>
          {step > 0 && <button type="button" className="dt-btn dt-ghost" onClick={() => move(-1)}>Back</button>}
          <button ref={primaryRef} type="button" className="dt-btn dt-pri" onClick={() => move(1)}>
            {last ? 'Finish' : waiting ? 'Skip step' : 'Next'}
          </button>
        </div>
        {arrow && <span className="dt-arrow" style={arrow} />}
      </div>
    </>,
    root,
  );
}
