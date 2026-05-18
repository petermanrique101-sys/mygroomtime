import { useEffect, useRef, useState } from 'react';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { twinConfirmPublicBooking } from '../../lib/public-booking-api';

const STRIPE_PUBLISHABLE_KEY = (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ?? '') as string;

function isTwinKey(key: string): boolean {
  return key.startsWith('pk_twin_') || key === '';
}

let stripePromise: Promise<Stripe | null> | null = null;
function getStripeInstance(): Promise<Stripe | null> {
  if (!stripePromise) {
    stripePromise = loadStripe(STRIPE_PUBLISHABLE_KEY);
  }
  return stripePromise;
}

export type PaymentElementContainerProps = {
  slug: string;
  bookingRequestId: string;
  clientSecret: string;
  twinMode: boolean;
  depositCents: number;
  onSuccess: () => void;
};

export function PaymentElementContainer(props: PaymentElementContainerProps): JSX.Element {
  if (props.twinMode || isTwinKey(STRIPE_PUBLISHABLE_KEY)) {
    return <TwinPaymentStub {...props} />;
  }
  return <LivePaymentFlow {...props} />;
}

function dollars(cents: number): string {
  return (cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function TwinPaymentStub({
  slug,
  bookingRequestId,
  depositCents,
  onSuccess,
}: PaymentElementContainerProps): JSX.Element {
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handlePay(): Promise<void> {
    setSubmitting(true);
    setErr(null);
    const res = await twinConfirmPublicBooking(slug, bookingRequestId);
    if (!res.ok) {
      setErr(res.error.message);
      setSubmitting(false);
      return;
    }
    onSuccess();
  }

  return (
    <div
      data-testid="twin-payment-stub"
      className="space-y-3 rounded-lg border border-gray-200 p-4"
    >
      <div className="rounded-md bg-gray-50 p-3 text-xs text-gray-500">
        Card payment (twin mode) — auto-completes with test card.
      </div>
      <button
        type="button"
        onClick={handlePay}
        disabled={submitting}
        className="block min-h-[44px] w-full rounded-lg bg-gray-900 px-4 text-base font-semibold text-white disabled:bg-gray-400"
      >
        {submitting ? 'Charging…' : `Pay $${dollars(depositCents)} deposit`}
      </button>
      {err ? (
        <p role="alert" className="text-sm text-red-700">
          {err}
        </p>
      ) : null}
    </div>
  );
}

function LivePaymentFlow(props: PaymentElementContainerProps): JSX.Element {
  const stripeRef = useRef<Promise<Stripe | null> | null>(null);
  if (!stripeRef.current) stripeRef.current = getStripeInstance();

  return (
    <Elements
      options={{
        clientSecret: props.clientSecret,
        appearance: { theme: 'stripe' },
      }}
      stripe={stripeRef.current}
    >
      <LivePaymentForm {...props} />
    </Elements>
  );
}

function LivePaymentForm({
  depositCents,
  onSuccess,
  slug,
  bookingRequestId,
}: PaymentElementContainerProps): JSX.Element {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // why: when Stripe.js redirects back after 3DS, the URL gains payment_intent_client_secret
    // and we should treat that as success without re-charging. For chunk 12 we let the booked
    // page handle that path; this effect just clears any lingering submit state.
    setSubmitting(false);
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setErr(null);
    const result = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/public/${slug}/booked/${bookingRequestId}`,
      },
      redirect: 'if_required',
    });
    if (result.error) {
      setErr(result.error.message ?? 'Payment failed. Please try again.');
      setSubmitting(false);
      return;
    }
    onSuccess();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-gray-200 p-4">
      <PaymentElement options={{ layout: 'tabs' }} />
      <button
        type="submit"
        disabled={submitting || !stripe || !elements}
        className="block min-h-[44px] w-full rounded-lg bg-gray-900 px-4 text-base font-semibold text-white disabled:bg-gray-400"
      >
        {submitting ? 'Charging…' : `Pay $${dollars(depositCents)} deposit`}
      </button>
      {err ? (
        <p role="alert" className="text-sm text-red-700">
          {err}
        </p>
      ) : null}
    </form>
  );
}
