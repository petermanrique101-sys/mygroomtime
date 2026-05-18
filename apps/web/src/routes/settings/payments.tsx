import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SettingsPaymentsStatus } from '@mygroomtime/shared';
import {
  fetchSettingsPayments,
  onboardSettingsPayments,
} from '../../lib/settings-payments-api';

const QUERY_KEY = ['settings-payments'] as const;

export default function SettingsPaymentsRoute(): JSX.Element {
  const qc = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);

  const query = useQuery<SettingsPaymentsStatus, Error>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const res = await fetchSettingsPayments();
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
  });

  const onboardMut = useMutation({
    mutationFn: async () => {
      const res = await onboardSettingsPayments();
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    onSuccess: (data) => {
      setActionError(null);
      // why: navigate to Stripe-hosted onboarding (twin auto-completes; live shows the
      // real onboarding form). On return, the GET below refreshes status.
      window.location.assign(data.url);
    },
    onError: (err) => setActionError((err as Error).message),
  });

  return (
    <main className="min-h-screen bg-white text-gray-900">
      <div className="mx-auto flex min-h-screen max-w-md flex-col">
        <header className="sticky top-0 z-10 border-b border-gray-100 bg-white px-4 pb-3 pt-5">
          <div className="flex items-center justify-between">
            <Link to="/settings" className="text-sm text-gray-600 underline">
              ← Settings
            </Link>
            <h1 className="text-base font-semibold tracking-tight">Payments</h1>
            <span className="w-12" />
          </div>
        </header>

        <section className="flex-1 px-4 py-4">
          {query.isLoading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : query.isError ? (
            <p className="text-sm text-red-700">{(query.error as Error).message}</p>
          ) : (
            <StatusCard
              data={query.data!}
              actionError={actionError}
              submitting={onboardMut.isPending}
              onAction={() => onboardMut.mutate()}
              onRefresh={() => void qc.invalidateQueries({ queryKey: QUERY_KEY })}
            />
          )}
        </section>
      </div>
    </main>
  );
}

type CardProps = {
  data: SettingsPaymentsStatus;
  actionError: string | null;
  submitting: boolean;
  onAction: () => void;
  onRefresh: () => void;
};

function StatusCard({
  data,
  actionError,
  submitting,
  onAction,
  onRefresh,
}: CardProps): JSX.Element {
  const state: 'not_started' | 'incomplete' | 'active' = !data.connectAccountId
    ? 'not_started'
    : data.chargesEnabled
      ? 'active'
      : 'incomplete';

  const { tone, title, message, cta } = stateCopy(state);

  return (
    <div className="space-y-4">
      <div className={`rounded-lg border p-4 ${tone}`}>
        <p className="text-xs font-medium uppercase tracking-wide">{title}</p>
        <p className="mt-1 text-sm">{message}</p>
      </div>

      {actionError ? (
        <p role="alert" className="text-sm text-red-700">
          {actionError}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        {state !== 'active' ? (
          <button
            type="button"
            onClick={onAction}
            disabled={submitting}
            className="block min-h-[44px] w-full rounded-lg bg-gray-900 px-4 text-base font-semibold text-white disabled:bg-gray-400"
          >
            {submitting ? 'Opening Stripe…' : cta}
          </button>
        ) : (
          <button
            type="button"
            onClick={onRefresh}
            className="block min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-4 text-base font-medium text-gray-800"
          >
            Refresh status
          </button>
        )}
      </div>

      <dl className="rounded-lg border border-gray-200 p-4 text-sm">
        <Row label="Charges enabled">{data.chargesEnabled ? 'Yes' : 'No'}</Row>
        <Row label="Payouts enabled">{data.payoutsEnabled ? 'Yes' : 'No'}</Row>
        <Row label="Details submitted">{data.detailsSubmitted ? 'Yes' : 'No'}</Row>
        {data.statusUpdatedAt ? (
          <Row label="Last synced">
            {new Date(data.statusUpdatedAt).toLocaleString()}
          </Row>
        ) : null}
      </dl>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="text-xs uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

function stateCopy(state: 'not_started' | 'incomplete' | 'active'): {
  tone: string;
  title: string;
  message: string;
  cta: string;
} {
  if (state === 'active') {
    return {
      tone: 'border-green-200 bg-green-50 text-green-900',
      title: 'Active',
      message:
        'Stripe payments are live. Customers can book online and pay deposits to your connected account.',
      cta: 'Set up payments',
    };
  }
  if (state === 'incomplete') {
    return {
      tone: 'border-amber-200 bg-amber-50 text-amber-900',
      title: 'Setup incomplete',
      message:
        "Stripe still needs a few details before your account can accept charges. Resume onboarding to finish.",
      cta: 'Continue setup',
    };
  }
  return {
    tone: 'border-gray-200 bg-gray-50 text-gray-800',
    title: 'Not set up',
    message:
      'Connect your bank to accept booking deposits. We hand off to Stripe for the rest.',
    cta: 'Set up payments',
  };
}
