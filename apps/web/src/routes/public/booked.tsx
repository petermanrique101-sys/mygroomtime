import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { PublicBookingStatusResponse } from '@mygroomtime/shared';
import { fetchPublicBookingStatus } from '../../lib/public-booking-api';
import { usePageTitle } from './page-title';
import PublicNotFound from './not-found';

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 30_000;

export default function PublicBookedRoute(): JSX.Element {
  const { slug, requestId } = useParams<{ slug: string; requestId: string }>();
  usePageTitle('Booking');

  const query = useQuery<PublicBookingStatusResponse, Error>({
    queryKey: ['public-booking-status', slug, requestId],
    queryFn: async () => {
      const res = await fetchPublicBookingStatus(slug ?? '', requestId ?? '');
      if (!res.ok) {
        const err = new Error(res.error.message) as Error & { status?: number };
        err.status = res.error.status;
        throw err;
      }
      return res.data;
    },
    refetchInterval: (q) => {
      if (!q.state.data) return POLL_INTERVAL_MS;
      const status = q.state.data.status;
      if (status === 'promoted' || status === 'succeeded') return false;
      if (status === 'failed' || status === 'expired') return false;
      const ageMs = Date.now() - q.state.dataUpdatedAt;
      if (ageMs > POLL_TIMEOUT_MS) return false;
      return POLL_INTERVAL_MS;
    },
    retry: (failureCount, err) => {
      const status = (err as Error & { status?: number }).status;
      if (status === 404) return false;
      return failureCount < 1;
    },
  });

  if (query.isLoading) {
    return <Shell>
      <p className="px-4 py-6 text-sm text-gray-500">Checking your booking…</p>
    </Shell>;
  }
  if (query.isError) {
    const status = (query.error as Error & { status?: number }).status;
    if (status === 404) return <PublicNotFound />;
    return <Shell>
      <p className="px-4 py-6 text-sm text-red-600">{(query.error as Error).message}</p>
    </Shell>;
  }

  const data = query.data!;
  return <BookedView slug={slug ?? ''} data={data} />;
}

function Shell({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <main className="min-h-screen bg-white text-gray-900">
      <div className="mx-auto flex min-h-screen max-w-md flex-col">{children}</div>
    </main>
  );
}

function BookedView({
  slug,
  data,
}: {
  slug: string;
  data: PublicBookingStatusResponse;
}): JSX.Element {
  const isBooked = data.status === 'promoted' || data.status === 'succeeded';
  const isFailed = data.status === 'failed' || data.status === 'expired';

  const startDate = new Date(data.start);
  const dateStr = startDate.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const timeStr = startDate.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <Shell>
      <header className="border-b border-gray-100 px-4 pb-4 pt-6">
        {isBooked ? (
          <>
            <p className="text-xs font-medium uppercase tracking-wide text-green-700">
              Booked!
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">You're all set</h1>
          </>
        ) : isFailed ? (
          <>
            <p className="text-xs font-medium uppercase tracking-wide text-red-700">
              {data.status === 'failed' ? 'Payment failed' : 'Booking expired'}
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              {data.status === 'failed'
                ? "We couldn't take the deposit"
                : "This booking session timed out"}
            </h1>
          </>
        ) : (
          <>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-700">
              Finalizing
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">
              Payment confirmed — we're still setting up. Refresh in a moment.
            </h1>
          </>
        )}
      </header>

      <section className="flex-1 px-4 py-4">
        <div className="rounded-lg border border-gray-200 p-4">
          <h2 className="text-base font-semibold">{data.service.name}</h2>
          <dl className="mt-3 grid grid-cols-1 gap-2 text-sm">
            <Row label="Date">{dateStr}</Row>
            <Row label="Time">{timeStr}</Row>
            <Row label="Address">{data.addressLine}</Row>
          </dl>
        </div>

        {isBooked ? (
          <div className="mt-4 rounded-lg border border-gray-200 p-4 text-sm text-gray-600">
            <p>
              You'll get a confirmation by email
              {data.appointmentId ? null : ' once the appointment finishes syncing'}.
            </p>
            <p className="mt-2">
              Need to change anything?{' '}
              <Link
                to={`/public/${slug}/manage/${data.appointmentId ?? ''}`}
                className="text-blue-700 underline"
              >
                Manage booking
              </Link>
            </p>
          </div>
        ) : null}
      </section>
    </Shell>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="font-medium text-right max-w-[60%]">{children}</dd>
    </div>
  );
}
