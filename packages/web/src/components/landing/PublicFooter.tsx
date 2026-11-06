export default function PublicFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="h-panel py-14 border border-line/60">
      <div className="h-in">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-5 pb-12">
          {/* Brand column */}
          <div className="col-span-2 sm:col-span-2 pr-6">
            <a href="/" className="inline-flex items-center gap-2 mb-4" aria-label="DakyXTech">
              <img
                src="/brand/footer-lockup-on-light.png"
                alt="DakyXTech"
                className="h-7 w-auto"
              />
            </a>
            <p className="text-[14.5px] text-muted leading-relaxed mb-6 max-w-[280px]">
              One workspace for content strategy, AI production, multi-channel publishing, and lead operations.
            </p>
            <div className="flex items-center gap-2">
              {[
                { label: 'X', href: '#', icon: 'M4.5 4L7 7 4 11H5.2L7.6 7.7 9.7 11H12L9.3 7.1 12 4H10.8L8.7 7 6.8 4Z' },
                {
                  label: 'LinkedIn',
                  href: '#',
                  icon: 'M2 4.5C2 3.67 2.67 3 3.5 3S5 3.67 5 4.5 4.33 6 3.5 6 2 5.33 2 4.5ZM2.1 7H4.9V14H2.1V7ZM6.3 7H9V8.2C9.4 7.5 10.2 6.8 11.4 6.8 13.9 6.8 14.4 8.4 14.4 10.5V14H11.6V11C11.6 10 11.6 8.8 10.3 8.8 9 8.8 8.8 9.8 8.8 10.9V14H6V7Z',
                },
                {
                  label: 'Instagram',
                  href: '#',
                  icon: 'M8 3C5.2 3 3 5.2 3 8S5.2 13 8 13 13 10.8 13 8 10.8 3 8 3ZM8 11.5C6 11.5 4.5 10 4.5 8S6 4.5 8 4.5 11.5 6 11.5 8 10 11.5 8 11.5ZM11.5 4C11.5 4.6 12 5 12.5 5S13.5 4.6 13.5 4 13 3 12.5 3 11.5 3.4 11.5 4Z',
                },
              ].map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  aria-label={s.label}
                  className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-line bg-soft text-muted transition-colors hover:border-line-strong hover:bg-pale hover:text-blue"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                    <path d={s.icon} />
                  </svg>
                </a>
              ))}
            </div>
          </div>

          {/* Product */}
          <div>
            <p className="h-cap !text-[11px] !text-faint mb-4">Product</p>
            <ul className="space-y-2.5">
              {[
                { label: 'Features', href: '/#features' },
                { label: 'Pricing', href: '/pricing' },
                { label: 'Tools', href: '/tools' },
                { label: 'AI Studio', href: '/#studio' },
                { label: 'Changelog', href: '/changelog' },
              ].map((item) => (
                <li key={item.label}>
                  <a href={item.href} className="text-[14.5px] text-muted hover:text-ink transition-colors">
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Ecosystem */}
          <div>
            <p className="h-cap !text-[11px] !text-faint mb-4">Ecosystem</p>
            <ul className="space-y-2.5">
              {[
                { label: 'DakyXTech', href: 'https://dakyx.com' },
                { label: 'Business OS', href: 'https://os.dakyx.com' },
                { label: 'Website Editor', href: 'https://editor.dakyx.com' },
                { label: 'Marketing Hub', href: '/' },
              ].map((item) => (
                <li key={item.label}>
                  <a href={item.href} className="text-[14.5px] text-muted hover:text-ink transition-colors">
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal */}
          <div>
            <p className="h-cap !text-[11px] !text-faint mb-4">Legal</p>
            <ul className="space-y-2.5">
              {[
                { label: 'Privacy Policy', href: '/privacy' },
                { label: 'Terms of Service', href: '/terms' },
                { label: 'Refund Policy', href: '/refund' },
                { label: 'Data Deletion', href: '/data-deletion' },
              ].map((item) => (
                <li key={item.label}>
                  <a href={item.href} className="text-[14.5px] text-muted hover:text-ink transition-colors">
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-6 border-t border-line">
          <p className="text-[13px] text-muted order-2 sm:order-1">
            © {year} DakyXTech. All rights reserved.
          </p>
          <div className="flex items-center gap-2 order-1 sm:order-2">
            <span className="inline-block h-2 w-2 rounded-full bg-positive" />
            <span className="text-[12.5px] text-muted">All systems operational</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
