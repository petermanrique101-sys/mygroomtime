import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PaidPlanTier } from '@mygroomtime/shared';
import { startCheckout } from '../../lib/billing-api.js';
import { useAuth } from '../../lib/auth-context.js';

type TierCard = {
  tier: PaidPlanTier;
  name: string;
  priceLabel: string;
  blurb: string;
  features: string[];
};

const TIERS: TierCard[] = [
  {
    tier: 'starter',
    name: 'Starter',
    priceLabel: '$49',
    blurb: 'For solo groomers running one van.',
    features: ['Unlimited clients & pets', 'SMS reminders', 'Public booking page'],
  },
  {
    tier: 'pro',
    name: 'Pro',
    priceLabel: '$99',
    blurb: 'Up to 3 vans, recurring rebook flows, Google Calendar sync.',
    features: ['Everything in Starter', 'Up to 3 vans', 'Recurring rebooks', 'Google Calendar sync'],
  },
  {
    tier: 'business',
    name: 'Business',
    priceLabel: '$149',
    blurb: 'Unlimited vans, dispatch board, payroll splits.',
    features: ['Everything in Pro', 'Unlimited vans', 'Dispatch board', 'Payroll splits CSV'],
  },
];

export default function SignupBillingRoute(): JSX.Element {
  const { session, logout } = useAuth();
  const navigate = useNavigate();
  const [busyTier, setBusyTier] = useState<PaidPlanTier | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubscribe(tier: PaidPlanTier): Promise<void> {
    setError(null);
    setBusyTier(tier);
    const res = await startCheckout(tier);
    if (!res.ok) {
      setBusyTier(null);
      setError(res.error.message);
      return;
    }
    window.location.assign(res.data.url);
  }

  async function onSignOut(): Promise<void> {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <main className="min-h-screen bg-white text-gray-900">
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-5 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Pick a plan</h1>
        <p className="mt-1 text-sm text-gray-500">
          {session
            ? `Choose a plan for ${session.tenant.businessName}. Cancel anytime.`
            : 'Choose a plan to keep going. Cancel anytime.'}
        </p>

        {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}

        <ul className="mt-6 space-y-4">
          {TIERS.map((t) => (
            <li key={t.tier}>
              <article className="rounded-xl border border-gray-200 p-5 shadow-sm">
                <header className="flex items-baseline justify-between">
                  <h2 className="text-lg font-semibold">{t.name}</h2>
                  <span className="text-xl font-semibold">
                    {t.priceLabel}
                    <span className="text-sm font-normal text-gray-500">/mo</span>
                  </span>
                </header>
                <p className="mt-1 text-sm text-gray-600">{t.blurb}</p>
                <ul className="mt-3 space-y-1 text-sm text-gray-700">
                  {t.features.map((f) => (
                    <li key={f}>· {f}</li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => void onSubscribe(t.tier)}
                  disabled={busyTier !== null}
                  className="mt-4 block min-h-[44px] w-full rounded-lg bg-gray-900 px-4 text-base font-semibold text-white disabled:opacity-50"
                >
                  {busyTier === t.tier ? 'Redirecting…' : `Subscribe to ${t.name}`}
                </button>
              </article>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={() => void onSignOut()}
          className="mt-6 block min-h-[44px] w-full rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-700"
        >
          Sign out
        </button>
      </div>
    </main>
  );
}
