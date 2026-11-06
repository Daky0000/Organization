import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { AppUser, normalizeUser } from '../utils/userSession';
import { API_BASE_URL } from '../utils/apiBase';
import { Notice } from '../components/ui';

type AuthProps = { onLogin: (user: AppUser) => void };
type AuthResponse = {
  success: boolean;
  error?: string;
  token?: string;
  user?: Partial<AppUser> & { id?: string; email?: string };
};

declare global {
  interface Window {
    fbAsyncInit?: () => void;
    FB?: {
      init(p: { appId: string; cookie: boolean; xfbml: boolean; version: string }): void;
      login(cb: (r: FBLoginResponse) => void, opts?: { scope: string }): void;
      getLoginStatus(cb: (r: FBLoginResponse) => void): void;
      AppEvents: { logPageView(): void };
    };
  }
}
interface FBLoginResponse {
  status: 'connected' | 'not_authorized' | 'unknown';
  authResponse?: { accessToken: string; userID: string };
}
interface SocialProvider {
  provider: string;
  clientId: string;
}

const safeJson = async <T,>(r: Response): Promise<{ data: T | null; rawText: string }> => {
  const rawText = await r.text().catch(() => '');
  try {
    return { data: JSON.parse(rawText) as T, rawText };
  } catch {
    return { data: null, rawText };
  }
};

const FB_APP_ID = (import.meta.env.VITE_FACEBOOK_APP_ID as string | undefined) || '';

const STRENGTH_LABEL = ['', 'Weak', 'Fair', 'Good', 'Strong'];
function pwdScore(p: string) {
  if (!p) return 0;
  let s = 0;
  if (p.length >= 6) s++;
  if (p.length >= 10) s++;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++;
  if (/[0-9]/.test(p) && /[^A-Za-z0-9]/.test(p)) s++;
  return Math.min(4, s) as 0 | 1 | 2 | 3 | 4;
}

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M2 2 L14 14 M5.5 5.5 C4 6.5 2.5 8 2.5 8 C2.5 8 5 12 8 12 C9 12 9.9 11.7 10.7 11.2 M11 6 C12.5 7 13.5 8 13.5 8 C13.5 8 11 12 8 12"
        stroke="currentColor"
        strokeLinecap="round"
      />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M2.5 8 C2.5 8 5 4 8 4 C11 4 13.5 8 13.5 8 C13.5 8 11 12 8 12 C5 12 2.5 8 2.5 8 Z" stroke="currentColor" />
      <circle cx="8" cy="8" r="2" stroke="currentColor" />
    </svg>
  );
}

/**
 * The frame every signed-out screen shares (DakyXTech Design System v22):
 * a navy panel with the dot field and the product's promise, and a white panel
 * with the task on a cool grey canvas (#ECEEF1).
 */
