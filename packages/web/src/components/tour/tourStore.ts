import { useEffect, useSyncExternalStore } from 'react';
import { getApiBaseUrl } from '../../utils/apiBase';
import { mergeTourState, type TourRecord, type TourState } from './tourCore';

// Tour progress for the signed-in user: read from this browser at once, then
// merged with the server's copy so it follows the user to other devices.
// Saving never blocks the tour: a failed save is retried with the next one.

let state: TourState = { tours: {} };
let userKey: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const storageKey = (userId: string) => `daky-tour-state:${userId}`;
const headers = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('auth_token') ?? ''}` });

function readLocal(userId: string): TourState {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(userId)) || '{}');
    return mergeTourState({ tours: {} }, raw && typeof raw === 'object' ? raw : { tours: {} });
  } catch {
    return { tours: {} };
  }
}

function writeLocal(): void {
  if (!userKey) return;
  try { localStorage.setItem(storageKey(userKey), JSON.stringify(state)); } catch { /* private mode */ }
}

async function pushServer(patch: TourState): Promise<void> {
  try {
    const r = await fetch(`${getApiBaseUrl()}/api/me/ui-state`, { method: 'PUT', headers: headers(), body: JSON.stringify(patch) });
    const d = await r.json().catch(() => null);
    if (r.ok && d?.state) { state = mergeTourState(state, d.state); writeLocal(); emit(); }
  } catch { /* offline: kept locally, sent with the next change */ }
}

/** Loads this user's progress (local first, then the server's). */
export function loadTourState(userId: string | null | undefined): void {
  if (!userId || userKey === userId) return;
  userKey = userId;
  state = readLocal(userId);
  emit();
  void (async () => {
    try {
      const r = await fetch(`${getApiBaseUrl()}/api/me/ui-state`, { headers: headers() });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.state || userKey !== userId) return;
      const local = state;
      state = mergeTourState(d.state, local);
      writeLocal();
      emit();
      // Anything this browser knew that the server did not goes up.
      const missing = Object.entries(local.tours).filter(([id, rec]) => JSON.stringify(d.state.tours?.[id]) !== JSON.stringify(rec));
      if (missing.length) void pushServer({ tours: Object.fromEntries(missing) });
    } catch { /* offline: the local copy is used */ }
  })();
}

/** Records a tour's status (started / dismissed / done) and step. */
export function recordTour(id: string, record: Omit<TourRecord, 'at'>): void {
  const rec: TourRecord = { ...record, at: new Date().toISOString() };
  // A replay must be able to set "started" locally even on a finished tour.
  state = { tours: { ...state.tours, [id]: record.status === 'started' && state.tours[id]?.status === 'done' ? { ...state.tours[id], at: rec.at } : rec } };
  writeLocal();
  emit();
  void pushServer({ tours: { [id]: rec } });
}

export function getTourState(): TourState { return state; }

/** The current progress, kept up to date. */
export function useTourState(userId: string | null | undefined): TourState {
  useEffect(() => { loadTourState(userId); }, [userId]);
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => state,
    () => state,
  );
}
