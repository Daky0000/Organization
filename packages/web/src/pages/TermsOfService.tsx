function TermsOfService({ embedded = false }: { embedded?: boolean }) {
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

        <span className="os-eyebrow">Legal · Terms</span>
        <h1 className="text-[34px] font-normal tracking-[-0.035em] text-ink mt-2 mb-1">Terms of Service</h1>
        <p className="text-xs font-mono text-muted mb-8">Last updated: March 8, 2026</p>

        <div className="prose prose-slate max-w-none space-y-8 text-ink/85 leading-relaxed">

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">1. Acceptance of Terms</h2>
            <p>
              These Terms of Service ("Terms") govern your access to and use of Dakyworld Hub, a
              content marketing and social media management platform operated by Dakyworld
              ("we," "our," or "us"). By creating an account or using any part of our service, you
              agree to be bound by these Terms and our{' '}
              <a href="/privacy" className="text-blue-600 hover:underline">
                Privacy Policy
              </a>
              .
            </p>
            <p className="mt-3">
              If you are using Dakyworld Hub on behalf of an organization, you represent that you
              have authority to bind that organization to these Terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">2. Eligibility</h2>
            <p>
              You must be at least 13 years old (16 in the European Union) to use Dakyworld Hub.
              By using our platform, you represent and warrant that you meet this requirement. Users
              in jurisdictions where the platform is not available agree to comply with local laws.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">3. Your Account</h2>
            <p>
              You are responsible for maintaining the confidentiality of your login credentials and
              for all activities that occur under your account. You agree to:
            </p>
            <ul className="list-disc pl-5 mt-3 space-y-2">
              <li>Provide accurate and complete registration information</li>
              <li>Keep your password secure and not share it with third parties</li>
              <li>Notify us immediately at{' '}
                <a href="mailto:support@dakyworld.com" className="text-blue-600 hover:underline">
                  support@dakyworld.com
                </a>{' '}
                if you suspect unauthorized access to your account
              </li>
              <li>Not create multiple accounts or impersonate another person</li>
            </ul>
            <p className="mt-3">
              We reserve the right to terminate accounts that violate these Terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">4. Acceptable Use</h2>
            <p>You agree not to use Dakyworld Hub to:</p>
            <ul className="list-disc pl-5 mt-3 space-y-2">
              <li>Publish spam, unsolicited messages, or deceptive content</li>
              <li>Violate the terms of service of any connected social media platform</li>
              <li>Infringe any intellectual property rights of others</li>
              <li>Distribute malware, phishing content, or other harmful material</li>
              <li>Harass, threaten, or discriminate against any individual or group</li>
              <li>Conduct unauthorized scraping, crawling, or data mining of our platform</li>
              <li>Circumvent, disable, or otherwise interfere with security features</li>
              <li>Use automated scripts to create accounts or interact with the platform</li>
              <li>Resell or sublicense access to Dakyworld Hub without our written consent</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">5. Content and Intellectual Property</h2>

            <h3 className="text-base font-semibold text-gray-800 mb-2 mt-4">5.1 Your Content</h3>
            <p>
              You retain ownership of all content you create, upload, or publish through Dakyworld
              Hub ("User Content"). By using the platform, you grant us a limited, non-exclusive,
              royalty-free license to store, display, and transmit your User Content solely as
              necessary to provide the service.
            </p>

            <h3 className="text-base font-semibold text-gray-800 mb-2 mt-4">5.2 Responsibility for Content</h3>
            <p>
              You are solely responsible for your User Content and for ensuring you have all
              necessary rights and permissions to publish it. We do not pre-screen content but
              reserve the right to remove content that violates these Terms or applicable law.
            </p>

            <h3 className="text-base font-semibold text-gray-800 mb-2 mt-4">5.3 Our Intellectual Property</h3>
            <p>
              All platform software, design, trademarks, and content provided by Dakyworld
              (excluding User Content) are owned by us or our licensors and protected by
              intellectual property laws. You may not copy, modify, or distribute our platform
              without our prior written consent.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">6. Subscription and Payments</h2>

            <h3 className="text-base font-semibold text-gray-800 mb-2 mt-4">7.1 Plans and Billing</h3>
            <p>
              Dakyworld Hub offers free and paid subscription plans. Paid plans are billed on a
              monthly or annual basis as selected at the time of purchase. All fees are in US dollars
              unless stated otherwise. Payments are processed securely by Paystack.
            </p>

            <h3 className="text-base font-semibold text-gray-800 mb-2 mt-4">7.2 Cancellation and Refunds</h3>
            <p>
              You may cancel your subscription at any time from your account settings. Cancellation
              takes effect at the end of the current billing period — you will retain access until
              then. We do not provide prorated refunds for partial billing periods, except where
              required by law.
            </p>

            <h3 className="text-base font-semibold text-gray-800 mb-2 mt-4">7.3 Price Changes</h3>
            <p>
              We may change subscription prices with at least 30 days' notice. Continued use after
              the price change takes effect constitutes acceptance of the new price.
            </p>

            <h3 className="text-base font-semibold text-gray-800 mb-2 mt-4">7.4 Failed Payments</h3>
            <p>
              If a payment fails, we may suspend your account after a grace period and retry the
              payment. Accounts with outstanding balances may be terminated after 30 days.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">7. Termination</h2>
            <p>
              Either party may terminate the account at any time. We may suspend or terminate your
              account immediately if you violate these Terms, engage in fraudulent activity, or if
              required by law. Upon termination:
            </p>
            <ul className="list-disc pl-5 mt-3 space-y-2">
              <li>Your access to the platform ceases immediately</li>
              <li>We will delete your data within 30 days (except data we are legally required to retain)</li>
              <li>Any outstanding fees remain due</li>
            </ul>
            <p className="mt-3">
              You may export your data before terminating your account. Contact{' '}
              <a href="mailto:support@dakyworld.com" className="text-blue-600 hover:underline">
                support@dakyworld.com
              </a>{' '}
              for data export assistance.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">8. Disclaimer of Warranties</h2>
            <p>
              Dakyworld Hub is provided "as is" and "as available" without warranties of any kind,
              express or implied. We do not warrant that:
            </p>
            <ul className="list-disc pl-5 mt-3 space-y-2">
              <li>The platform will be uninterrupted, error-free, or completely secure</li>
              <li>External services and dependencies will remain available or unchanged</li>
              <li>The platform will meet your specific business requirements</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">9. Limitation of Liability</h2>
            <p>
              To the maximum extent permitted by applicable law, Dakyworld and its affiliates,
              directors, employees, and licensors shall not be liable for any indirect, incidental,
              special, consequential, or punitive damages, including but not limited to loss of
              profits, data, or business, arising from your use of Dakyworld Hub — even if we have
              been advised of the possibility of such damages.
            </p>
            <p className="mt-3">
              Our total liability to you for any claims arising from these Terms or your use of the
              platform shall not exceed the greater of (a) the amount you paid us in the 12 months
              preceding the claim or (b) USD $100.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">10. Indemnification</h2>
            <p>
              You agree to indemnify, defend, and hold harmless Dakyworld and its affiliates from
              any claims, damages, losses, or expenses (including reasonable attorneys' fees) arising
              from your User Content, your use of the platform, or your violation of these Terms or
              any applicable law.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">11. Governing Law and Disputes</h2>
            <p>
              These Terms are governed by the laws of the applicable jurisdiction, without regard to
              conflict of law principles. Any disputes arising from these Terms or your use of
              Dakyworld Hub shall first be attempted to be resolved through good-faith negotiation.
              If resolution cannot be reached, disputes shall be submitted to binding arbitration or
              the courts of competent jurisdiction.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">12. Changes to These Terms</h2>
            <p>
              We may update these Terms from time to time. We will notify you of material changes by
              email or via an in-app notice at least 14 days before the changes take effect. Continued
              use of Dakyworld Hub after the effective date constitutes acceptance of the updated Terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">13. Contact Us</h2>
            <p>
              If you have questions about these Terms, please contact us:
            </p>
            <div className="mt-3 p-4 bg-gray-50 rounded-xl text-sm">
              <p className="font-semibold text-gray-900">Dakyworld</p>
              <p className="text-gray-600 mt-1">
                Email:{' '}
                <a href="mailto:legal@dakyworld.com" className="text-blue-600 hover:underline">
                  legal@dakyworld.com
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

export default TermsOfService;