export function AuthFrame({
  children,
  footer,
  headline = ['Good work.', 'Clear direction.'],
  lede = 'One workspace for content, campaigns, leads, social scheduling and the AI agents that keep it all moving.',
}: {
  children: ReactNode;
  footer?: ReactNode;
  headline?: [string, string];
  lede?: string;
}) {
  const tiles: [string, string][] = [
    ['Publish', 'Drafted, scheduled and sent across channels'],
    ['Leads', 'Found, audited and followed up'],
    ['Analytics', 'Measured clearly in one workspace'],
  ];

  return (
    <main className="os-login">
      <section className="os-login-intro dot-field">
        <div className="flex items-center justify-between gap-4">
          <a href="/" className="inline-flex items-center gap-2.5" aria-label="DakyXTech Home">
            <img src="/brand/lockup-on-dark.png" alt="DakyXTech" className="h-7 w-auto" />
          </a>
          <a
            href="/"
            className="text-xs font-medium text-[#9FB0CC] transition hover:text-white"
          >
            ← Back to website
          </a>
        </div>
        <div className="os-login-copy">
          <h2>
            {headline[0]}
            <br />
            <span>{headline[1]}</span>
          </h2>
          <p>{lede}</p>
          <div className="os-login-tiles">
            {tiles.map(([title, line]) => (
              <div key={title}>
                <b>{title}</b>
                <span>{line}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="os-login-panel">
        <div className="os-login-form">
          <a href="/" className="inline-block">
            <img src="/brand/lockup-on-light.png" alt="DakyXTech" className="os-login-logo" />
          </a>
          <span className="os-login-badge">Marketing workspace</span>
          {children}
        </div>
        <div className="os-login-foot">
          <span className="inline-flex items-center gap-1.5">
            <img src="/brand/mark-on-light-96.png" alt="" className="h-4 w-4 rounded-[4px]" />
            © {new Date().getFullYear()} DakyXTech
          </span>
          <span>
            {footer ?? (
              <>
                <a href="/terms">Terms</a>
                {' · '}
                <a href="/privacy">Privacy</a>
              </>
            )}
          </span>
        </div>
      </section>
    </main>
  );
}

function Auth({ onLogin }: AuthProps) {
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Forgot-password state
  const [forgotEmail, setForgotEmail] = useState('');
  const [socialProviders, setSocialProviders] = useState<SocialProvider[]>([]);
  const [dakyxEnabled, setDakyxEnabled] = useState(false);
  const [fbReady, setFbReady] = useState(false);
  const [fbLoginLoading, setFbLoginLoading] = useState(false);
  const [fbStatus, setFbStatus] = useState<'connected' | 'not_authorized' | 'unknown' | null>(null);
  const fbCachedToken = useRef<string | null>(null);
  const fbInitialized = useRef(false);

  // Login state
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPwd, setShowLoginPwd] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  // Signup state
  const [signupName, setSignupName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [showSignupPwd, setShowSignupPwd] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(true);

  const pwdStrength = useMemo(() => pwdScore(signupPassword), [signupPassword]);

  const switchMode = (m: 'login' | 'signup' | 'forgot') => {
    setMode(m);
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  // ── Facebook SDK ────────────────────────────────────────────────────────────
  const exchangeFbToken = (accessToken: string) => {
    fetch(`${API_BASE_URL}/api/auth/facebook/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken }),
    })
      .then((r) => r.json())
      .then((data: AuthResponse & { user?: { id: string; email: string; name?: string; role?: string } }) => {
        if (data.success && data.token && data.user) {
          localStorage.setItem('auth_token', data.token);
          onLogin(
            normalizeUser({
              id: data.user.id,
              email: data.user.email,
              name: data.user.name ?? null,
              username: null,
              phone: null,
              country: null,
              role: data.user.role === 'admin' ? 'admin' : 'user',
            })
          );
        } else {
          setErrorMessage(data.error || 'Facebook login failed');
        }
      })
      .catch(() => setErrorMessage('Facebook authentication failed.'))
      .finally(() => setFbLoginLoading(false));
  };

  useEffect(() => {
    if (!FB_APP_ID || fbInitialized.current) return;
    fbInitialized.current = true;
    window.fbAsyncInit = function () {
      window.FB!.init({ appId: FB_APP_ID, cookie: true, xfbml: true, version: 'v18.0' });
      window.FB!.AppEvents.logPageView();
      window.FB!.getLoginStatus((r) => {
        setFbStatus(r.status);
        setFbReady(true);
        if (r.status === 'connected' && r.authResponse) fbCachedToken.current = r.authResponse.accessToken;
      });
    };
    (function (d, s, id) {
      if (d.getElementById(id)) {
        if (window.FB) setFbReady(true);
        return;
      }
      const js = d.createElement(s) as HTMLScriptElement;
      const fjs = d.getElementsByTagName(s)[0];
      js.id = id;
      js.src = 'https://connect.facebook.net/en_US/sdk.js';
      fjs.parentNode?.insertBefore(js, fjs);
    })(document, 'script', 'facebook-jssdk');
  }, []);

  const handleFacebookLogin = () => {
    if (!window.FB || !fbReady) return;
    setFbLoginLoading(true);
    setErrorMessage(null);
    if (fbStatus === 'connected' && fbCachedToken.current) {
      exchangeFbToken(fbCachedToken.current);
      return;
    }
    window.FB.login(
      (r) => {
        if (r.status === 'connected' && r.authResponse) {
          fbCachedToken.current = r.authResponse.accessToken;
          setFbStatus('connected');
          exchangeFbToken(r.authResponse.accessToken);
        } else {
          setFbLoginLoading(false);
        }
      },
      { scope: 'email,public_profile' }
    );
  };

  // ── Social providers ────────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API_BASE_URL}/api/auth/providers`)
      .then((r) => r.json())
      .then((d: { success: boolean; providers: SocialProvider[] }) => {
        if (d.success) setSocialProviders(d.providers);
      })
      .catch(() => {});
  }, []);

  // ── DakyX accounts (DakyXTech OS) ───────────────────────────────────────────
  // A DakyX retainer includes this product, so its clients sign in with the
  // account they already have there. See api/src/server/dakyxRoutes.ts.
  useEffect(() => {
    fetch(`${API_BASE_URL}/api/auth/dakyx/config`)
      .then((r) => r.json())
      .then((d: { enabled?: boolean }) => setDakyxEnabled(Boolean(d.enabled)))
      .catch(() => {});
  }, []);

  // ── OAuth callback token ────────────────────────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(
      window.location.hash.startsWith('#auth_token=') ? window.location.hash.slice(1) : window.location.search
    );
    const token = params.get('auth_token');
    const authError = params.get('auth_error');
    if (params.get('dakyx') === 'link_required') {
      // This address already has an account here and DakyX could not vouch for
      // it, so the two are joined only after the password proves it is theirs.
      window.history.replaceState({}, '', window.location.pathname);
      try { sessionStorage.setItem('dakyx_link_pending', '1'); } catch { /* private mode */ }
      const email = params.get('email');
      if (email) setLoginIdentifier(email);
      setSuccessMessage('You already have an account with this email. Sign in with your password once and we will connect your DakyX account.');
      return;
    }
    if (token) {
      window.history.replaceState({}, '', window.location.pathname);
      try {
        const p = JSON.parse(atob(token.split('.')[1])) as { userId: string; email: string; role: string };
        localStorage.setItem('auth_token', token);
        onLogin(
          normalizeUser({
            id: p.userId,
            email: p.email,
            name: p.email.split('@')[0],
            username: null,
            phone: null,
            country: null,
            role: p.role === 'admin' ? 'admin' : 'user',
          })
        );
      } catch {
        setErrorMessage('Social login failed — invalid token');
      }
    } else if (authError) {
      window.history.replaceState({}, '', window.location.pathname);
      setErrorMessage(decodeURIComponent(authError));
    }
  }, [onLogin]);

  const handleSocialLogin = (provider: string) => {
    window.location.href = `${API_BASE_URL}/api/auth/${provider}/start`;
  };

  // ── Login submit ────────────────────────────────────────────────────────────
  const handleLoginSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    if (!loginIdentifier.trim()) {
      setErrorMessage('Please enter your email or username.');
      return;
    }
    if (!loginPassword.trim()) {
      setErrorMessage('Please enter your password.');
      return;
    }
    setIsSubmitting(true);
    try {
      const r = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: loginIdentifier.trim(), password: loginPassword }),
      });
      const { data: d, rawText } = await safeJson<AuthResponse>(r);
      if (!d) throw new Error(`Server error (${r.status}): ${rawText.slice(0, 200) || 'empty'}`);
      if (!r.ok || !d.success || !d.token || !d.user?.id || !d.user?.email)
        throw new Error(d.error || 'Authentication failed');
      localStorage.setItem('auth_token', d.token);
      if (rememberMe) localStorage.setItem('remember_login', loginIdentifier.trim());
      let linkPending = false;
      try { linkPending = sessionStorage.getItem('dakyx_link_pending') === '1'; sessionStorage.removeItem('dakyx_link_pending'); } catch { /* private mode */ }
      if (linkPending) {
        const link = await fetch(`${API_BASE_URL}/api/auth/dakyx/link-start`, { method: 'POST', headers: { Authorization: `Bearer ${d.token}` } })
          .then((res) => res.json() as Promise<{ success?: boolean; url?: string }>)
          .catch(() => null);
        if (link?.url) { window.location.href = link.url; return; }
      }
      onLogin(
        normalizeUser({
          id: d.user.id,
          email: d.user.email,
          name: d.user.name ?? null,
          username: d.user.username ?? null,
          phone: d.user.phone ?? null,
          country: d.user.country ?? null,
          role: d.user.role === 'admin' ? 'admin' : 'user',
        })
      );
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Unable to authenticate';
      const friendly = raw === 'Invalid credentials' ? 'Email or password is incorrect. Please try again.' : raw;
      setErrorMessage(err instanceof TypeError ? `Backend unavailable (${API_BASE_URL})` : friendly);
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Signup submit ───────────────────────────────────────────────────────────
  const handleSignupSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    if (!signupName.trim() || !signupEmail.trim() || !signupPassword.trim()) {
      setErrorMessage('Please fill in all fields.');
      return;
    }
    if (!signupEmail.includes('@')) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }
    if (signupPassword.length < 6) {
      setErrorMessage('Password must be at least 6 characters.');
      return;
    }
    if (!acceptTerms) {
      setErrorMessage('Please accept the Terms and Privacy Policy to continue.');
      return;
    }
    setIsSubmitting(true);
    try {
      const username = signupEmail
        .split('@')[0]
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_');
      const r = await fetch(`${API_BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: signupName.trim(),
          username,
          email: signupEmail.trim(),
          password: signupPassword,
        }),
      });
      const { data: d, rawText } = await safeJson<AuthResponse>(r);
      if (!d) throw new Error(`Server error (${r.status}): ${rawText.slice(0, 200) || 'empty'}`);
      if (!r.ok || !d.success || !d.token || !d.user?.id || !d.user?.email)
        throw new Error(d.error || 'Account creation failed');
      localStorage.setItem('auth_token', d.token);
      onLogin(
        normalizeUser({
          id: d.user.id,
          email: d.user.email,
          name: d.user.name ?? null,
          username: d.user.username ?? null,
          phone: d.user.phone ?? null,
          country: d.user.country ?? null,
          role: 'user',
        })
      );
    } catch (err) {
      setErrorMessage(
        err instanceof TypeError
          ? `Backend unavailable (${API_BASE_URL})`
          : err instanceof Error
          ? err.message
          : 'Unable to create account'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Forgot password submit ──────────────────────────────────────────────────
  const handleForgotSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);
    if (!forgotEmail.trim() || !forgotEmail.includes('@')) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }
    setIsSubmitting(true);
    try {
      await fetch(`${API_BASE_URL}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail.trim() }),
      });
      setSuccessMessage('If that email exists, a reset link has been sent. Check your inbox (and spam folder).');
      setForgotEmail('');
    } catch {
      setSuccessMessage('If that email exists, a reset link has been sent.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const hasOAuth = socialProviders.length > 0 || !!FB_APP_ID || dakyxEnabled;

  const renderOAuth = () =>
    hasOAuth ? (
      <div className="mt-6">
        <div className="relative flex items-center justify-center">
          <div className="w-full border-t border-line" />
          <span className="bg-white px-3 text-[11px] font-medium uppercase tracking-[0.14em] text-faint">
            Or continue with
          </span>
          <div className="w-full border-t border-line" />
        </div>
        {dakyxEnabled && (
          <button
            type="button"
            onClick={() => handleSocialLogin('dakyx')}
            className="mt-3 inline-flex h-[42px] w-full items-center justify-center gap-2 rounded-[10px] border border-ink bg-ink px-3 text-[13px] font-medium text-white transition hover:opacity-90"
          >
            Continue with DakyX
          </button>
        )}
        <div className="mt-3 grid grid-cols-3 gap-2">
          {socialProviders.filter((p) => p.provider === 'google').length > 0 && (
            <button
              type="button"
              onClick={() => handleSocialLogin('google')}
              className="inline-flex h-[42px] items-center justify-center gap-2 rounded-[10px] border border-line-strong bg-white px-3 text-[13px] font-medium text-ink transition hover:border-ink hover:bg-soft"
            >
              <svg width="15" height="15" viewBox="0 0 18 18" fill="none">
                <path
                  d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.49h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.63z"
                  fill="#4285F4"
                />
                <path
                  d="M9 18c2.43 0 4.47-.81 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.32-1.58-5.03-3.71H.99v2.33A9 9 0 0 0 9 18z"
                  fill="#34A853"
                />
                <path
                  d="M3.97 10.71A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.17.29-1.71V4.96H.99A9 9 0 0 0 0 9c0 1.45.35 2.83.99 4.04l2.98-2.33z"
                  fill="#FBBC05"
                />
                <path
                  d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A8.97 8.97 0 0 0 9 0 9 9 0 0 0 .99 4.96l2.98 2.33C4.68 5.16 6.66 3.58 9 3.58z"
                  fill="#EA4335"
                />
              </svg>
              Google
            </button>
          )}
          {socialProviders.filter((p) => p.provider === 'github').length > 0 && (
            <button
              type="button"
              onClick={() => handleSocialLogin('github')}
              className="inline-flex h-[42px] items-center justify-center gap-2 rounded-[10px] border border-line-strong bg-white px-3 text-[13px] font-medium text-ink transition hover:border-ink hover:bg-soft"
            >
              <svg width="15" height="15" viewBox="0 0 14 14" fill="currentColor">
                <path d="M7 0a7 7 0 0 0-2.21 13.64c.35.06.48-.15.48-.34v-1.2c-1.95.42-2.36-.94-2.36-.94-.32-.81-.78-1.03-.78-1.03-.64-.43.05-.43.05-.43.7.05 1.07.72 1.07.72.62 1.07 1.64.76 2.04.58.06-.45.24-.76.44-.94-1.56-.18-3.2-.78-3.2-3.47 0-.77.27-1.4.72-1.89-.07-.18-.31-.9.07-1.88 0 0 .59-.19 1.93.72A6.7 6.7 0 0 1 7 3.36c.6 0 1.2.08 1.76.24 1.34-.91 1.93-.72 1.93-.72.38.98.14 1.7.07 1.88.45.49.71 1.12.71 1.89 0 2.7-1.65 3.29-3.22 3.46.25.22.48.65.48 1.32v1.96c0 .19.13.41.49.34A7 7 0 0 0 7 0z" />
              </svg>
              GitHub
            </button>
          )}
          {FB_APP_ID && (
            <button
              type="button"
              onClick={handleFacebookLogin}
              disabled={!fbReady || fbLoginLoading}
              className="inline-flex h-[42px] items-center justify-center gap-2 rounded-[10px] border border-line-strong bg-white px-3 text-[13px] font-medium text-ink transition hover:border-ink hover:bg-soft disabled:opacity-50"
            >
              <svg width="15" height="15" viewBox="0 0 14 14" fill="#1877F2">
                <path d="M14 7a7 7 0 1 0-8.09 6.92V9.02H4.13V7h1.78V5.46c0-1.76 1.05-2.74 2.66-2.74.77 0 1.57.14 1.57.14V4.6h-.88c-.87 0-1.14.54-1.14 1.1V7h1.94l-.31 2.02h-1.63v4.9A7 7 0 0 0 14 7" />
              </svg>
              {fbLoginLoading ? 'Connecting…' : 'Facebook'}
            </button>
          )}
        </div>
      </div>
    ) : null;

  return (
    <AuthFrame>
      {mode !== 'forgot' && (
        <div className="mt-6 inline-flex rounded-[10px] border border-line bg-soft p-1">
          <button
            type="button"
            onClick={() => switchMode('login')}
            className={`rounded-[8px] px-3.5 py-1.5 text-[12.5px] font-medium transition ${
              mode === 'login' ? 'bg-white text-ink shadow-xs' : 'text-muted hover:text-ink'
            }`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => switchMode('signup')}
            className={`rounded-[8px] px-3.5 py-1.5 text-[12.5px] font-medium transition ${
              mode === 'signup' ? 'bg-white text-ink shadow-xs' : 'text-muted hover:text-ink'
            }`}
          >
            Create account
          </button>
        </div>
      )}

      {mode === 'login' && (
        <form onSubmit={handleLoginSubmit} noValidate>
          <h1 className="os-login-title">Welcome back</h1>
          <p className="os-login-lead">Sign in to carry on where you left off.</p>

          <label className="os-login-field" htmlFor="li-email">
            <span>Email or username</span>
            <input
              id="li-email"
              type="text"
              placeholder="you@company.com"
              value={loginIdentifier}
              onChange={(e) => setLoginIdentifier(e.target.value)}
              autoComplete="email"
              required
              autoFocus
              className="input"
            />
          </label>

          <div className="os-login-field">
            <span className="os-login-row">
              <label htmlFor="li-password">Password</label>
              <button type="button" onClick={() => switchMode('forgot')}>
                Forgotten it?
              </button>
            </span>
            <div className="pw-wrap">
              <input
                id="li-password"
                type={showLoginPwd ? 'text' : 'password'}
                placeholder="••••••••••"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                autoComplete="current-password"
                required
                className="input pw-input"
              />
              <button
                type="button"
                className="pw-eye"
                onClick={() => setShowLoginPwd((v) => !v)}
                aria-label={showLoginPwd ? 'Hide password' : 'Show password'}
              >
                <EyeIcon open={showLoginPwd} />
              </button>
            </div>
          </div>

          <div className="mt-3.5 flex items-center justify-between gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-muted select-none">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="h-4 w-4 rounded border-line-strong accent-blue"
              />
              <span>Keep me signed in</span>
            </label>
          </div>

          {errorMessage && (
            <Notice tone="danger" className="mt-4">
              {errorMessage}
            </Notice>
          )}

          <button type="submit" className="os-login-submit mt-6" disabled={isSubmitting}>
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </button>

          {renderOAuth()}

          <p className="mt-6 text-center text-[13.5px] text-muted">
            Don&apos;t have an account?{' '}
            <button
              type="button"
              onClick={() => switchMode('signup')}
              className="font-medium text-blue hover:underline"
            >
              Sign up
            </button>
          </p>
        </form>
      )}

      {mode === 'signup' && (
        <form onSubmit={handleSignupSubmit} noValidate>
          <h1 className="os-login-title">Create an account</h1>
          <p className="os-login-lead">
            Generate, schedule, and learn from a month of content across your channels in one workspace.
          </p>

          <label className="os-login-field" htmlFor="su-name">
            <span>Your name</span>
            <input
              id="su-name"
              type="text"
              placeholder="Alex Jordan"
              value={signupName}
              onChange={(e) => setSignupName(e.target.value)}
              autoComplete="name"
              required
              className="input"
            />
          </label>

          <label className="os-login-field" htmlFor="su-email">
            <span>Your email</span>
            <input
              id="su-email"
              type="email"
              placeholder="you@company.com"
              value={signupEmail}
              onChange={(e) => setSignupEmail(e.target.value)}
              autoComplete="email"
              required
              className="input"
            />
          </label>

          <div className="os-login-field">
            <label htmlFor="su-password">Password</label>
            <div className="pw-wrap">
              <input
                id="su-password"
                type={showSignupPwd ? 'text' : 'password'}
                placeholder="At least 6 characters"
                value={signupPassword}
                onChange={(e) => setSignupPassword(e.target.value)}
                autoComplete="new-password"
                required
                className="input pw-input"
              />
              <button
                type="button"
                className="pw-eye"
                onClick={() => setShowSignupPwd((v) => !v)}
                aria-label={showSignupPwd ? 'Hide password' : 'Show password'}
              >
                <EyeIcon open={showSignupPwd} />
              </button>
            </div>
            {signupPassword && (
              <>
                <div className="pw-meter" data-score={pwdStrength}>
                  {([1, 2, 3, 4] as const).map((i) => (
                    <i key={i} className={pwdStrength >= i ? 'on' : ''} />
                  ))}
                </div>
                <div className="pw-meta">
                  <span>{STRENGTH_LABEL[pwdStrength]}</span>
                  <span>8+ chars with number &amp; symbol = strong</span>
                </div>
              </>
            )}
          </div>

          <label className="mt-4 inline-flex cursor-pointer items-center gap-2 text-[13px] text-muted select-none">
            <input
              type="checkbox"
              checked={acceptTerms}
              onChange={(e) => setAcceptTerms(e.target.checked)}
              className="h-4 w-4 rounded border-line-strong accent-blue"
            />
            <span>
              I agree to the{' '}
              <a href="/terms" className="text-ink underline decoration-line-strong hover:text-blue">
                Terms
              </a>{' '}
              and{' '}
              <a href="/privacy" className="text-ink underline decoration-line-strong hover:text-blue">
                Privacy Policy
              </a>
            </span>
          </label>

          {errorMessage && (
            <Notice tone="danger" className="mt-4">
              {errorMessage}
            </Notice>
          )}

          <button type="submit" className="os-login-submit mt-6" disabled={isSubmitting}>
            {isSubmitting ? 'Creating workspace…' : 'Get started'}
          </button>

          {renderOAuth()}

          <p className="mt-6 text-center text-[13.5px] text-muted">
            Already have an account?{' '}
            <button
              type="button"
              onClick={() => switchMode('login')}
              className="font-medium text-blue hover:underline"
            >
              Sign in
            </button>
          </p>
        </form>
      )}

      {mode === 'forgot' && (
        <form onSubmit={handleForgotSubmit} noValidate>
          <button
            type="button"
            onClick={() => switchMode('login')}
            className="mt-6 inline-flex items-center gap-1.5 text-[13px] font-medium text-blue hover:underline"
          >
            ← Back to sign in
          </button>
          <h1 className="os-login-title !mt-4">Reset your password</h1>
          <p className="os-login-lead">
            Enter the email you registered with and we&apos;ll send you a secure reset link.
          </p>

          {errorMessage && (
            <Notice tone="danger" className="mt-4">
              {errorMessage}
            </Notice>
          )}
          {successMessage && (
            <Notice tone="positive" className="mt-4">
              {successMessage}
            </Notice>
          )}

          {!successMessage && (
            <>
              <label className="os-login-field" htmlFor="fp-email">
                <span>Email address</span>
                <input
                  id="fp-email"
                  type="email"
                  placeholder="you@company.com"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  autoComplete="email"
                  required
                  autoFocus
                  className="input"
                />
              </label>
              <button type="submit" className="os-login-submit mt-6" disabled={isSubmitting}>
                {isSubmitting ? 'Sending…' : 'Send reset link'}
              </button>
            </>
          )}
        </form>
      )}
    </AuthFrame>
  );
}

export default Auth;
