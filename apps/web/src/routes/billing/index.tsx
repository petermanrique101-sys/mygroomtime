import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { BillingStatusResponse } from '@mygroomtime/shared';
import { fetchBilling } from '../../lib/billing-api.js';
import { useAuth } from '../../lib/auth-context.js';

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

function planLabel(plan: BillingStatusResponse['plan']): string {
  switch (plan) {
    case 'unpaid':
      return 'No active plan';
    case 'starter':
      return 'Starter — $49/mo';
    case 'pro':
      return 'Pro — $99/mo';
    case 'business':
      return 'Business — $149/mo';
    case 'past_due':
      return 'Past due';
    case 'canceled':
      return 'Canceled';
  }
}

export default function BillingRoute(): JSX.Element {
  const { session } = useAuth();
  const [data, setData] = useState<BillingStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetchBilling();
      if (cancelled) return;
      if (res.ok) setData(res.data);
      else setError(res.error.message);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const plan = data?.plan ?? session?.tenant.plan ?? 'unpaid';
  const isPastDue = plan === 'past_due' || Boolean(data?.pastDueAt);
  const isCanceled = plan === 'canceled';

  return (
    <main className="min-h-screen bg-white text-gray-900">
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-5 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>

        {isPastDue && !isCanceled && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">Your last payment failed.</p>
            <p className="mt-1">
              Update your card to keep your account active.{' '}
              <Link to="/billing/portal" className="underline">
                Manage billing
              </Link>
            </p>
          </div>
        )}

        {isCanceled && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
            <p className="font-semibold">Your subscription is canceled.</p>
            <p className="mt-1">Reactivate to continue using MyGroomTime.</p>
            <Link
              to="/signup/billing"
              className="mt-3 inline-flex min-h-[40px] items-center rounded-lg bg-red-600 px-3 text-sm font-semibold text-white"
            >
              Choose a plan
            </Link>
          </div>
        )}

        <section className="mt-6 rounded-xl border border-gray-200 p-5">
          <h2 className="text-base font-semibold">Current plan</h2>
          <p className="mt-1 text-lg">{planLabel(plan)}</p>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <dt className="text-gray-500">Status</dt>
            <dd>{data?.stripeSubscriptionStatus ?? '—'}</dd>
            <dt className="text-gray-500">Renews</dt>
            <dd>{fmtDate(data?.currentPeriodEnd ?? null)}</dd>
            {data?.pastDueAt ? (
              <>
                <dt className="text-gray-500">Past due since</dt>
                <dd>{fmtDate(data.pastDueAt)}</dd>
              </>
            ) : null}
          </dl>
          <button
            type="button"
            disabled
            className="mt-5 block min-h-[44px] w-full cursor-not-allowed rounded-lg border border-gray-300 px-4 text-sm text-gray-500"
            title="Coming in the next chunk"
          >
            Manage billing (coming soon)
          </button>
        </section>

        {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
      </div>
    </main>
  );
}
