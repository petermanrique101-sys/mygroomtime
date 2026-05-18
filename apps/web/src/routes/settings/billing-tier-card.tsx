import type { PaidPlanTier } from '@mygroomtime/shared';
import { centsToDollarString } from './money';

export type TierDescriptor = {
  tier: PaidPlanTier;
  name: string;
  blurb: string;
  features: string[];
};

export const TIERS: TierDescriptor[] = [
  {
    tier: 'starter',
    name: 'Starter',
    blurb: 'Calendar, clients, SMS reminders.',
    features: ['Unlimited clients & pets', 'SMS reminders', 'Single van'],
  },
  {
    tier: 'pro',
    name: 'Pro',
    blurb: 'Adds public booking, recurring rebooks, Google Calendar sync.',
    features: [
      'Everything in Starter',
      'Public booking page for customers',
      'Recurring rebooks',
      'Google Calendar sync',
      'Up to 3 vans',
    ],
  },
  {
    tier: 'business',
    name: 'Business',
    blurb: 'Multi-van dispatch and payroll splits.',
    features: [
      'Everything in Pro',
      'Unlimited vans',
      'Dispatch board',
      'Payroll splits CSV',
    ],
  },
];

type Props = {
  tier: TierDescriptor;
  priceMonthlyCents: number;
  isCurrent: boolean;
  disabled: boolean;
  onSwitch: () => void;
};

export function BillingTierCard({
  tier,
  priceMonthlyCents,
  isCurrent,
  disabled,
  onSwitch,
}: Props): JSX.Element {
  return (
    <article
      data-tier={tier.tier}
      className={`rounded-xl border p-5 shadow-sm ${
        isCurrent ? 'border-gray-900 bg-gray-50' : 'border-gray-200 bg-white'
      }`}
    >
      <header className="flex items-baseline justify-between">
        <h3 className="text-base font-semibold">{tier.name}</h3>
        <span className="text-lg font-semibold">
          ${centsToDollarString(priceMonthlyCents)}
          <span className="text-sm font-normal text-gray-500">/mo</span>
        </span>
      </header>
      <p className="mt-1 text-sm text-gray-600">{tier.blurb}</p>
      <ul className="mt-3 space-y-1 text-sm text-gray-700">
        {tier.features.map((f) => (
          <li key={f}>· {f}</li>
        ))}
      </ul>
      {isCurrent ? (
        <p className="mt-4 text-sm font-semibold text-gray-900">Current plan</p>
      ) : (
        <button
          type="button"
          onClick={onSwitch}
          disabled={disabled}
          className="mt-4 block min-h-[44px] w-full rounded-lg bg-gray-900 px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          Switch to {tier.name}
        </button>
      )}
    </article>
  );
}
