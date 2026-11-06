import { useEffect } from 'react';
import { TOUR_EVENTS } from './tourCore';

/**
 * Lets a tour step switch this page's tab: steps with `tab` ask for it, and
 * the page shows it (only tabs it knows, only for its own scope).
 */
export function useTourTab<T extends string>(scope: string, tabs: readonly T[], setTab: (tab: T) => void): void {
  useEffect(() => {
    const onTab = (e: Event) => {
      const d = (e as CustomEvent).detail ?? {};
      if (d.scope === scope && (tabs as readonly string[]).includes(d.tab)) setTab(d.tab as T);
    };
    window.addEventListener(TOUR_EVENTS.tab, onTab);
    return () => window.removeEventListener(TOUR_EVENTS.tab, onTab);
    // tabs is a constant list per page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, setTab]);
}
