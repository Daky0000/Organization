import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock, Mail, ShieldCheck } from 'lucide-react';

type DeletionStatusResponse =
  | {
      success: true;
      data: {
        code: string;
        status: 'received' | 'completed' | 'unknown';
        createdAt: string;
        completedAt: string | null;
      };
    }
  | { success: false; error?: string };

const rawApiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim();
const API_BASE_URL = rawApiBaseUrl.includes('api.yourdomain.com') ? '' : rawApiBaseUrl.replace(/\/$/, '');

const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="rounded-[22px] border border-line bg-white p-6 md:p-8">
    <h2 className="text-xl font-normal tracking-[-0.03em] text-ink">{title}</h2>
    <div className="mt-4 space-y-4 text-sm leading-6 text-muted">{children}</div>
  </section>
);

const InlineCode = ({ children }: { children: string }) => (
  <span className="rounded-md border border-line bg-soft px-2 py-0.5 font-mono text-[12px] text-ink">
    {children}
  </span>
);

export default function DataDeletion() {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://dakyx.com';

  const urls = useMemo(() => {
    const apiBase = API_BASE_URL || origin;
    return {
      statusUrl: `${apiBase}/api/meta/data-deletion/status`,
    };
  }, [origin]);

  const [code, setCode] = useState<string>('');
  const [status, setStatus] = useState<
    'idle' | 'loading' | 'received' | 'completed' | 'unknown' | 'not_found' | 'error'
  >('idle');
  const [statusMessage, setStatusMessage] = useState<string>('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const c = (params.get('code') || '').trim();
    setCode(c);
    if (!c) return;

    let canceled = false;
    setStatus('loading');
    (async () => {
      try {
        const res = await fetch(`${urls.statusUrl}?code=${encodeURIComponent(c)}`);
        const data = (await res.json()) as DeletionStatusResponse;
        if (canceled) return;
        if (!data.success) {
          setStatus(res.status === 404 ? 'not_found' : 'error');
          setStatusMessage(data.error || 'Could not load status');
          return;
        }
        setStatus(data.data.status);
        setStatusMessage('');
      } catch (err) {
        if (canceled) return;
        setStatus('error');
        setStatusMessage(err instanceof Error ? err.message : 'Could not load status');
      }
    })();

    return () => {
      canceled = true;
    };
  }, [urls.statusUrl]);

  const supportEmail = (import.meta.env.VITE_SUPPORT_EMAIL || 'support@dakyx.com').trim();

  return (
    <div className="min-h-screen bg-canvas px-3 py-10 sm:px-6">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <div className="rounded-[22px] border border-line bg-white px-6 py-7 md:px-8">
          <div className="mb-6 flex items-center justify-between gap-4 border-b border-line pb-4">
            <a href="/" className="inline-flex items-center gap-2">
              <img src="/brand/header-lockup-on-light.png" alt="DakyXTech" className="h-6 w-auto" />
            </a>
            <a href="/" className="text-[13px] font-medium text-blue hover:underline">
              &larr; Back to home
            </a>
          </div>
          <span className="os-eyebrow">Legal · Privacy &amp; Data</span>
          <h1 className="mt-2 text-[34px] font-normal tracking-[-0.035em] text-ink">Data Deletion</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            This page explains how to request deletion of your account and connected channel data from
            DakyXTech Marketing.
          </p>
        </div>

        <Card title="How to request deletion">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 text-blue">
              <ShieldCheck size={16} />
            </div>
            <div className="min-w-0">
              <div className="text-sm text-ink">Email us from the address you used in the app. Include:</div>
              <ul className="mt-2 list-disc pl-5 text-sm text-muted space-y-1">
                <li>Your account email</li>
                <li>Which Meta-connected accounts you want removed (Facebook / Instagram / Threads)</li>
                <li>If you know it: your Facebook user ID (optional)</li>
                <li>Any relevant screenshots or error messages (optional)</li>
              </ul>
              <div className="mt-3 text-xs text-muted">
                We will delete and disconnect any stored OAuth tokens and related account connection data
                we can identify for your account.
              </div>
              <div className="mt-4">
                <a
                  href={`mailto:${encodeURIComponent(supportEmail)}?subject=${encodeURIComponent(
                    'Data deletion request'
                  )}`}
                  className="btn-primary"
                >
                  <Mail size={15} /> Email support
                </a>
                <div className="mt-2.5 text-xs text-muted">
                  Contact: <InlineCode>{supportEmail}</InlineCode>
                </div>
              </div>
            </div>
          </div>
        </Card>

        <Card title="Request status (if you have a confirmation code)">
          {!code && (
            <div className="rounded-xl border border-line bg-soft px-4 py-3 text-sm text-muted">
              If you were redirected here after submitting a deletion request, you&apos;ll have a{' '}
              <InlineCode>code</InlineCode> in the URL.
            </div>
          )}

          {code && (
            <div className="rounded-xl border border-line bg-soft p-4">
              <div className="micro">Confirmation code</div>
              <div className="mt-1 text-sm">
                <InlineCode>{code}</InlineCode>
              </div>

              <div className="mt-4 flex items-start gap-3">
                <div className="mt-0.5 text-blue">
                  {status === 'completed' ? <CheckCircle2 size={16} /> : <Clock size={16} />}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink">
                    {status === 'loading' && 'Loading status…'}
                    {status === 'received' && 'Request received'}
                    {status === 'completed' && 'Request completed'}
                    {status === 'unknown' && 'Status unknown'}
                    {status === 'not_found' && 'Code not found'}
                    {status === 'error' && 'Could not load status'}
                    {status === 'idle' && '—'}
                  </div>
                  <div className="mt-1 text-sm text-muted">
                    {status === 'received' &&
                      'Your request is recorded. If you need help, email support with this code.'}
                    {status === 'completed' &&
                      'We completed deletion for all data matched to this request.'}
                    {status === 'unknown' &&
                      'We recorded your request, but could not determine the current status.'}
                    {status === 'not_found' &&
                      'This confirmation code does not exist (or has not been recorded yet).'}
                    {status === 'error' && (statusMessage || 'Please try again later.')}
                  </div>
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
