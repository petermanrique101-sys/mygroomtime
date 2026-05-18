import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthOptional } from '../../../lib/auth-context';
import {
  disconnectGcal,
  fetchGcalStatus,
  startGcalConnect,
  type GcalStatus,
} from '../../../lib/gcal-api';

const QUERY_KEY = ['settings-gcal'] as const;

const STATUS_BANNERS: Record<string, { tone: 'success' | 'warn'; text: string }> = {
  connected: { tone: 'success', text: 'Google Calendar connected. New appointments will sync.' },
  denied: { tone: 'warn', text: 'You declined the Google permission. Try again to connect.' },
  invalid_state: { tone: 'warn', text: 'Connect session expired. Click Connect to retry.' },
  invalid_request: { tone: 'warn', text: 'Something went wrong with the redirect. Try again.' },
  session_changed: {
    tone: 'warn',
    text: 'Your session changed during connect. Sign in again and retry.',
  },
  connect_failed: { tone: 'warn', text: "We couldn't reach Google. Try again in a minute." },
};

export default function SettingsGoogleCalendarRoute(): JSX.Element {
  const auth = useAuthOptional();
  const plan = auth?.session?.tenant.plan ?? 'starter';
  const isBusiness = plan === 'business';
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const statusParam = searchParams.get('status');
  const [actionError, setActionError] = useState<string | null>(null);

  const query = useQuery<GcalStatus, Error>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const res = await fetchGcalStatus();
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
  });

  const connectMut = useMutation({
    mutationFn: async () => {
      const res = await startGcalConnect();
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
      const res = await disconnectGcal();
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    onSuccess: () => {
      setActionError(null);
      qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (err) => setActionError((err as Error).message),
  });

  const banner = statusParam ? STATUS_BANNERS[statusParam] : null;

  return (
    <main className="min-h-screen bg-white text-gray-900">
      <div className="mx-auto flex min-h-screen max-w-md flex-col">
        <header className="sticky top-0 z-10 border-b border-gray-100 bg-white px-4 pb-3 pt-5">
          <div className="flex items-center justify-between">
            <Link to="/settings" className="text-sm text-gray-600 underline">
              ← Settings
            </Link>
            <h1 className="text-base font-semibold tracking-tight">Google Calendar</h1>
            <span className="w-12" />
          </div>
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

          {query.isLoading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : query.isError ? (
            <p className="text-sm text-red-700">{(query.error as Error).message}</p>
          ) : (
            <StatusCard
              data={query.data!}
              actionError={actionError}
              connecting={connectMut.isPending}
              disconnecting={disconnectMut.isPending}
              onConnect={() => connectMut.mutate()}
              onDisconnect={() => {
                if (window.confirm('Disconnect Google Calendar? Existing events stay on Google.')) {
                  disconnectMut.mutate();
                }
              }}
            />
          )}

          {isBusiness ? (
            <Link
              to="/settings/integrations/google-calendar/operations"
              data-testid="ops-calendar-link"
              className="block rounded-lg border border-gray-200 p-4 text-sm hover:bg-gray-50"
            >
              <p className="text-base font-semibold">Operations calendar</p>
              <p className="mt-1 text-gray-600">
                Every appointment across your team will mirror to this calendar. Useful for
                seeing your full schedule in one place.
              </p>
            </Link>
          ) : null}

          <div className="space-y-3 rounded-lg border border-gray-200 p-4 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              What gets synced
            </p>
            <ul className="space-y-2 text-gray-800">
              <li>
                New appointments you create in MyGroomTime show up on your Google Calendar.
              </li>
              <li>
                Editing the time on the Google side (the event you got pushed) updates the
                appointment back in MyGroomTime.
              </li>
              <li>
                Brand-new events you create directly in Google Calendar are{' '}
                <span className="font-medium">not</span> pulled in. Create those in MyGroomTime first.
              </li>
            </ul>
          </div>
        </section>
      </div>
    </main>
  );
}

type StatusCardProps = {
  data: GcalStatus;
  actionError: string | null;
  connecting: boolean;
  disconnecting: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
};

function StatusCard({
  data,
  actionError,
  connecting,
  disconnecting,
  onConnect,
  onDisconnect,
}: StatusCardProps): JSX.Element {
  if (data.tierGated) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-medium">Upgrade to Pro to connect Google Calendar.</p>
        <p className="mt-1">
          Two-way calendar sync is part of the Pro and Business plans. Upgrade and we'll
          push appointments straight to your Google Calendar.
        </p>
        <Link
          to="/settings/billing"
          className="mt-3 inline-block rounded-lg bg-gray-900 px-3 py-2 text-xs font-semibold text-white"
        >
          See plans
        </Link>
      </div>
    );
  }

  if (!data.connected) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-gray-200 p-4">
          <p className="text-sm font-semibold">Not connected</p>
          <p className="mt-1 text-sm text-gray-500">
            Connect your Google account to start pushing appointments to your calendar.
          </p>
          <button
            type="button"
            disabled={connecting}
            onClick={onConnect}
            className="mt-3 inline-flex min-h-[44px] items-center justify-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {connecting ? 'Opening Google…' : 'Connect Google Calendar'}
          </button>
        </div>
        {actionError ? (
          <p role="alert" className="text-sm text-red-700">
            {actionError}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-gray-200 p-4">
        <p className="text-sm font-semibold">
          {data.needsReauth ? 'Reconnect needed' : 'Connected'}
        </p>
        <p className="mt-1 text-sm text-gray-500">
          {data.googleEmail ? `Signed in as ${data.googleEmail}.` : 'Signed in to Google.'}{' '}
          {data.needsReauth
            ? 'We lost the connection. Click Reconnect to restore syncing.'
            : 'New appointments push within a few seconds.'}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {data.needsReauth ? (
            <button
              type="button"
              disabled={connecting}
              onClick={onConnect}
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Reconnect
            </button>
          ) : null}
          <button
            type="button"
            disabled={disconnecting}
            onClick={onDisconnect}
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-800 disabled:opacity-50"
          >
            {disconnecting ? 'Disconnecting…' : 'Disconnect'}
          </button>
        </div>
        {data.watchExpiresAt ? (
          <p className="mt-3 text-xs text-gray-400">
            Watch channel renews automatically. Current channel expires{' '}
            {new Date(data.watchExpiresAt).toLocaleString()}.
          </p>
        ) : null}
      </div>
      {actionError ? (
        <p role="alert" className="text-sm text-red-700">
          {actionError}
        </p>
      ) : null}
    </div>
  );
}
