import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { PublicAvailabilityResponse } from '@mygroomtime/shared';
import { fetchPublicAvailability } from '../../lib/public-booking-api';
import { usePublicTenant } from './use-public-tenant';
import { DatePicker } from './date-picker';
import { centsToDollarString, formatDuration } from './money';
import PublicNotFound from './not-found';
import { usePageTitle } from './page-title';

export default function PublicBookRoute(): JSX.Element {
  const { slug, serviceId } = useParams<{ slug: string; serviceId: string }>();
  const tenantQuery = usePublicTenant(slug ?? '');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  if (tenantQuery.isLoading) return <p className="px-4 py-6 text-sm text-gray-500">Loading…</p>;
  if (tenantQuery.isError) {
    const status = (tenantQuery.error as Error & { status?: number }).status;
    if (status === 404) return <PublicNotFound />;
    return <p className="px-4 py-6 text-sm text-red-600">{(tenantQuery.error as Error).message}</p>;
  }
  const tenant = tenantQuery.data!;
  const service = tenant.services.find((s) => s.id === serviceId);
  if (!service) return <PublicNotFound />;

  return (
    <BookView
      slug={slug ?? ''}
      businessName={tenant.businessName}
      service={service}
      readOnly={tenant.readOnly}
      selectedDate={selectedDate}
      onSelectDate={setSelectedDate}
    />
  );
}

type BookViewProps = {
  slug: string;
  businessName: string;
  service: { id: string; name: string; durationMin: number; basePriceCents: number; depositCents: number; color: string };
  readOnly: boolean;
  selectedDate: string | null;
  onSelectDate: (iso: string) => void;
};

function BookView({
  slug,
  businessName,
  service,
  readOnly,
  selectedDate,
  onSelectDate,
}: BookViewProps): JSX.Element {
  usePageTitle(`Book ${service.name} — ${businessName}`);
  return (
    <main className="min-h-screen bg-white text-gray-900">
      <div className="mx-auto flex min-h-screen max-w-md flex-col">
        <header className="sticky top-0 z-10 border-b border-gray-100 bg-white px-4 pb-3 pt-5">
          <div className="flex items-center justify-between">
            <Link to={`/public/${slug}`} className="text-sm text-gray-600 underline">
              ← Back
            </Link>
            <h1 className="text-base font-semibold tracking-tight">Book</h1>
            <span className="w-12" />
          </div>
        </header>

        <section className="px-4 py-4">
          <div className="rounded-lg border border-gray-200 p-4">
            <div className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className="mt-1 inline-block h-4 w-4 shrink-0 rounded-full border border-gray-200"
                style={{ backgroundColor: service.color }}
              />
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-lg font-semibold">{service.name}</h2>
                <p className="mt-0.5 text-xs text-gray-500">
                  {formatDuration(service.durationMin)} · ${centsToDollarString(service.basePriceCents)}
                  {service.depositCents > 0 ? <> · ${centsToDollarString(service.depositCents)} deposit</> : null}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="px-4 pb-4">
          <h3 className="mb-2 text-sm font-medium uppercase tracking-wide text-gray-500">
            Pick a date
          </h3>
          <DatePicker selected={selectedDate} onSelect={onSelectDate} />
        </section>

        {selectedDate ? (
          <SlotPicker
            slug={slug}
            serviceId={service.id}
            date={selectedDate}
            readOnly={readOnly}
          />
        ) : (
          <div className="px-4 pb-12 pt-2 text-sm text-gray-500">Pick a date to see times.</div>
        )}
      </div>
    </main>
  );
}

type SlotPickerProps = {
  slug: string;
  serviceId: string;
  date: string;
  readOnly: boolean;
};

function SlotPicker({ slug, serviceId, date, readOnly }: SlotPickerProps): JSX.Element {
  const navigate = useNavigate();
  const query = useQuery<PublicAvailabilityResponse, Error>({
    queryKey: ['public-availability', slug, serviceId, date],
    queryFn: async () => {
      const res = await fetchPublicAvailability(slug, { serviceId, date });
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
    staleTime: 30_000,
  });

  const slots = useMemo(() => query.data?.slots ?? [], [query.data]);

  return (
    <section className="flex-1 px-4 pb-12 pt-2">
      <h3 className="mb-2 text-sm font-medium uppercase tracking-wide text-gray-500">
        Available times
      </h3>
      {query.isLoading ? (
        <p className="text-sm text-gray-500">Loading times…</p>
      ) : query.isError ? (
        <p className="text-sm text-red-600">{(query.error as Error).message}</p>
      ) : slots.length === 0 ? (
        <p className="text-sm text-gray-500">No times available on this day. Try another date.</p>
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
                  disabled={readOnly}
                  onClick={() =>
                    navigate(
                      `/public/${slug}/book/${serviceId}/details?start=${encodeURIComponent(slot.start)}`,
                    )
                  }
                  className={
                    'block min-h-[44px] w-full rounded-lg border px-2 text-sm font-semibold ' +
                    (readOnly
                      ? 'cursor-not-allowed border-gray-100 bg-gray-50 text-gray-400'
                      : 'border-gray-300 bg-white text-gray-900 hover:bg-gray-50')
                  }
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
