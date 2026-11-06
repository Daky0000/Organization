import { useCallback, useEffect, useState } from 'react';
import { Coins } from 'lucide-react';
import { getApiBaseUrl } from '../utils/apiBase';

// The signed-in user's available credits, beside the notification bell.
// Refreshes every minute, when the tab regains focus, and whenever something
// fires `credits-changed` on window (a purchase, a generation that charged).

const tok = () => localStorage.getItem('auth_token') ?? '';
const LOW_AT = 20;

export function notifyCreditsChanged(): void {
  window.dispatchEvent(new Event('credits-changed'));
}

export default function CreditBadge({ onOpen }: { onOpen?: () => void }) {
  const [credits, setCredits] = useState<number | null>(null);
  const [blocked, setBlocked] = useState(false);

  const load = useCallback(() => {
    if (!tok()) return;
    fetch(`${getApiBaseUrl()}/api/credits/balance`, { headers: { Authorization: `Bearer ${tok()}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { success?: boolean; credits?: number; spendingBlocked?: boolean } | null) => {
        if (d?.success && typeof d.credits === 'number') {
          setCredits(d.credits);
          setBlocked(Boolean(d.spendingBlocked));
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 60_000);
    window.addEventListener('focus', load);
    window.addEventListener('credits-changed', load);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', load);
      window.removeEventListener('credits-changed', load);
    };
  }, [load]);

  if (credits === null) return null;
  const low = blocked || credits <= LOW_AT;
  return (
    <button
      type="button"
      onClick={onOpen}
      title={blocked ? 'Spending is paused on this account' : `${credits.toLocaleString()} credits available — open Credits`}
      aria-label={`${credits.toLocaleString()} credits available`}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold tabular-nums transition hover:bg-slate-50 ${
        low ? 'border-red-200 text-red-600' : 'border-slate-200 text-slate-700'
      }`}
    >
      <Coins size={13} className="shrink-0" />
      {credits.toLocaleString()}
      <span className="hidden font-normal text-slate-500 sm:inline">credits</span>
    </button>
  );
}
