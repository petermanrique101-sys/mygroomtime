import type { PaidPlanTier, PreviewPlanChangeResponse } from '@mygroomtime/shared';
import { centsToDollarString } from './money';

const DOWNGRADE_BULLETS_PRO_TO_STARTER: string[] = [
  'Public booking page will no longer be available to your customers',
  'Google Calendar sync turns off',
  'Recurring rebook prompts stop',
  'Already-booked appointments stay on your calendar',
];

const DOWNGRADE_BULLETS_BUSINESS_TO_PRO: string[] = [
  'Multi-van dispatch board and payroll splits CSV turn off',
  'Already-booked appointments and vehicle assignments stay',
];

const DOWNGRADE_BULLETS_BUSINESS_TO_STARTER: string[] = [
  ...DOWNGRADE_BULLETS_PRO_TO_STARTER,
  'Multi-van dispatch board and payroll splits CSV turn off',
];

const UPGRADE_BULLETS_STARTER_TO_PRO: string[] = [
  'Public booking page goes live for your customers',
  'Recurring rebook prompts turn on',
  'Google Calendar sync becomes available',
  'You can run up to 3 vans',
];

const UPGRADE_BULLETS_STARTER_TO_BUSINESS: string[] = [
  ...UPGRADE_BULLETS_STARTER_TO_PRO,
  'Multi-van dispatch board and payroll splits CSV',
];

const UPGRADE_BULLETS_PRO_TO_BUSINESS: string[] = [
  'Multi-van dispatch board for assigning appointments across groomers',
  'Payroll splits CSV at the end of each pay period',
  'Unlimited vans',
];

export function whatChangesBullets(
  currentPlan: PaidPlanTier,
  targetPlan: PaidPlanTier,
): string[] {
  if (currentPlan === 'pro' && targetPlan === 'starter') return DOWNGRADE_BULLETS_PRO_TO_STARTER;
  if (currentPlan === 'business' && targetPlan === 'pro') return DOWNGRADE_BULLETS_BUSINESS_TO_PRO;
  if (currentPlan === 'business' && targetPlan === 'starter')
    return DOWNGRADE_BULLETS_BUSINESS_TO_STARTER;
  if (currentPlan === 'starter' && targetPlan === 'pro') return UPGRADE_BULLETS_STARTER_TO_PRO;
  if (currentPlan === 'starter' && targetPlan === 'business')
    return UPGRADE_BULLETS_STARTER_TO_BUSINESS;
  if (currentPlan === 'pro' && targetPlan === 'business') return UPGRADE_BULLETS_PRO_TO_BUSINESS;
  return [];
}

function tierTitle(t: PaidPlanTier): string {
  if (t === 'starter') return 'Starter';
  if (t === 'pro') return 'Pro';
  return 'Business';
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

type Props = {
  currentPlan: PaidPlanTier;
  preview: PreviewPlanChangeResponse;
  submitting: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
};

export function BillingPreviewModal({
  currentPlan,
  preview,
  submitting,
  error,
  onConfirm,
  onCancel,
}: Props): JSX.Element {
  const target = tierTitle(preview.targetPlan);
  const bullets = whatChangesBullets(currentPlan, preview.targetPlan);
  const todayLine =
    preview.amountDueCents > 0
      ? `We'll charge $${centsToDollarString(preview.amountDueCents)} today for the rest of this billing period on ${target}.`
      : preview.creditCents > 0
        ? `We'll credit $${centsToDollarString(preview.creditCents)} to your next invoice for the unused time on ${tierTitle(currentPlan)}.`
        : `No charge or credit today — your plan flips immediately.`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Switch to ${target}`}
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 sm:items-center"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold tracking-tight">
          Switch to {target} — ${centsToDollarString(preview.nextChargeCents)}/mo
        </h2>
        <p className="mt-2 text-sm text-gray-700">{todayLine}</p>
        <p className="mt-1 text-sm text-gray-700">
          Then ${centsToDollarString(preview.nextChargeCents)}/mo starting{' '}
          {formatDate(preview.currentPeriodEndIso)}.
        </p>

        {bullets.length > 0 ? (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              What changes
            </p>
            <ul className="mt-2 space-y-1 text-sm text-gray-700">
              {bullets.map((b) => (
                <li key={b}>· {b}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="mt-4 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="block min-h-[44px] flex-1 rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting}
            className="block min-h-[44px] flex-1 rounded-lg bg-gray-900 px-4 text-sm font-semibold text-white disabled:bg-gray-400"
          >
            {submitting ? 'Switching…' : `Confirm switch to ${target}`}
          </button>
        </div>
      </div>
    </div>
  );
}
