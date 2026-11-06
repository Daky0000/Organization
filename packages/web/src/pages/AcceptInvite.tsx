import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { API_BASE_URL } from '../utils/apiBase';
import { AuthFrame } from './Auth';
import { Notice } from '../components/ui';

type InviteDetails = {
  id: string;
  email: string;
  role: string;
  org_name: string;
  org_id: string;
  invited_by_name: string | null;
  expires_at: string;
};

type Props = {
  token: string;
  onLoginClick: () => void;
};

export default function AcceptInvite({ token, onLoginClick }: Props) {
  const [invite, setInvite] = useState<InviteDetails | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  const isLoggedIn = Boolean(localStorage.getItem('auth_token'));

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/v1/invitations/${token}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setInvite(data.invitation);
        else setLoadError(data.error || 'Invitation not found');
      })
      .catch(() => setLoadError('Failed to load invitation'));
  }, [token]);

  const accept = async () => {
    const authToken = localStorage.getItem('auth_token');
    if (!authToken) {
      onLoginClick();
      return;
    }
    setAccepting(true);
    setAcceptError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/invitations/${token}/accept`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to accept invitation');
      setAccepted(true);
      setTimeout(() => {
        window.history.pushState({}, '', '/dashboard');
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, 2000);
    } catch (e: any) {
      setAcceptError(e.message);
    } finally {
      setAccepting(false);
    }
  };

  if (!invite && !loadError) {
    return (
      <AuthFrame>
        <div className="mt-8 flex items-center gap-3 text-sm text-muted">
          <Loader2 className="h-5 w-5 animate-spin text-blue" />
          <span>Loading workspace invitation…</span>
        </div>
      </AuthFrame>
    );
  }

  if (loadError) {
    return (
      <AuthFrame>
        <h1 className="os-login-title">Invitation unavailable</h1>
        <p className="os-login-lead">{loadError}</p>
        <button
          type="button"
          onClick={() => {
            window.history.pushState({}, '', '/');
            window.dispatchEvent(new PopStateEvent('popstate'));
          }}
          className="os-login-submit mt-6"
        >
          Go to home
        </button>
      </AuthFrame>
    );
  }

  if (accepted) {
    return (
      <AuthFrame>
        <h1 className="os-login-title">You&apos;re in</h1>
        <p className="os-login-lead">
          You&apos;ve joined <strong className="font-medium text-ink">{invite!.org_name}</strong>. Redirecting to your
          dashboard…
        </p>
        <Notice tone="positive">Workspace membership confirmed.</Notice>
      </AuthFrame>
    );
  }

  const roleCap = invite!.role.charAt(0).toUpperCase() + invite!.role.slice(1);

  return (
    <AuthFrame>
      <h1 className="os-login-title">You&apos;re invited</h1>
      <p className="os-login-lead">
        {invite!.invited_by_name ? (
          <>
            <strong className="font-medium text-ink">{invite!.invited_by_name}</strong> invited you to join a workspace.
          </>
        ) : (
          'You have been invited to join a workspace.'
        )}
      </p>

      <div className="rounded-2xl border border-line bg-soft p-5">
        <p className="micro">Workspace</p>
        <p className="mt-1 text-xl font-medium tracking-tight text-ink">{invite!.org_name}</p>
        <p className="mt-1 text-sm text-muted">
          Role: <span className="font-medium text-ink">{roleCap}</span> · Sent to{' '}
          <span className="font-mono text-xs text-ink">{invite!.email}</span>
        </p>
      </div>

      {acceptError && (
        <Notice tone="danger" className="mt-4">
          {acceptError}
        </Notice>
      )}

      {!isLoggedIn && (
        <p className="mt-4 text-xs text-muted">You need to be signed in to accept this invitation.</p>
      )}

      <button type="button" onClick={accept} disabled={accepting} className="os-login-submit mt-6">
        {accepting && <Loader2 size={15} className="animate-spin" />}
        {accepting ? 'Joining…' : isLoggedIn ? 'Accept invitation' : 'Sign in to accept'}
      </button>
    </AuthFrame>
  );
}
