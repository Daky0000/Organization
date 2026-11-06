import { useEffect, useState } from 'react';
import { pricingService } from '../services/pricingService';
import { PricingPlan } from '../types/pricing';
import PublicNav from '../components/landing/PublicNav';
import PublicFooter from '../components/landing/PublicFooter';

type BillingCycle = 'monthly' | 'yearly';

const FALLBACK: PricingPlan[] = [
  {
    id: 'free',
    name: 'Free',
    description: 'For creators exploring AI content with no commitment.',
    price: 0,
    billingPeriod: 'monthly',
    features: [
      '100 AI credits/month',
      '2 social accounts',
      'AI text generation (1 credit/post)',
      'Content calendar',
      '20+ card templates',
      'Basic analytics',
      '1 team seat',
    ],
    isActive: true,
    discountPercentage: 0,
    isOnSale: false,
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'pro',
    name: 'Pro',
    description: 'For active brands and teams that need AI power to publish at scale.',
    price: 29,
    billingPeriod: 'monthly',
    features: [
      '2,000 AI credits/month',
      '8 social accounts',
      'AI image generation (6 models)',
      'Improve Prompt AI assistant',
      'Custom brand voice memory',
      'Bulk scheduling & auto-republish',
      'Advanced analytics & audience insights',
      '200+ card templates',
      '3 team seats',
      'Priority support',
    ],
    isActive: true,
    discountPercentage: 0,
    isOnSale: false,
    createdAt: '',
    updatedAt: '',
  },
  {
    id: 'agency',
    name: 'Agency',
    description: 'For agencies and operators running full-stack content operations.',
    price: 79,
    billingPeriod: 'monthly',
    features: [
      '6,000 AI credits/month',
      'Unlimited social accounts',
      'AI video generation (3 models)',
      'Full image editing suite',
      'Premium AI models',
      'White-label exports',
      'Client workspaces & review portals',
      'API access',
      'Dedicated support',
      '10 team seats',
    ],
    isActive: true,
    discountPercentage: 0,
    isOnSale: false,
    createdAt: '',
    updatedAt: '',
  },
];

const PLAN_CREDITS: Record<string, string> = {
  free: '100 credits / mo',
  starter: '100 credits / mo',
  pro: '2,000 credits / mo',
  growth: '2,000 credits / mo',
  agency: '6,000 credits / mo',
  scale: '6,000 credits / mo',
  business: '6,000 credits / mo',
};

function getCredits(plan: PricingPlan) {
  const key = plan.name.toLowerCase();
  for (const [k, v] of Object.entries(PLAN_CREDITS)) {
    if (key.includes(k)) return v;
  }
  return `${plan.price === 0 ? '100' : '2,000'} credits / mo`;
}

function isFeatured(plan: PricingPlan) {
  const n = plan.name.toLowerCase();
  return n.includes('pro') || n.includes('growth');
}

function fmt(price: number) {
  return price === 0 ? 'Free' : `$${Math.round(price)}`;
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M7 2v10M2 7h10" />
    </svg>
  );
}

const FAQS = [
  {
    q: 'Can I switch plans or cancel at any time?',
    a: 'Yes. You can upgrade, downgrade, or cancel directly from your workspace billing settings with one click. There are no lock-in contracts.',
  },
  {
    q: 'How do AI credits work?',
    a: 'Every plan includes a monthly allowance of AI credits. Generating a post or caption uses 1 credit, standard AI images use 5 credits, and HD/video generations use 15–30 credits.',
  },
  {
    q: 'What happens if I run out of AI credits?',
    a: 'All manual publishing, scheduling, card templates, and analytics continue to work without interruption. You can top up credit packs anytime or upgrade your plan.',
  },
  {
    q: 'Do you offer a money-back guarantee?',
    a: 'Yes. Every first-time paid subscription is covered by our 14-day money-back guarantee.',
  },
];

