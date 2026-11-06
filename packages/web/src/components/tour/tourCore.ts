// ─────────────────────────────────────────────────────────────────────────────
// Guided tours — the shared pieces: what a tour is, how pages talk to the tour
// (events), where progress is kept, and where the card goes on screen.
//
// Modelled on the DakyX editor's tours: short tours of one tool each, a
// spotlight on the real control, "Try it" steps that wait for the user to do
// the thing, optional steps that are skipped when their control is not on
// screen, and progress remembered per user (this browser + the server).
//
// Pure (no React) so the logic can be tested on its own.
// ─────────────────────────────────────────────────────────────────────────────

export type TourSide = 'top' | 'bottom' | 'left' | 'right';

export interface TourStep {
  id: string;
  /** CSS selector of the control to spotlight; none = a card in the middle of the screen. */
  target?: string;
  title: string;
  body: string;
  /** Preferred side for the card; it moves when there is no room. */
  side?: TourSide;
  /** Switch the page to this tab first (the page listens with useTourTab). */
  tab?: string;
  /** Skipped (not shown as missing) when its control is not on screen. */
  optional?: boolean;
  /** The step waits for this action (sent by the page with tourAction) — a "Try it" step. */
  waitFor?: string;
  /** What to do, shown with a pulse on a waitFor step, e.g. "Try it: open Segments". */
  doText?: string;
  /** A hint row, e.g. ["Search", "Ctrl K"]. */
  tip?: [string, string?];
}

export interface Tour {
  id: string;
  /** The app page the tour runs on (App's PageType). */
  page: string;
  /** Tab events are scoped to the page that owns them. */
  scope: string;
  title: string;
  summary: string;
  minutes: number;
  /** The "New here?" card shown the first time the page opens. */
  welcome?: { title: string; body: string };
  /** "Here's what you just learned" on the finished card. */
  done: string[];
  steps: TourStep[];
}

// ── Events: pages ↔ tour ─────────────────────────────────────────────────────

export const TOUR_EVENTS = {
  /** A page tells the tour the user did something (detail.action). */
  action: 'daky:tour-action',
  /** Anything can start a tour (detail.id). */
  start: 'daky:tour-start',
  /** The tour asks a page to show a tab (detail.scope, detail.tab). */
  tab: 'daky:tour-tab',
} as const;

/** Call from a page when the user does something a "Try it" step may be waiting for. */
export function tourAction(action: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(TOUR_EVENTS.action, { detail: { action } }));
}

/** Start a tour by id from anywhere (a button, a help menu). */
export function startTour(id: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(TOUR_EVENTS.start, { detail: { id } }));
}

export function requestTourTab(scope: string, tab: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(TOUR_EVENTS.tab, { detail: { scope, tab } }));
}

// ── Progress ─────────────────────────────────────────────────────────────────

export type TourStatus = 'started' | 'dismissed' | 'done';
export interface TourRecord { status: TourStatus; step: number; at: string }
export interface TourState { tours: Record<string, TourRecord> }

const RANK: Record<TourStatus, number> = { started: 0, dismissed: 1, done: 2 };

/**
 * Two copies of the progress (this browser, the server) made one. The newer
 * record wins, except that a stale "started" never undoes a "dismissed" or
 * "done" — so replaying a finished tour on one device does not bring the
 * "New here?" card back on another.
 */
export function mergeTourState(base: TourState, incoming: TourState): TourState {
  const tours: Record<string, TourRecord> = { ...(base.tours ?? {}) };
  for (const [id, next] of Object.entries(incoming.tours ?? {})) {
    if (!isRecord(next)) continue;
    const prev = tours[id];
    tours[id] = prev && RANK[prev.status] > RANK[next.status] && next.status === 'started' ? prev : next;
  }
  return { tours };
}

export function isRecord(r: unknown): r is TourRecord {
  const x = r as TourRecord;
  return Boolean(x) && typeof x === 'object' && (x.status === 'started' || x.status === 'dismissed' || x.status === 'done')
    && Number.isInteger(x.step) && x.step >= 0 && typeof x.at === 'string';
}

/** Finished or turned down: the "New here?" card is not offered again. */
export function tourSettled(state: TourState, id: string): boolean {
  const s = state.tours?.[id]?.status;
  return s === 'done' || s === 'dismissed';
}

// ── Where the card goes ──────────────────────────────────────────────────────

export const TOUR_GAP = 16;

/**
 * The card's position next to a spotlighted control: the preferred side when
 * it fits, else below, above, left or right — whichever has room — always
 * kept 12px inside the window. A control that fills most of the screen gets
 * the card inside its top-right corner.
 */
export function placeCard(
  rect: { top: number; left: number; width: number; height: number },
  cardW: number, cardH: number,
  view: { width: number; height: number },
  side?: TourSide,
): { top: number; left: number; side: TourSide | 'inside' } {
  const clamp = (v: number, max: number) => Math.max(12, Math.min(v, max));
  if (rect.height > view.height * 0.6 && rect.width > view.width * 0.5) {
    return { top: clamp(rect.top + 40, view.height - cardH - 12), left: clamp(rect.left + rect.width - cardW - 40, view.width - cardW - 12), side: 'inside' };
  }
  const roomBelow = view.height - (rect.top + rect.height) > cardH + TOUR_GAP;
  const roomAbove = rect.top > cardH + TOUR_GAP;
  const roomLeft = rect.left > cardW + TOUR_GAP;
  const roomRight = view.width - (rect.left + rect.width) > cardW + TOUR_GAP;
  const fits: Record<TourSide, boolean> = { bottom: roomBelow, top: roomAbove, left: roomLeft, right: roomRight };
  const order: TourSide[] = side ? [side, 'bottom', 'top', 'right', 'left'] : ['bottom', 'top', 'right', 'left'];
  const chosen = order.find((s) => fits[s]) ?? 'bottom';
  let top = 0;
  let left = 0;
  if (chosen === 'bottom') { left = rect.left + rect.width / 2 - cardW / 2; top = rect.top + rect.height + TOUR_GAP; }
  if (chosen === 'top') { left = rect.left + rect.width / 2 - cardW / 2; top = rect.top - cardH - TOUR_GAP; }
  if (chosen === 'left') { left = rect.left - cardW - TOUR_GAP; top = rect.top + Math.min(40, rect.height / 2 - cardH / 2); }
  if (chosen === 'right') { left = rect.left + rect.width + TOUR_GAP; top = rect.top + Math.min(40, rect.height / 2 - cardH / 2); }
  return { top: clamp(top, view.height - cardH - 12), left: clamp(left, view.width - cardW - 12), side: chosen };
}
