import { useCallback, useEffect, useState } from 'react';

function readParam(): string | null {
  try { return new URLSearchParams(window.location.search).get('lead'); } catch { return null; }
}

/**
 * The open lead, kept in the URL as ?lead=<contactId> so reminder
 * notifications and emails can deep-link to it. Follows back/forward and the
 * synthetic popstate that openAppUrl() dispatches.
 */
export function useLeadParam(): [string | null, (id: string | null) => void] {
  const [lead, setLeadState] = useState<string | null>(readParam);

  useEffect(() => {
    const onPop = () => setLeadState(readParam());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const setLead = useCallback((id: string | null) => {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('lead', id);
    else { url.searchParams.delete('lead'); url.searchParams.delete('tab'); }
    window.history.pushState({}, document.title, `${url.pathname}${url.search}`);
    setLeadState(id);
  }, []);

  return [lead, setLead];
}

/** Navigate inside the SPA to an app-relative URL (used by notifications). */
export function openAppUrl(url: string): void {
  if (!url.startsWith('/')) return;
  window.history.pushState({}, document.title, url);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
