export default function RefundPolicy({ embedded = false }: { embedded?: boolean }) {
  return (
    <div className={embedded ? '' : 'min-h-screen bg-canvas py-10 px-3 sm:px-6'}>
      <div className={embedded ? '' : 'max-w-3xl mx-auto bg-white rounded-[22px] border border-line p-8 sm:p-12'}>
        {!embedded && (
          <div className="mb-8 flex items-center justify-between gap-4 border-b border-line pb-5">
            <a href="/" className="inline-flex items-center gap-2">
              <img src="/brand/header-lockup-on-light.png" alt="DakyXTech" className="h-6 w-auto" />
            </a>
            <a
              href="/"
              className="text-[13px] text-blue hover:underline font-medium"
              onClick={(e) => { e.preventDefault(); window.history.back(); }}
            >
              &larr; Back
            </a>
          </div>
        )}

        <span className="os-eyebrow">Legal · Refunds</span>
        <h1 className="text-[34px] font-normal tracking-[-0.035em] text-ink mt-2 mb-1">Refund Policy</h1>
        <p className="text-xs font-mono text-muted mb-8">Last updated: May 20, 2026</p>

        <div className="prose prose-slate max-w-none space-y-8 text-ink/85 leading-relaxed">

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">1. Overview</h2>
            <p>
              At Dakyworld, we want you to be completely satisfied with your subscription. This Refund
              Policy outlines when and how you can request a refund for payments made on the Dakyworld
              Hub platform. Please read it carefully before subscribing.
            </p>
            <p className="mt-3">
              By subscribing to any Dakyworld plan, you agree to the terms of this Refund Policy.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">2. 14-Day Money-Back Guarantee</h2>
            <p>
              All new paid subscriptions are eligible for a full refund within <strong>14 calendar
              days</strong> of the initial payment date. If you are not satisfied with our service for
              any reason, contact us within this window and we will process a full refund — no
              questions asked.
            </p>
            <p className="mt-3">
              The 14-day guarantee applies to:
            </p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>First-time subscriptions to any paid plan (Starter, Pro, or Business)</li>
              <li>Upgrades from a lower-tier plan to a higher-tier plan</li>
            </ul>
            <p className="mt-3">
              It does <strong>not</strong> apply to subsequent billing cycles or renewals.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">3. Subscription Renewals</h2>
            <p>
              Dakyworld subscriptions renew automatically at the end of each billing cycle (monthly or
              annually). We send a reminder email <strong>7 days before</strong> each renewal so you
              have time to cancel if you no longer wish to continue.
            </p>
            <p className="mt-3">
              Renewal charges are generally non-refundable. However, if you contact us within{' '}
              <strong>48 hours</strong> of an unintended renewal — for example, you forgot to cancel
              and have not used the service during the new period — we will review your case and may
              issue a discretionary refund.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">4. Annual Plans</h2>
            <p>
              Annual subscribers who cancel mid-cycle are eligible for a <strong>pro-rated
              refund</strong> of the unused full months remaining, minus any discount received for
              choosing the annual plan over monthly billing.
            </p>
            <p className="mt-3">Example: if you subscribed to an annual plan, used 4 months, and then
              cancelled, you may be refunded for the remaining 8 months at the standard monthly rate,
              less the annual discount benefit applied to the first 4 months.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">5. Non-Refundable Items</h2>
            <p>The following are not eligible for refunds:</p>
            <ul className="list-disc pl-5 mt-2 space-y-2">
              <li>
                <strong>Add-on credits:</strong> SMS credits, email send credits, or AI generation
                credits that have been consumed cannot be refunded, even partially.
              </li>
              <li>
                <strong>One-time purchases:</strong> Any one-time feature unlocks or template packs
                are non-refundable once delivered.
              </li>
              <li>
                <strong>Accounts suspended for policy violations:</strong> If your account was
                suspended or terminated due to a breach of our Terms of Service, no refund will be
                issued.
              </li>
              <li>
                <strong>Free-trial conversions:</strong> If you converted from a free trial and did
                not cancel before the trial ended, the resulting charge is not automatically
                refundable, but you may contact us within 48 hours for a courtesy review.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">6. How to Request a Refund</h2>
            <p>To request a refund, please contact our support team:</p>
            <ul className="list-disc pl-5 mt-3 space-y-2">
              <li>
                <strong>Email:</strong>{' '}
                <a href="mailto:support@dakyworld.com" className="text-blue-600 hover:underline">
                  support@dakyworld.com
                </a>
              </li>
              <li>
                <strong>Subject line:</strong> "Refund Request — [your account email]"
              </li>
              <li>
                <strong>Include:</strong> your registered email address, the plan name, the payment
                date, and a brief reason for the request.
              </li>
            </ul>
            <p className="mt-3">
              We aim to respond to all refund requests within <strong>2 business days</strong>. Once
              approved, refunds are returned to your original payment method and typically appear
              within 5–10 business days depending on your bank or card issuer.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">7. Chargebacks</h2>
            <p>
              We ask that you contact us directly before initiating a chargeback with your bank or
              card issuer. Most billing disputes can be resolved quickly and amicably. Initiating an
              unjustified chargeback may result in suspension of your account and affect your ability
              to re-subscribe in the future.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">8. Cancellation vs. Refund</h2>
            <p>
              Cancelling your subscription stops future billing but does <strong>not</strong>{' '}
              automatically trigger a refund for the current billing period. You will retain access to
              paid features until the end of the period you have already paid for. If you also want a
              refund for the current period, you must explicitly request one following the process in
              Section 6.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">9. Currency and Processing</h2>
            <p>
              All payments and refunds are processed in US dollars (USD) via Paystack. If your bank
              account is in a different currency, your bank's exchange rate at the time of the refund
              may differ from the rate at the time of the original charge. Dakyworld is not responsible
              for any currency conversion differences.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">10. Changes to This Policy</h2>
            <p>
              We reserve the right to update this Refund Policy at any time. Changes will be posted on
              this page with an updated date at the top. If changes are material, we will notify
              affected subscribers by email at least 7 days before the change takes effect. Continued
              use of the service after changes take effect constitutes acceptance of the revised policy.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">11. Contact Us</h2>
            <p>
              If you have any questions about this Refund Policy, please reach out:
            </p>
            <ul className="list-disc pl-5 mt-3 space-y-1">
              <li>
                <strong>Email:</strong>{' '}
                <a href="mailto:support@dakyworld.com" className="text-blue-600 hover:underline">
                  support@dakyworld.com
                </a>
              </li>
              <li><strong>Company:</strong> Dakyworld</li>
              <li><strong>Website:</strong> dakyworld.com</li>
            </ul>
          </section>

        </div>
      </div>
    </div>
  );
}