export default function PublicPricing({ onLoginClick }: { onLoginClick: () => void }) {
  const [plans, setPlans] = useState<PricingPlan[]>(FALLBACK);
  const [cycle, setCycle] = useState<BillingCycle>('monthly');

  useEffect(() => {
    pricingService
      .getPlans()
      .then((res) => {
        const active = Array.isArray(res) ? res.filter((p) => p.isActive) : [];
        if (active.length > 0) setPlans(active);
      })
      .catch(() => {});
  }, []);

  const displayedPlans = plans.filter((p) => p.billingPeriod === cycle || p.price === 0);
  const activePlans = displayedPlans.length >= 2 ? displayedPlans : FALLBACK;

  return (
    <>
      <PublicNav onLoginClick={onLoginClick} activePath="/pricing" />

      <main className="h-frame">
        {/* 1. Hero & Plans Panel */}
        <section className="h-panel h-dots h-sec">
          <div className="h-dotfield h-edge" />
          <div className="h-in">
            <div className="h-head">
              <div>
                <span className="h-cap">Plans &amp; pricing</span>
                <h1 className="text-[clamp(38px,4.8vw,64px)] mt-3">
                  Simple, transparent pricing.
                  <br />
                  <span className="text-muted">Pay only as you grow.</span>
                </h1>
              </div>

              {/* Billing cycle switch */}
              <div className="inline-flex items-center rounded-[10px] border border-line bg-soft p-1">
                <button
                  type="button"
                  onClick={() => setCycle('monthly')}
                  className={`rounded-[8px] px-4 py-2 text-[13.5px] font-medium transition ${
                    cycle === 'monthly' ? 'bg-white text-ink shadow-xs' : 'text-muted hover:text-ink'
                  }`}
                >
                  Monthly
                </button>
                <button
                  type="button"
                  onClick={() => setCycle('yearly')}
                  className={`inline-flex items-center gap-2 rounded-[8px] px-4 py-2 text-[13.5px] font-medium transition ${
                    cycle === 'yearly' ? 'bg-white text-ink shadow-xs' : 'text-muted hover:text-ink'
                  }`}
                >
                  Yearly
                  <span className="rounded-md bg-pale px-1.5 py-0.5 text-[11px] font-medium text-blue-d">
                    Save 20%
                  </span>
                </button>
              </div>
            </div>

            {/* Plans grid */}
            <div className="h-plans">
              {activePlans.map((plan) => {
                const featured = isFeatured(plan);
                const rawPrice =
                  cycle === 'yearly' && plan.billingPeriod === 'monthly' && plan.price > 0
                    ? Math.round(plan.price * 0.8)
                    : plan.price;
                return (
                  <div key={plan.id} className={`h-plan ${featured ? 'h-on' : ''}`}>
                    <div className="h-top">
                      <span className="h-cap">{getCredits(plan)}</span>
                      {featured && <span className="h-chip">Most popular</span>}
                    </div>
                    <h3>{plan.name}</h3>
                    <p>{plan.description}</p>

                    <ul className="my-4 space-y-2.5 text-[14.5px]">
                      {plan.features.map((f) => (
                        <li
                          key={f}
                          className={`flex items-center gap-2.5 ${
                            featured ? 'text-white/85' : 'text-ink'
                          }`}
                        >
                          <span
                            className={`inline-block h-1.5 w-1.5 rounded-full ${
                              featured ? 'bg-blue-light' : 'bg-blue'
                            }`}
                          />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>

                    <div className="h-amt">
                      <span>{rawPrice === 0 ? 'Free forever' : `Billed ${cycle}`}</span>
                      <b className="mt-1">
                        {fmt(rawPrice)}{' '}
                        {rawPrice > 0 && <small>/month</small>}
                      </b>
                      <button
                        type="button"
                        onClick={onLoginClick}
                        className={`mt-5 w-full h-btn ${featured ? 'h-btn-b' : 'btn-k'}`}
                      >
                        {rawPrice === 0 ? 'Start for free' : `Choose ${plan.name}`}
                        <ArrowIcon />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* 2. AI Credits Explained */}
        <section className="h-panel h-soft h-sec">
          <div className="h-in">
            <div className="h-head">
              <div>
                <span className="h-cap">AI credit ledger</span>
                <h2>
                  Predictable usage.
                  <br />
                  <span>Every action clearly metered.</span>
                </h2>
              </div>
              <p>
                Scheduling, calendar management, templates, and analytics never consume credits.
                Credits are only used when invoking AI generation models.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { label: 'AI Post & Caption', cost: '1', unit: 'credit / generation', desc: 'Platform-tailored copy, hooks, and hashtags in your brand voice.' },
                { label: 'Improve Prompt', cost: '1', unit: 'credit / refinement', desc: 'Expand a rough idea into a structured creative brief.' },
                { label: 'Standard AI Image', cost: '5', unit: 'credits / image', desc: 'Fast visual generation sized for LinkedIn, X, or Instagram.' },
                { label: 'Studio HD & Video', cost: '15–30', unit: 'credits / asset', desc: 'High-definition Mystic visuals and short-form social video.' },
              ].map((item) => (
                <div key={item.label} className="h-tile">
                  <span className="h-cap">{item.label}</span>
                  <div>
                    <b>{item.cost}</b>
                    <small className="font-mono text-[11px] uppercase tracking-wider text-blue mt-1">
                      {item.unit}
                    </small>
                    <p className="mt-2 text-[13.5px] text-muted leading-snug">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 3. Feature Comparison Table */}
        <section className="h-panel h-sec">
          <div className="h-in">
            <div className="h-head">
              <div>
                <span className="h-cap">Side-by-side comparison</span>
                <h2>
                  Every detail.
                  <br />
                  <span>In one table.</span>
                </h2>
              </div>
            </div>

            <div className="overflow-x-auto rounded-[16px] border border-line">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-line bg-soft">
                    <th className="py-4 px-5 text-[11px] font-medium uppercase tracking-[0.14em] text-faint">
                      Capability
                    </th>
                    <th className="py-4 px-5 text-[11px] font-medium uppercase tracking-[0.14em] text-faint">
                      Free
                    </th>
                    <th className="py-4 px-5 text-[11px] font-medium uppercase tracking-[0.14em] text-blue-d bg-pale/50">
                      Pro ($29/mo)
                    </th>
                    <th className="py-4 px-5 text-[11px] font-medium uppercase tracking-[0.14em] text-faint">
                      Agency ($79/mo)
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line text-[14.5px]">
                  {[
                    ['Monthly AI credits', '100', '2,000', '6,000'],
                    ['Connected social accounts', '2', '8', 'Unlimited'],
                    ['Team seats', '1', '3', '10'],
                    ['Card studio templates', '20+', '200+', '200+ & White-label'],
                    ['Custom brand voice memory', '—', 'Included', 'Unlimited profiles'],
                    ['AI image & video studio', '—', '6 image models', 'Image + 3 video models'],
                    ['Client review portals', '—', '—', 'Included'],
                    ['API & webhook access', '—', '—', 'Included'],
                  ].map(([feature, free, pro, agency]) => (
                    <tr key={feature} className="hover:bg-soft/60 transition-colors">
                      <td className="py-3.5 px-5 font-medium text-ink">{feature}</td>
                      <td className="py-3.5 px-5 text-muted font-mono text-[13px]">{free}</td>
                      <td className="py-3.5 px-5 text-ink font-medium bg-pale/25 font-mono text-[13px]">
                        {pro}
                      </td>
                      <td className="py-3.5 px-5 text-ink font-mono text-[13px]">{agency}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* 4. FAQ */}
        <section className="h-panel h-sec">
          <div className="h-in">
            <div className="h-head">
              <div>
                <span className="h-cap">Questions &amp; answers</span>
                <h2>
                  Straight answers.
                  <br />
                  <span>Before you subscribe.</span>
                </h2>
              </div>
            </div>

            <div className="h-qa">
              {FAQS.map((f) => (
                <details key={f.q}>
                  <summary>
                    <span>{f.q}</span>
                    <i>
                      <PlusIcon />
                    </i>
                  </summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* 5. Closing Navy Band */}
        <section className="h-panel h-band h-navy h-dots h-sec">
          <div className="h-dotfield" />
          <div className="h-in text-center max-w-[680px]">
            <span className="h-cap !text-blue-light">Start today</span>
            <h2 className="!text-white text-[clamp(34px,4.2vw,56px)] mt-3">
              Start building your
              <br />
              <span className="text-white/60">audience today.</span>
            </h2>
            <p className="mt-4 text-[16.5px] text-white/75 max-w-[46ch] mx-auto">
              Free plan available forever. No credit card required to open your workspace.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <button type="button" onClick={onLoginClick} className="h-btn h-btn-b">
                Get started free
                <ArrowIcon />
              </button>
            </div>
          </div>
        </section>

        <PublicFooter />
      </main>
    </>
  );
}
