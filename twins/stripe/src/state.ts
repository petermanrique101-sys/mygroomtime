export type TwinCustomer = {
  id: string;
  email: string;
  name: string | null;
  created: number;
  metadata: Record<string, string>;
};

export type TwinSubscriptionStatus = 'active' | 'past_due' | 'canceled' | 'unpaid' | 'incomplete';

export type TwinSubscription = {
  id: string;
  customer: string;
  priceId: string;
  status: TwinSubscriptionStatus;
  currentPeriodStart: number;
  currentPeriodEnd: number;
  cancelAtPeriodEnd: boolean;
  metadata: Record<string, string>;
};

export type TwinCheckoutSession = {
  id: string;
  customer: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
  status: 'open' | 'complete' | 'expired';
  subscriptionId: string | null;
  created: number;
};

export type TwinAccount = {
  id: string;
  email: string | null;
  country: string;
  capabilities: { card_payments: 'active'; transfers: 'active' };
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  metadata: Record<string, string>;
};

export type TwinAccountLink = { url: string; expires_at: number };

export type TwinPaymentIntentStatus =
  | 'requires_confirmation'
  | 'requires_action'
  | 'succeeded'
  | 'canceled'
  | 'requires_payment_method';

export type TwinPaymentIntent = {
  id: string;
  amount: number;
  currency: string;
  connectedAccountId: string;
  status: TwinPaymentIntentStatus;
  clientSecret: string;
  lastPaymentError: { code: string; message: string } | null;
  metadata: Record<string, string>;
};

export type TwinRefund = {
  id: string;
  paymentIntentId: string;
  amount: number;
  created: number;
};

export type TwinEvent = {
  id: string;
  type: string;
  created: number;
  data: { object: Record<string, unknown> };
};

export class IdAllocator {
  private counters = new Map<string, number>();
  next(prefix: string): string {
    const n = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, n);
    return `${prefix}_TWIN_${n}`;
  }
}

export class TwinState {
  readonly customers = new Map<string, TwinCustomer>();
  readonly subscriptions = new Map<string, TwinSubscription>();
  readonly checkoutSessions = new Map<string, TwinCheckoutSession>();
  readonly accounts = new Map<string, TwinAccount>();
  readonly paymentIntents = new Map<string, TwinPaymentIntent>();
  readonly refunds = new Map<string, TwinRefund>();
  readonly events = new Map<string, TwinEvent>();
  readonly idempotencyKeys = new Map<string, string>();
  readonly ids = new IdAllocator();

  reset(): void {
    this.customers.clear();
    this.subscriptions.clear();
    this.checkoutSessions.clear();
    this.accounts.clear();
    this.paymentIntents.clear();
    this.refunds.clear();
    this.events.clear();
    this.idempotencyKeys.clear();
  }
}
