import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type {
  PublicAvailabilityResponse,
  RescheduleVerifyResponse,
} from '@mygroomtime/shared';
import {
  commitReschedule,
  verifyRescheduleToken,
} from '../../lib/public-reschedule-api';
import { fetchPublicAvailability } from '../../lib/public-booking-api';
import { DatePicker } from './date-picker';
import { usePageTitle } from './page-title';

type CommitState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success'; newStart: string }
  | { kind: 'already_used'; linkedStart: string | null }
  | { kind: 'error'; message: string };

function formatLongDateTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${date} at ${time}`;
}

export default function PublicRescheduleRoute(): JSX.Element {
  const { token } = useParams<{ token: string }>();
  usePageTitle('Reschedule');

  const verify = useQuery<RescheduleVerifyResponse, Error>({
    queryKey: ['reschedule-verify', token],
    enabled: !!token,
    queryFn: async () => {
      const res = await verifyRescheduleToken({ token: token ?? '' });
      if (!res.ok) {
        const err = new Error(res.error.message) as Error & { kind?: string };
        err.kind = res.error.error;
        throw err;
      }
      return res.data;
    },
    retry: false,
  });

  if (verify.isLoading) {
    return <Shell><p className="px-4 py-6 text-sm text-gray-500">Loading…</p></Shell>;
  }
  if (verify.isError) {
    const err = verify.error as Error & { kind?: string };
    return (
      <Shell>
        <div className="mx-4 mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">
            {err.kind === 'expired' ? 'This link has expired' : 'This link is not valid'}
          </p>
          <p className="mt-1">{err.message || 'Please contact the groomer directly.'}</p>
        </div>
      </Shell>
    );
  }

  return <RescheduleView data={verify.data!} token={token ?? ''} />;
}

function RescheduleView({
  data,
  token,
}: {
  data: RescheduleVerifyResponse;
  token: string;
}): JSX.Element {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [commit, setCommit] = useState<CommitState>({ kind: 'idle' });

  const availability = useQuery<PublicAvailabilityResponse, Error>({
    queryKey: ['reschedule-availability', data.tenantSlug, data.service.id, selectedDate],
    enabled: !!selectedDate,
    queryFn: async () => {
      const res = await fetchPublicAvailability(data.tenantSlug, {
        serviceId: data.service.id,
        date: selectedDate ?? '',
      });
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    staleTime: 30_000,
  });

  const slots = useMemo(
    () => availability.data?.slots ?? [],
    [availability.data],
  );

  async function pickSlot(startIso: string): Promise<void> {
    setCommit({ kind: 'submitting' });
    const res = await commitReschedule({ token, newStart: startIso });
    if (res.ok) {
      setCommit({ kind: 'success', newStart: res.data.newAppointment.start });
      return;
    }
    if (res.error.error === 'already_used') {
      const bodyAny = res.error as unknown as { linkedAppointmentStart?: string | null };
      setCommit({
        kind: 'already_used',
        linkedStart: bodyAny.linkedAppointmentStart ?? null,
      });
      return;
    }
    setCommit({ kind: 'error', message: res.error.message });
  }

  if (commit.kind === 'success') {
    return (
      <Shell>
        <ConfirmationCard
          title="You're rescheduled."
          message={`Your new appointment is on ${formatLongDateTime(commit.newStart)}.`}
        />
      </Shell>
    );
  }

  if (commit.kind === 'already_used') {
    return (
      <Shell>
        <ConfirmationCard
          title="This link has already been used"
          message={
            commit.linkedStart
              ? `Your appointment is on ${formatLongDateTime(commit.linkedStart)}.`
              : 'Please contact the groomer directly for changes.'
          }
        />
      </Shell>
    );
  }

  return (
    <Shell>
      <header className="border-b border-gray-100 px-4 pb-4 pt-6">
        <h1 className="text-2xl font-semibold tracking-tight">{data.tenantName}</h1>
        <p className="mt-1 text-sm text-gray-600">
          Reschedule {data.service.name} (originally{' '}
          {formatLongDateTime(data.source.start)})
        </p>
      </header>
      <section className="px-4 py-4">
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-gray-500">
          Pick a new date
        </h2>
        <DatePicker selected={selectedDate} onSelect={setSelectedDate} />
      </section>
      {selectedDate ? (
        <SlotPicker
          slots={slots}
          loading={availability.isLoading}
          errorMessage={
            availability.isError ? (availability.error as Error).message : null
          }
          submitting={commit.kind === 'submitting'}
          onPick={pickSlot}
        />
      ) : (
        <p className="px-4 pb-12 pt-2 text-sm text-gray-500">
          Pick a date to see times.
        </p>
      )}
      {commit.kind === 'error' ? (
        <p role="alert" className="mx-4 mb-8 text-sm text-red-700">
          {commit.message}
        </p>
      ) : null}
    </Shell>
  );
}

function SlotPicker(props: {
  slots: { start: string; durationMin: number }[];
  loading: boolean;
  errorMessage: string | null;
  submitting: boolean;
  onPick: (start: string) => void;
}): JSX.Element {
  const { slots, loading, errorMessage, submitting, onPick } = props;
  return (
    <section className="flex-1 px-4 pb-12 pt-2">
      <h3 className="mb-2 text-sm font-medium uppercase tracking-wide text-gray-500">
        Available times
      </h3>
      {loading ? (
        <p className="text-sm text-gray-500">Loading times…</p>
      ) : errorMessage ? (
        <p className="text-sm text-red-600">{errorMessage}</p>
      ) : slots.length === 0 ? (
        <p className="text-sm text-gray-500">
          No times available on this day. Try another date.
        </p>
      ) : (
        <ul className="grid grid-cols-3 gap-2">
          {slots.map((slot) => {
            const t = new Date(slot.start);
            const label = t.toLocaleTimeString(undefined, {
              hour: 'numeric',
              minute: '2-digit',
            });
            return (
              <li key={slot.start}>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => onPick(slot.start)}
                  className="block min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400"
                >
                  {label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ConfirmationCard({
  title,
  message,
}: {
  title: string;
  message: string;
}): JSX.Element {
  return (
    <section className="flex-1 px-4 py-6">
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        <p className="text-base font-semibold">{title}</p>
        <p className="mt-1">{message}</p>
      </div>
    </section>
  );
}

function Shell({ children }: { children: React.ReactNode }): JSX.Element {
  // why: mobile-first, light-mode, ≥44px tap targets — same baseline as the existing
  // public booking page so the customer perceives one site.
  useEffect(() => {
    const tag = document.getElementById('robots-tag');
    if (tag instanceof HTMLMetaElement) tag.content = 'noindex';
  }, []);
  return (
    <main className="min-h-screen bg-white text-gray-900">
      <div className="mx-auto flex min-h-screen max-w-md flex-col">{children}</div>
    </main>
  );
}
