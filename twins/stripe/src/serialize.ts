import type {
  TwinCheckoutSession,
  TwinCustomer,
  TwinPaymentIntent,
  TwinSubscription,
  TwinAccount,
  TwinRefund,
} from './state.js';

export function serializeCustomer(c: TwinCustomer): Record<string, unknown> {
  return {
    id: c.id,
    object: 'customer',
    email: c.email,
    name: c.name,
    created: c.created,
    metadata: c.metadata,
  };
}

export function serializeSubscription(s: TwinSubscription): Record<string, unknown> {
  return {
    id: s.id,
    object: 'subscription',
    customer: s.customer,
    status: s.status,
    current_period_start: s.currentPeriodStart,
    current_period_end: s.currentPeriodEnd,
    cancel_at_period_end: s.cancelAtPeriodEnd,
    items: {
      object: 'list',
      data: [{ id: `si_TWIN_${s.id}`, object: 'subscription_item', price: { id: s.priceId } }],
    },
    metadata: s.metadata,
  };
}

export function serializeCheckoutSession(
  cs: TwinCheckoutSession,
  hostedUrl: string,
): Record<string, unknown> {
  return {
    id: cs.id,
    object: 'checkout.session',
    customer: cs.customer,
    mode: 'subscription',
    status: cs.status,
    payment_status: cs.status === 'complete' ? 'paid' : 'unpaid',
    subscription: cs.subscriptionId,
    success_url: cs.successUrl,
    cancel_url: cs.cancelUrl,
    url: hostedUrl,
    metadata: cs.metadata,
  };
}

export function serializeAccount(a: TwinAccount): Record<string, unknown> {
  return {
    id: a.id,
    object: 'account',
    email: a.email,
    country: a.country,
    capabilities: a.capabilities,
    charges_enabled: a.chargesEnabled,
    payouts_enabled: a.payoutsEnabled,
    details_submitted: a.detailsSubmitted,
    metadata: a.metadata,
  };
}

export function serializePaymentIntent(pi: TwinPaymentIntent): Record<string, unknown> {
  return {
    id: pi.id,
    object: 'payment_intent',
    amount: pi.amount,
    currency: pi.currency,
    status: pi.status,
    client_secret: pi.clientSecret,
    last_payment_error: pi.lastPaymentError,
    on_behalf_of: pi.connectedAccountId,
    metadata: pi.metadata,
  };
}

export function serializeRefund(r: TwinRefund): Record<string, unknown> {
  return {
    id: r.id,
    object: 'refund',
    payment_intent: r.paymentIntentId,
    amount: r.amount,
    created: r.created,
  };
}
