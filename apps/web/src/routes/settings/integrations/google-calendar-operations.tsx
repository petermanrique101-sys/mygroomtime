import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthOptional } from '../../../lib/auth-context';
import {
  disconnectGcalOps,
  fetchGcalOpsStatus,
  startGcalOpsConnect,
  type GcalOpsStatus,
} from '../../../lib/gcal-api';

const QUERY_KEY = ['settings-gcal-ops'] as const;

const STATUS_BANNERS: Record<string, { tone: 'success' | 'warn'; text: string }> = {
  connected: {
    tone: 'success',
    text: 'Operations calendar connected. All team appointments will mirror.',
  },
  denied: { tone: 'warn', text: 'Google permission was denied. Try again.' },
  invalid_state: { tone: 'warn', text: 'Connect session expired. Click Connect to retry.' },
  invalid_request: { tone: 'warn', text: 'Something went wrong with the redirect. Try again.' },
  session_changed: {
    tone: 'warn',
    text: 'Your session changed during connect. Sign in again and retry.',
  },
  connect_failed: { tone: 'warn', text: "We couldn't reach Google. Try again in a minute." },
};

export default function GoogleCalendarOperationsRoute(): JSX.Element {
  const auth = useAuthOptional();
  const plan = auth?.session?.tenant.plan ?? 'starter';
  const isBusiness = plan === 'business';

  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const statusParam = searchParams.get('status');
  const [actionError, setActionError] = useState<string | null>(null);

  const query = useQuery<GcalOpsStatus, Error>({
    queryKey: QUERY_KEY,
    enabled: isBusiness,
    queryFn: async () => {
      const res = await fetchGcalOpsStatus();
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
  });

  const connectMut = useMutation({
    mutationFn: async () => {
      const res = await startGcalOpsConnect();
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (err) => setActionError((err as Error).message),
  });

  const disconnectMut = useMutation({
    mutationFn: async () => {
      const res = await disconnectGcalOps();
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    onSuccess: () => {
      setActionError(null);
      qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (err) => setActionError((err as Error).message),
  });

  if (!isBusiness) {
    return (
      <main className="min-h-screen bg-white px-4 py-6 text-gray-900">
        <div className="mx-auto max-w-md">
          <Link to="/settings/integrations/google-calendar" className="text-sm text-gray-600 underline">
            ← Google Calendar
          </Link>
          <h1 className="mt-3 text-lg font-semibold">Operations calendar</h1>
          <p className="mt-2 text-sm text-gray-600">
            The operations calendar is a Business-tier feature. It mirrors every team
            appointment to a single Google Calendar.
          </p>
          <Link
            to="/settings/billing"
            className="mt-4 inline-block rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white"
          >
            Upgrade to Business
          </Link>
        </div>
      </main>
    );
  }

  const banner = statusParam ? STATUS_BANNERS[statusParam] : null;

  return (
    <main className="min-h-screen bg-white text-gray-900">
      <div className="mx-auto flex min-h-screen max-w-md flex-col">
        <header className="sticky top-0 z-10 border-b border-gray-100 bg-white px-4 pb-3 pt-5">
          <Link to="/settings/integrations/google-calendar" className="text-sm text-gray-600 underline">
            ← Google Calendar
          </Link>
          <h1 className="mt-1 text-base font-semibold">Operations calendar</h1>
        </header>
        <section className="flex-1 space-y-4 px-4 py-4">
          {banner ? (
            <div
              role="status"
              className={
                'rounded-lg border p-3 text-sm ' +
                (banner.tone === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  : 'border-amber-200 bg-amber-50 text-amber-900')
              }
            >
              {banner.text}
            </div>
          ) : null}

          <p className="text-sm text-gray-700">
            Every appointment across your team will mirror to this calendar. Useful for
            seeing your full schedule in one place.
          </p>

          {query.isLoading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : query.isError ? (
            <p className="text-sm text-red-700">{(query.error as Error).message}</p>
          ) : (
            <OpsStatusCard
              data={query.data!}
              actionError={actionError}
              connecting={connectMut.isPending}
              disconnecting={disconnectMut.isPending}
              onConnect={() => connectMut.mutate()}
              onDisconnect={() => {
                if (window.confirm('Disconnect operations calendar?')) {
                  disconnectMut.mutate();
                }
              }}
            />
          )}
        </section>
      </div>
    </main>
  );
}

function OpsStatusCard(props: {
  data: GcalOpsStatus;
  actionError: string | null;
  connecting: boolean;
  disconnecting: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}): JSX.Element {
  if (!props.data.connected) {
    return (
      <div className="rounded-lg border border-gray-200 p-4">
        <p className="text-sm font-semibold">Not connected</p>
        <p className="mt-1 text-sm text-gray-500">
          Connect a Google account to mirror the team schedule.
        </p>
        <button
          type="button"
          disabled={props.connecting}
          onClick={props.onConnect}
          data-testid="ops-connect-button"
          className="mt-3 inline-flex min-h-[44px] items-center justify-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {props.connecting ? 'Opening Google…' : 'Connect operations calendar'}
        </button>
        {props.actionError ? (
          <p role="alert" className="mt-2 text-sm text-red-700">
            {props.actionError}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 p-4">
      <p className="text-sm font-semibold">
        {props.data.needsReauth ? 'Reconnect needed' : 'Connected'}
      </p>
      <p className="text-sm text-gray-500">
        {props.data.googleEmail
          ? `Signed in as ${props.data.googleEmail}.`
          : 'Signed in to Google.'}
      </p>
      <div className="flex flex-wrap gap-2">
        {props.data.needsReauth ? (
          <button
            type="button"
            disabled={props.connecting}
            onClick={props.onConnect}
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Reconnect
          </button>
        ) : null}
        <button
          type="button"
          disabled={props.disconnecting}
          onClick={props.onDisconnect}
          data-testid="ops-disconnect-button"
          className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-800 disabled:opacity-50"
        >
          {props.disconnecting ? 'Disconnecting…' : 'Disconnect'}
        </button>
      </div>
      {props.actionError ? (
        <p role="alert" className="text-sm text-red-700">
          {props.actionError}
        </p>
      ) : null}
    </div>
  );
}
