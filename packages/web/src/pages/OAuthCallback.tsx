import { useEffect, useState } from 'react';
import { API_BASE_URL } from '../utils/apiBase';

const SUPPORTED_PLATFORMS = new Set([
  'facebook',
  'instagram',
  'linkedin',
  'twitter',
  'pinterest',
  'tiktok',
  'threads',
  'gmail',
  'slack',
  'zoom',
]);

type Status = 'connecting' | 'success' | 'error';

// The server accepts each OAuth state once; a re-run of the effect (React
// StrictMode in development) must not submit the code a second time.
const submittedStates = new Set<string>();

// Only same-app paths: "//host" and "/\host" would leave the site.
const safeReturnPath = (value: unknown): string => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/integrations';
  return raw;
};

const parsePlatformFromPath = (pathname: string) => {
  const match = pathname.match(/^\/auth\/([^/]+)\/callback/i);
  return match ? match[1].toLowerCase() : '';
};

export default function OAuthCallback() {
  const [status, setStatus] = useState<Status>('connecting');
  const [message, setMessage] = useState('Finishing connection…');

  useEffect(() => {
    const platform = parsePlatformFromPath(window.location.pathname);
    const params = new URLSearchParams(window.location.search);
    const errorParam = params.get('error') || params.get('error_description') || '';
    const code = params.get('code') || '';
    const state = params.get('state') || '';

    // Opened via window.open() (e.g. from the onboarding wizard) rather than a
    // top-level redirect — report back over postMessage and close instead of
    // navigating the opener's whole app away from wherever it was.
    const isPopup = typeof window !== 'undefined' && !!window.opener && window.opener !== window;
    const finishPopup = (success: boolean, error?: string) => {
      try {
        window.opener.postMessage({ type: 'oauth_connected', platform, success, error }, window.location.origin);
      } catch {
        /* opener gone or cross-origin — nothing more we can do */
      }
      window.close();
    };

    if (!platform || !SUPPORTED_PLATFORMS.has(platform)) {
      setStatus('error');
      setMessage('Unsupported integration callback.');
      if (isPopup) finishPopup(false, 'Unsupported integration callback.');
      return;
    }

    if (errorParam) {
      const decoded = decodeURIComponent(errorParam);
      setStatus('error');
      setMessage(decoded);
      if (isPopup) finishPopup(false, decoded);
      return;
    }

    if (!code || !state) {
      const msg = 'Missing OAuth parameters. Please try connecting again.';
      setStatus('error');
      setMessage(msg);
      if (isPopup) finishPopup(false, msg);
      return;
    }

    if (submittedStates.has(state)) return;

    const token = localStorage.getItem('auth_token');
    if (!token) {
      const msg = 'Your session expired. Please log in and try again.';
      setStatus('error');
      setMessage(msg);
      if (isPopup) finishPopup(false, msg);
      return;
    }

    submittedStates.add(state);
    fetch(`${API_BASE_URL}/api/oauth/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ platform, code, state }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({} as any));
        if (!res.ok || data?.success === false) {
          throw new Error(data?.error || 'Connection failed');
        }
        if (isPopup) {
          setStatus('success');
          setMessage('Connected! You can close this window…');
          finishPopup(true);
          return;
        }
        setStatus('success');
        setMessage('Connected! Redirecting…');
        window.location.replace(safeReturnPath(data?.returnTo));
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : 'Connection failed';
        setStatus('error');
        setMessage(msg);
        if (isPopup) finishPopup(false, msg);
      });
  }, []);

  return (
    <div className="min-h-[60vh] rounded-2xl border border-slate-200 bg-white p-8 text-center">
      <div className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">OAuth Callback</div>
      <div className="mt-3 text-2xl font-black text-slate-900">
        {status === 'connecting' ? 'Connecting…' : status === 'success' ? 'Success' : 'Something went wrong'}
      </div>
      <p className="mt-3 text-sm text-slate-600">{message}</p>
      {status === 'error' ? (
        <button
          type="button"
          onClick={() => window.location.replace('/integrations')}
          className="mt-5 inline-flex items-center justify-center rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
        >
          Back to Integrations
        </button>
      ) : null}
    </div>
  );
}
