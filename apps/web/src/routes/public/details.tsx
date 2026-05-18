import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import type {
  PublicBookingSubmitResponse,
  PublicTenantService,
} from '@mygroomtime/shared';
import { submitPublicBooking } from '../../lib/public-booking-api';
import { usePublicTenant } from './use-public-tenant';
import { centsToDollarString } from './money';
import PublicNotFound from './not-found';
import { usePageTitle } from './page-title';
import {
  BookingForm,
  emptyBookingForm,
  type BookingFormValues,
  type ValidatedBookingPayload,
} from './booking-form';
import { PaymentElementContainer } from './payment-element';

export default function PublicBookingDetailsRoute(): JSX.Element {
  const { slug, serviceId } = useParams<{ slug: string; serviceId: string }>();
  const [search] = useSearchParams();
  const start = search.get('start');
  const tenantQuery = usePublicTenant(slug ?? '');

  if (tenantQuery.isLoading)
    return <p className="px-4 py-6 text-sm text-gray-500">Loading…</p>;
  if (tenantQuery.isError) {
    const status = (tenantQuery.error as Error & { status?: number }).status;
    if (status === 404) return <PublicNotFound />;
    return <p className="px-4 py-6 text-sm text-red-600">{(tenantQuery.error as Error).message}</p>;
  }
  const tenant = tenantQuery.data!;
  const service = tenant.services.find((s) => s.id === serviceId);
  if (!service || !start) return <PublicNotFound />;

  return (
    <DetailsView
      slug={slug ?? ''}
      businessName={tenant.businessName}
      service={service}
      start={start}
    />
  );
}

type Props = {
  slug: string;
  businessName: string;
  service: PublicTenantService;
  start: string;
};

function DetailsView({ slug, businessName, service, start }: Props): JSX.Element {
  usePageTitle(`Confirm booking — ${businessName}`);
  const navigate = useNavigate();
  const [formValues, setFormValues] = useState<BookingFormValues>(emptyBookingForm);
  const [submitResult, setSubmitResult] = useState<PublicBookingSubmitResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const submitMut = useMutation({
    mutationFn: async (payload: ValidatedBookingPayload) => {
      const res = await submitPublicBooking(slug, {
        serviceId: service.id,
        start,
        customer: payload.customer,
        pet: payload.pet,
      });
      if (!res.ok) {
        const e = new Error(res.error.message) as Error & { status?: number };
        e.status = res.error.status;
        throw e;
      }
      return res.data;
    },
    onSuccess: (data) => {
      setErrorMessage(null);
      setSubmitResult(data);
    },
    onError: (err) => {
      setErrorMessage((err as Error).message);
    },
  });

  const startDate = new Date(start);
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
    <main className="min-h-screen bg-white text-gray-900">
      <div className="mx-auto flex min-h-screen max-w-md flex-col">
        <header className="sticky top-0 z-10 border-b border-gray-100 bg-white px-4 pb-3 pt-5">
          <div className="flex items-center justify-between">
            <Link
              to={`/public/${slug}/book/${service.id}`}
              className="text-sm text-gray-600 underline"
            >
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
              <Row label="Deposit due">${centsToDollarString(service.depositCents)}</Row>
            </dl>
          </div>
        </section>

        <section className="flex-1 px-4 pb-12">
          {submitResult ? (
            <PaymentStep
              slug={slug}
              submitResult={submitResult}
              onSuccess={() =>
                navigate(`/public/${slug}/booked/${submitResult.bookingRequestId}`)
              }
            />
          ) : (
            <BookingForm
              values={formValues}
              onChange={setFormValues}
              onSubmit={(payload) => submitMut.mutate(payload)}
              submitting={submitMut.isPending}
              errorMessage={errorMessage}
            />
          )}
        </section>
      </div>
    </main>
  );
}

function PaymentStep({
  slug,
  submitResult,
  onSuccess,
}: {
  slug: string;
  submitResult: PublicBookingSubmitResponse;
  onSuccess: () => void;
}): JSX.Element {
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">
        Last step — pay the deposit to lock in your time.
      </p>
      <PaymentElementContainer
        slug={slug}
        bookingRequestId={submitResult.bookingRequestId}
        clientSecret={submitResult.clientSecret}
        twinMode={submitResult.twinMode}
        depositCents={submitResult.depositCents}
        onSuccess={onSuccess}
      />
    </div>
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
