function PrivacyPolicy({ embedded = false }: { embedded?: boolean }) {
  return (
    <div className={embedded ? '' : 'min-h-screen bg-canvas py-10 px-3 sm:px-6'}>
      <div className={embedded ? '' : 'max-w-3xl mx-auto bg-white rounded-[22px] border border-line p-8 sm:p-12'}>
        {!embedded && (
          <div className="mb-8 flex items-center justify-between gap-4 border-b border-line pb-5">
            <a href="/" className="inline-flex items-center gap-2">
              <img src="/brand/header-lockup-on-light.png" alt="DakyXTech" className="h-6 w-auto" />
            </a>
            <a
              href="/login"
              className="text-[13px] text-blue hover:underline font-medium"
              onClick={(e) => {
                e.preventDefault();
                window.history.back();
              }}
            >
              &larr; Back
            </a>
          </div>
        )}

        <span className="os-eyebrow">Legal · Privacy</span>
        <h1 className="text-[34px] font-normal tracking-[-0.035em] text-ink mt-2 mb-1">Privacy Policy</h1>
        <p className="text-xs font-mono text-muted mb-8">Last updated: March 8, 2026</p>

        <div className="prose prose-slate max-w-none space-y-8 text-ink/85 leading-relaxed">

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">1. Introduction</h2>
            <p>
              Welcome to Dakyworld ("we," "our," or "us"). We operate the Dakyworld Hub platform, a
              content marketing and social media management service accessible at dakyworld.com and
              related subdomains. This Privacy Policy explains how we collect, use, disclose, and
              safeguard your personal information when you use our platform.
            </p>
            <p className="mt-3">
              By creating an account or using Dakyworld Hub, you agree to the practices described in
              this policy. If you do not agree, please do not use our services.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">2. Information We Collect</h2>

            <h3 className="text-base font-semibold text-gray-800 mb-2 mt-4">2.1 Account Information</h3>
            <p>
              When you register, we collect your name, username, email address, and password (stored
              as a secure hash). You may optionally provide a phone number, country, and profile
              avatar.
            </p>

            <h3 className="text-base font-semibold text-gray-800 mb-2 mt-4">2.3 Content You Create</h3>
            <p>
              We store posts, captions, media references, card templates, and scheduling data you
              create within the platform.
            </p>

            <h3 className="text-base font-semibold text-gray-800 mb-2 mt-4">2.4 Usage and Log Data</h3>
            <p>
              We automatically collect IP addresses, browser type, pages visited, timestamps, and
              error logs to operate, secure, and improve the service.
            </p>

            <h3 className="text-base font-semibold text-gray-800 mb-2 mt-4">2.5 Payment Information</h3>
            <p>
              Payments are processed by Paystack. We do not store full credit card numbers. We retain
              Paystack customer IDs and subscription status to manage your plan.
            </p>

            <h3 className="text-base font-semibold text-gray-800 mb-2 mt-4">2.6 Social Login</h3>
            <p>
              If you sign in via Google, GitHub, or Microsoft, we receive your name, email, and
              profile picture from that provider. We do not receive your password.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">3. How We Use Your Information</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>Provide, operate, and maintain the Dakyworld Hub platform</li>
              <li>Authenticate your identity and secure your account</li>
              <li>Publish and schedule content to connected social platforms on your behalf</li>
              <li>Process payments and manage your subscription</li>
              <li>Send transactional emails (account confirmation, password reset, billing receipts)</li>
              <li>Detect abuse, security incidents, and policy violations</li>
              <li>Improve platform features and fix bugs using aggregated, anonymized analytics</li>
              <li>Comply with legal obligations</li>
            </ul>
            <p className="mt-3">
              We do not sell your personal data to third parties. We do not use your content for
              advertising or to train AI models without your explicit consent.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">4. Sharing Your Information</h2>
            <p>We share your information only in the following circumstances:</p>
            <ul className="list-disc pl-5 mt-3 space-y-2">
              <li>
                <strong>Third-party platforms you authorize:</strong> When you connect Instagram,
                TikTok, etc., data necessary to fulfill your publishing requests is sent to those
                platforms under their own privacy policies.
              </li>
              <li>
                <strong>Service providers:</strong> We use Paystack (payments), Railway (hosting),
                and Neon/PostgreSQL (database). These processors handle your data only as directed
                by us and under contractual data protection obligations.
              </li>
              <li>
                <strong>Legal requirements:</strong> We may disclose data if required by law,
                court order, or to protect the rights, property, or safety of Dakyworld, our users,
                or the public.
              </li>
              <li>
                <strong>Business transfers:</strong> If Dakyworld is acquired or merges with
                another company, your data may be transferred. We will notify you before your data
                is subject to a different privacy policy.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">5. Data Retention</h2>
            <p>
              We retain your account data for as long as your account is active. If you delete your
              account, we will delete or anonymize your personal data within 30 days, except where
              we are required to retain it for legal or regulatory reasons (e.g., payment records
              for tax purposes, which we retain for up to 7 years).
            </p>
            <p className="mt-3">
              Data related to disabled features is removed as part of normal account maintenance where applicable.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">6. Cookies and Tracking</h2>
            <p>
              We use session cookies and local storage to maintain your authenticated session. We do
              not use third-party advertising cookies or tracking pixels. Any analytics we use are
              privacy-respecting and do not fingerprint individual users across sites.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">7. Security</h2>
            <p>
              We implement industry-standard security measures including HTTPS encryption in transit,
              bcrypt password hashing, JWT-based authentication, and environment-isolated API secrets.
              However, no system is completely secure. In the event of a data breach that affects
              your personal information, we will notify you in accordance with applicable law.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">8. Your Rights</h2>
            <p>Depending on your location, you may have the following rights:</p>
            <ul className="list-disc pl-5 mt-3 space-y-2">
              <li><strong>Access:</strong> Request a copy of the personal data we hold about you.</li>
              <li><strong>Correction:</strong> Update inaccurate or incomplete personal data via your profile settings.</li>
              <li><strong>Deletion:</strong> Request deletion of your account and associated data.</li>
              <li><strong>Portability:</strong> Request your data in a machine-readable format.</li>
              <li><strong>Objection:</strong> Object to certain types of processing.</li>
              <li><strong>Withdrawal of consent:</strong> Contact us to withdraw consent for optional processing where applicable.</li>
            </ul>
            <p className="mt-3">
              To exercise these rights, contact us at{' '}
              <a href="mailto:privacy@dakyworld.com" className="text-blue-600 hover:underline">
                privacy@dakyworld.com
              </a>
              . We will respond within 30 days.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">9. Children's Privacy</h2>
            <p>
              Dakyworld Hub is not directed to children under 13 (or 16 in the EU). We do not
              knowingly collect personal data from children. If you believe a child has provided us
              with personal data, please contact us and we will delete it promptly.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">10. International Transfers</h2>
            <p>
              Our servers are located in the United States. If you access Dakyworld Hub from outside
              the US, your data is transferred to and processed in the US. By using our service, you
              consent to this transfer. We take steps to ensure adequate protections are in place
              consistent with applicable data protection laws.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">11. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. We will notify you of material
              changes by email or by displaying a prominent notice in the app at least 14 days
              before changes take effect. Continued use after the effective date constitutes
              acceptance of the updated policy.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">12. Contact Us</h2>
            <p>
              If you have questions or concerns about this Privacy Policy or our data practices,
              please contact us:
            </p>
            <div className="mt-3 p-4 bg-gray-50 rounded-xl text-sm">
              <p className="font-semibold text-gray-900">Dakyworld</p>
              <p className="text-gray-600 mt-1">
                Email:{' '}
                <a href="mailto:privacy@dakyworld.com" className="text-blue-600 hover:underline">
                  privacy@dakyworld.com
                </a>
              </p>
              <p className="text-gray-600">Website: dakyworld.com</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default PrivacyPolicy;
