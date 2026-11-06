import { FormEvent, useEffect, useState } from 'react';
import { API_BASE_URL } from '../utils/apiBase';
import { AuthFrame } from './Auth';
import { Notice } from '../components/ui';

export default function ResetPassword() {
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    setToken(params.get('token') ?? '');
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (newPassword.length > 72) {
      setError('Password must be at most 72 characters (bcrypt limitation).');
      return;
    }
    if (newPassword !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (!token) {
      setError('Invalid or missing reset token. Please request a new link.');
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch(`${API_BASE_URL}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      });
      const data = (await r.json()) as { success: boolean; error?: string; message?: string };
      if (!data.success) {
        setError(data.error ?? 'Failed to reset password.');
        return;
      }
      setSuccess(true);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthFrame>
      <h1 className="os-login-title">Set new password</h1>
      <p className="os-login-lead">Enter your new password below to restore access to your workspace.</p>

      {success ? (
        <div className="mt-6 space-y-5">
          <Notice tone="positive" title="Password updated">
            You can now sign in with your new password.
          </Notice>
          <a href="/login" className="os-login-submit">
            Go to sign in
          </a>
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate>
          {error && (
            <Notice tone="danger" className="mb-4">
              {error}
            </Notice>
          )}

          {!token && (
            <Notice tone="warn" className="mb-4">
              No reset token found. Please use the link from your email.
            </Notice>
          )}

          <label className="os-login-field">
            <span>New password</span>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="At least 8 characters"
              autoComplete="new-password"
              className="input"
            />
          </label>
          <label className="os-login-field">
            <span>Confirm password</span>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repeat your password"
              autoComplete="new-password"
              className="input"
            />
          </label>

          <button type="submit" disabled={submitting || !token} className="os-login-submit mt-6">
            {submitting ? 'Updating…' : 'Update password'}
          </button>

          <p className="mt-5 text-center text-[13px] text-muted">
            <a href="/login" className="font-medium text-blue hover:underline">
              ← Back to sign in
            </a>
          </p>
        </form>
      )}
    </AuthFrame>
  );
}
