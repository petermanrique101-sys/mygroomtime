import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SettingsSmsStatus } from '@mygroomtime/shared';
import { fetchSettingsSms, updateSettingsSms } from '../../lib/settings-sms-api';

const QUERY_KEY = ['settings-sms'] as const;

export default function SettingsSmsRoute(): JSX.Element {
  const qc = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);

  const query = useQuery<SettingsSmsStatus, Error>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const res = await fetchSettingsSms();
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
  });

  const toggleMut = useMutation({
    mutationFn: async (next: boolean) => {
      const res = await updateSettingsSms(next);
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    onSuccess: (data) => {
      setActionError(null);
      qc.setQueryData(QUERY_KEY, data);
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
            <h1 className="text-base font-semibold tracking-tight">SMS reminders</h1>
            <span className="w-12" />
          </div>
        </header>
        <section className="flex-1 px-4 py-4">
          {query.isLoading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : query.isError ? (
            <p className="text-sm text-red-700">{(query.error as Error).message}</p>
          ) : (
            <ToggleCard
              data={query.data!}
              actionError={actionError}
              submitting={toggleMut.isPending}
              onToggle={(next) => toggleMut.mutate(next)}
            />
          )}
        </section>
      </div>
    </main>
  );
}

type CardProps = {
  data: SettingsSmsStatus;
  actionError: string | null;
  submitting: boolean;
  onToggle: (next: boolean) => void;
};

function ToggleCard({ data, actionError, submitting, onToggle }: CardProps): JSX.Element {
  const blocked = !data.tierAllowsReminders;
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Automatic text reminders</p>
            <p className="mt-1 text-sm text-gray-500">
              Send the customer a confirmation 48 hours out, a heads-up 2 hours before
              you arrive, and a thank-you with a review nudge the day after.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={data.remindersEnabled}
            aria-label="Enable SMS reminders"
            disabled={submitting || blocked}
            onClick={() => onToggle(!data.remindersEnabled)}
            className={
              'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition disabled:opacity-50 ' +
              (data.remindersEnabled ? 'bg-gray-900' : 'bg-gray-300')
            }
          >
            <span
              className={
                'inline-block h-5 w-5 transform rounded-full bg-white transition ' +
                (data.remindersEnabled ? 'translate-x-6' : 'translate-x-1')
              }
            />
          </button>
        </div>
      </div>

      {blocked ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">Upgrade to Pro to enable SMS reminders.</p>
          <p className="mt-1">
            Reminders are part of the Pro and Business plans. Upgrade and we'll start texting
            confirmations automatically.
          </p>
          <Link
            to="/settings/billing"
            className="mt-3 inline-block rounded-lg bg-gray-900 px-3 py-2 text-xs font-semibold text-white"
          >
            See plans
          </Link>
        </div>
      ) : null}

      {actionError ? (
        <p role="alert" className="text-sm text-red-700">
          {actionError}
        </p>
      ) : null}

      <div className="space-y-3 rounded-lg border border-gray-200 p-4 text-sm">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">48h out</p>
          <p className="mt-1 text-gray-800">
            "Hi Carlos, this is Plano Pup Spa confirming Bruno's Full Groom on Monday, May 20
            at 10:00 AM."
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            2h before
          </p>
          <p className="mt-1 text-gray-800">
            "Hi Carlos, Plano Pup Spa is heading to Bruno in about 2 hours for Full Groom."
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Day after
          </p>
          <p className="mt-1 text-gray-800">
            "Thanks for trusting Plano Pup Spa with Bruno. We'd love your feedback!"
          </p>
        </div>
        <p className="pt-2 text-xs text-gray-500">
          We append "Reply STOP to opt out." to every message. Customers who text STOP
          stop receiving anything until they text START.
        </p>
      </div>
    </div>
  );
}
