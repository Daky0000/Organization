import { useState, useEffect } from 'react';

type PublicNavProps = {
  onLoginClick: () => void;
  activePath?: string;
};

const NAV_LINKS = [
  { label: 'Features', href: '/#features' },
  { label: 'Tools', href: '/tools' },
  { label: 'Pricing', href: '/pricing' },
  { label: "What's New", href: '/changelog', badge: true },
];

export default function PublicNav({ onLoginClick, activePath = '/' }: PublicNavProps) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  return (
    <header className={`site-header ${scrolled || mobileOpen ? 'scrolled' : ''}`}>
      <div className="header-shell">
        {/* Brand lockup */}
        <a href="/" className="brand flex items-center gap-2 shrink-0" aria-label="DakyXTech Home">
          <img
            src="/brand/header-lockup-on-light.png"
            alt="DakyXTech"
            className="brand-logo"
          />
        </a>

        {/* Desktop navigation */}
        <nav className="hidden md:flex items-center gap-1" aria-label="Primary">
          {NAV_LINKS.map((link) => {
            const isActive = activePath === link.href.replace('/#features', '/');
            return (
              <a
                key={link.label}
                href={link.href}
                className={`relative inline-flex items-center gap-1.5 rounded-[10px] px-3.5 py-2 text-[15px] font-medium transition-colors ${
                  isActive
                    ? 'bg-pale text-blue-d'
                    : 'text-ink hover:bg-soft hover:text-blue'
                }`}
              >
                {link.label}
                {link.badge && (
                  <span className="rounded-[5px] bg-blue px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-white leading-none">
                    New
                  </span>
                )}
              </a>
            );
          })}
        </nav>

        {/* Desktop CTAs */}
        <div className="hidden md:flex items-center gap-2">
          <button
            type="button"
            onClick={onLoginClick}
            className="rounded-[10px] px-3.5 py-2 text-[15px] font-medium text-ink transition-colors hover:bg-soft hover:text-blue"
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={onLoginClick}
            className="h-btn h-btn-b !py-2.5 !px-4 !text-[14.5px]"
          >
            Get started
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 8h10M9 4l4 4-4 4" />
            </svg>
          </button>
        </div>

        {/* Mobile menu button */}
        <button
          type="button"
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          className="md:hidden flex h-10 w-10 items-center justify-center rounded-[10px] border border-line text-ink hover:bg-soft transition-colors"
          onClick={() => setMobileOpen((p) => !p)}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
            {mobileOpen ? (
              <>
                <line x1="3.5" y1="3.5" x2="14.5" y2="14.5" />
                <line x1="14.5" y1="3.5" x2="3.5" y2="14.5" />
              </>
            ) : (
              <>
                <line x1="3" y1="5" x2="15" y2="5" />
                <line x1="3" y1="9" x2="15" y2="9" />
                <line x1="3" y1="13" x2="15" y2="13" />
              </>
            )}
          </svg>
        </button>
      </div>

      {/* Mobile slide-down panel */}
      {mobileOpen && (
        <div className="md:hidden mx-[12px] mt-2 rounded-[16px] border border-line bg-white p-4 shadow-menu">
          <div className="flex flex-col gap-1">
            {NAV_LINKS.map((link) => (
              <a
                key={link.label}
                href={link.href}
                className="flex items-center justify-between rounded-[10px] px-3.5 py-2.5 text-[15px] font-medium text-ink hover:bg-soft hover:text-blue transition-colors"
                onClick={() => setMobileOpen(false)}
              >
                <span>{link.label}</span>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M3 7h8M8 4l3 3-3 3" />
                </svg>
              </a>
            ))}
            <div className="mt-3 pt-3 border-t border-line flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  setMobileOpen(false);
                  onLoginClick();
                }}
                className="h-btn h-btn-o w-full justify-center !py-2.5"
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => {
                  setMobileOpen(false);
                  onLoginClick();
                }}
                className="h-btn h-btn-b w-full justify-center !py-2.5"
              >
                Get started
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 8h10M9 4l4 4-4 4" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
