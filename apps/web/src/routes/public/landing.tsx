import { Link, useParams } from 'react-router-dom';
import type { PublicTenantResponse, PublicTenantService } from '@mygroomtime/shared';
import { usePublicTenant } from './use-public-tenant';
import { centsToDollarString, formatDuration } from './money';
import PublicNotFound from './not-found';
import { usePageTitle } from './page-title';

export default function PublicLandingRoute(): JSX.Element {
  const { slug } = useParams<{ slug: string }>();
  const query = usePublicTenant(slug ?? '');

  if (query.isLoading) {
    return <Shell title="Loading…">
      <p className="px-4 py-6 text-sm text-gray-500">Loading…</p>
    </Shell>;
  }
  if (query.isError) {
    const status = (query.error as Error & { status?: number }).status;
    if (status === 404) return <PublicNotFound />;
    return <Shell title="Error">
      <p className="px-4 py-6 text-sm text-red-600">{(query.error as Error).message}</p>
    </Shell>;
  }
  const data = query.data!;
  return <LandingView slug={slug ?? ''} data={data} />;
}

function Shell({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  usePageTitle(title);
  return (
    <main className="min-h-screen bg-white text-gray-900">
      <div className="mx-auto flex min-h-screen max-w-md flex-col">{children}</div>
    </main>
  );
}

type LandingViewProps = { slug: string; data: PublicTenantResponse };

function LandingView({ slug, data }: LandingViewProps): JSX.Element {
  usePageTitle(`Book — ${data.businessName}`);
  const readOnly = data.readOnly;
  return (
    <main className="min-h-screen bg-white text-gray-900">
      <div className="mx-auto flex min-h-screen max-w-md flex-col">
        <Header businessName={data.businessName} phone={data.phone} />
        {readOnly ? <ReadOnlyBanner phone={data.phone} /> : null}
        <section className="flex-1 px-4 pb-12 pt-2">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-gray-500">
            Services
          </h2>
          {data.services.length === 0 ? (
            <p className="text-sm text-gray-500">No services available right now.</p>
          ) : (
            <ul className="space-y-3">
              {data.services.map((s) => (
                <li key={s.id}>
                  <ServiceCard slug={slug} service={s} readOnly={readOnly} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

function Header({
  businessName,
  phone,
}: {
  businessName: string;
  phone: string | null;
}): JSX.Element {
  return (
    <header className="border-b border-gray-100 px-4 pb-4 pt-6">
      <h1 className="text-2xl font-semibold tracking-tight">{businessName}</h1>
      {phone ? (
        <a
          href={`tel:${phone}`}
          className="mt-1 inline-block text-sm font-medium text-blue-700 underline"
        >
          {phone}
        </a>
      ) : null}
    </header>
  );
}

function ReadOnlyBanner({ phone }: { phone: string | null }): JSX.Element {
  return (
    <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <p className="font-medium">Online booking is paused</p>
      <p className="mt-0.5">
        Please contact this groomer directly{phone ? <>. Phone: <span className="font-mono">{phone}</span></> : '.'}
      </p>
    </div>
  );
}

type ServiceCardProps = {
  slug: string;
  service: PublicTenantService;
  readOnly: boolean;
};

function ServiceCard({ slug, service, readOnly }: ServiceCardProps): JSX.Element {
  const priceStr = `$${centsToDollarString(service.basePriceCents)}`;
  const depositStr =
    service.depositCents > 0 ? `$${centsToDollarString(service.depositCents)} deposit` : null;

  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-1 inline-block h-4 w-4 shrink-0 rounded-full border border-gray-200"
          style={{ backgroundColor: service.color }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="truncate text-base font-semibold">{service.name}</h3>
            <span className="shrink-0 text-base font-semibold">{priceStr}</span>
          </div>
          <p className="mt-0.5 text-xs text-gray-500">
            {formatDuration(service.durationMin)}
            {depositStr ? <> · {depositStr}</> : null}
          </p>
        </div>
      </div>
      <div className="mt-3">
        {readOnly ? (
          <button
            type="button"
            disabled
            className="block min-h-[44px] w-full cursor-not-allowed rounded-lg bg-gray-200 px-4 text-base font-semibold text-gray-500"
          >
            Bookings paused
          </button>
        ) : (
          <Link
            to={`/public/${slug}/book/${service.id}`}
            className="block min-h-[44px] rounded-lg bg-gray-900 px-4 text-center text-base font-semibold leading-[44px] text-white"
          >
            Book
          </Link>
        )}
      </div>
    </div>
  );
}
