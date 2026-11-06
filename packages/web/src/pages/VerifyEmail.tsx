import { useEffect, useState } from 'react';
import { API_BASE_URL } from '../utils/apiBase';
import { AuthFrame } from './Auth';
import { Notice } from '../components/ui';

export default function VerifyEmail() {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const token = params.get('token');
    if (!token) {
      setStatus('error');
      setMessage('No verification token found. Please use the link from your email.');
      return;
    }
    fetch(`${API_BASE_URL}/api/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then((r) => r.json())
      .then((data: { success: boolean; error?: string; message?: string }) => {
        if (data.success) {
          setStatus('success');
          setMessage(data.message ?? 'Email verified successfully!');
        } else {
          setStatus('error');
          setMessage(data.error ?? 'Verification failed. The link may have expired.');
        }
      })
      .catch(() => {
        setStatus('error');
        setMessage('Network error. Please try again.');
      });
  }, []);

  return (
    <AuthFrame>
      {status === 'loading' && (
        <div>
          <h1 className="os-login-title">Verifying your email</h1>
          <p className="os-login-lead">Please wait while we confirm your verification link…</p>
          <div className="mt-6 flex items-center gap-3 text-sm text-muted">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-blue" />
            <span>Checking verification token…</span>
          </div>
        </div>
      )}
      {status === 'success' && (
        <div>
          <h1 className="os-login-title">Email verified</h1>
          <p className="os-login-lead">{message}</p>
          <Notice tone="positive" className="mb-6">
            Your email address has been confirmed.
          </Notice>
          <a href="/dashboard" className="os-login-submit">
            Go to dashboard
          </a>
        </div>
      )}
      {status === 'error' && (
        <div>
          <h1 className="os-login-title">Verification failed</h1>
          <p className="os-login-lead">We could not verify this link.</p>
          <Notice tone="danger" className="mb-6">
            {message}
          </Notice>
          <a href="/login" className="os-login-submit">
            Back to sign in
          </a>
        </div>
      )}
    </AuthFrame>
  );
}
