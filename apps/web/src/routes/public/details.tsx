import { Link, useParams, useSearchParams } from 'react-router-dom';
import { usePublicTenant } from './use-public-tenant';
import { centsToDollarString } from './money';
import PublicNotFound from './not-found';
import { usePageTitle } from './page-title';

export default function PublicBookingDetailsRoute(): JSX.Element {
  const { slug, serviceId } = useParams<{ slug: string; serviceId: string }>();
  const [search] = useSearchParams();
  const start = search.get('start');
  const tenantQuery = usePublicTenant(slug ?? '');

  if (tenantQuery.isLoading) return <p className="px-4 py-6 text-sm text-gray-500">Loading…</p>;
  if (tenantQuery.isError) {
    const status = (tenantQuery.error as Error & { status?: number }).status;
    if (status === 404) return <PublicNotFound />;
    return <p className="px-4 py-6 text-sm text-red-600">{(tenantQuery.error as Error).message}</p>;
  }
  const tenant = tenantQuery.data!;
  const service = tenant.services.find((s) => s.id === serviceId);
  if (!service || !start) return <PublicNotFound />;

  return <DetailsView slug={slug ?? ''} businessName={tenant.businessName} service={service} start={start} />;
}

type Props = {
  slug: string;
  businessName: string;
  service: { id: string; name: string; basePriceCents: number; depositCents: number };
  start: string;
};

function DetailsView({ slug, businessName, service, start }: Props): JSX.Element {
  usePageTitle(`Confirm booking — ${businessName}`);
  const startDate = new Date(start);
  const dateStr = startDate.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const timeStr = startDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return (
    <main className="min-h-screen bg-white text-gray-900">
      <div className="mx-auto flex min-h-screen max-w-md flex-col">
        <header className="sticky top-0 z-10 border-b border-gray-100 bg-white px-4 pb-3 pt-5">
          <div className="flex items-center justify-between">
            <Link to={`/public/${slug}/book/${service.id}`} className="text-sm text-gray-600 underline">
              ← Back
            </Link>
            <h1 className="text-base font-semibold tracking-tight">Confirm</h1>
            <span className="w-12" />
          </div>
        </header>

        <section className="px-4 py-4">
          <div className="rounded-lg border border-gray-200 p-4">
            <h2 className="text-base font-semibold">{service.name}</h2>
            <dl className="mt-3 grid grid-cols-1 gap-2 text-sm">
              <Row label="Date">{dateStr}</Row>
              <Row label="Time">{timeStr}</Row>
              <Row label="Price">${centsToDollarString(service.basePriceCents)}</Row>
              {service.depositCents > 0 ? (
                <Row label="Deposit due">${centsToDollarString(service.depositCents)}</Row>
              ) : null}
            </dl>
          </div>
        </section>

        <section className="flex-1 px-4 pb-12">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">Submission UI is being built</p>
            <p className="mt-1">
              Booking submission lands in the next release. To hold this time today, call the
              groomer.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}
