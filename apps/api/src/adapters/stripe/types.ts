export type StripeMode = 'live' | 'twin';

export type StripeAdapterEnv = {
  mode: StripeMode;
  secretKey: string;
  webhookSecret: string;
  twinUrl: string;
  apiVersion?: string;
};

export type CreateCustomerInput = { email: string; name?: string; metadata?: Record<string, string> };
export type CreateCustomerOutput = { id: string };

export type CreateCheckoutSessionInput = {
  customerId: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
};
export type CreateCheckoutSessionOutput = { url: string; sessionId: string };

export type UpdateSubscriptionInput = {
  subscriptionId: string;
  newPriceId: string;
  prorate: boolean;
};
export type UpdateSubscriptionOutput = { id: string; status: string };

export type CancelSubscriptionInput = { subscriptionId: string };
export type CancelSubscriptionOutput = { id: string };

export type CreateConnectAccountInput = { email: string; country: string };
export type CreateConnectAccountOutput = { id: string };

export type CreateConnectAccountLinkInput = {
  accountId: string;
  refreshUrl: string;
  returnUrl: string;
};
export type CreateConnectAccountLinkOutput = { url: string };

export type GetConnectAccountInput = { accountId: string };
export type GetConnectAccountOutput = {
  id: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
};

export type CreatePaymentIntentInput = {
  amountCents: number;
  currency: string;
  connectedAccountId: string;
  metadata?: Record<string, string>;
  idempotencyKey?: string;
};
export type CreatePaymentIntentOutput = { id: string; clientSecret: string; status: string };

export type CreateRefundInput = { paymentIntentId: string; amountCents?: number };
export type CreateRefundOutput = { id: string };

export type ConfirmTwinPaymentIntentInput = { paymentIntentId: string };
export type ConfirmTwinPaymentIntentOutput = { id: string; status: string };

export type VerifyWebhookSignatureInput = {
  payload: string | Buffer;
  signature: string;
  secret: string;
};

export type CheckoutSessionCompletedEvent = {
  type: 'checkout.session.completed';
  id: string;
  sessionId: string;
  customerId: string | null;
  subscriptionId: string | null;
  metadata: Record<string, string>;
  currentPeriodEnd: number | null;
};

export type SubscriptionUpdatedEvent = {
  type: 'customer.subscription.updated';
  id: string;
  subscriptionId: string;
  customerId: string | null;
  status: string;
  currentPeriodEnd: number | null;
};

export type SubscriptionDeletedEvent = {
  type: 'customer.subscription.deleted';
  id: string;
  subscriptionId: string;
  customerId: string | null;
  status: string;
};

export type InvoicePaymentFailedEvent = {
  type: 'invoice.payment_failed';
  id: string;
  subscriptionId: string | null;
  customerId: string | null;
  attemptCount: number;
};

export type AccountUpdatedEvent = {
  type: 'account.updated';
  id: string;
  accountId: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
};

export type PaymentIntentSucceededEvent = {
  type: 'payment_intent.succeeded';
  id: string;
  paymentIntentId: string;
  amount: number;
  currency: string;
  connectedAccountId: string | null;
  metadata: Record<string, string>;
};

export type UnhandledStripeEvent = {
  type: 'unhandled';
  id: string;
  rawType: string;
};

export type ParsedStripeEvent =
  | CheckoutSessionCompletedEvent
  | SubscriptionUpdatedEvent
  | SubscriptionDeletedEvent
  | InvoicePaymentFailedEvent
  | AccountUpdatedEvent
  | PaymentIntentSucceededEvent
  | UnhandledStripeEvent;

export interface StripeAdapter {
  readonly mode: StripeMode;
  createCustomer(input: CreateCustomerInput): Promise<CreateCustomerOutput>;
  createCheckoutSession(
    input: CreateCheckoutSessionInput,
  ): Promise<CreateCheckoutSessionOutput>;
  updateSubscription(input: UpdateSubscriptionInput): Promise<UpdateSubscriptionOutput>;
  cancelSubscription(input: CancelSubscriptionInput): Promise<CancelSubscriptionOutput>;
  createConnectAccount(
    input: CreateConnectAccountInput,
  ): Promise<CreateConnectAccountOutput>;
  createConnectAccountLink(
    input: CreateConnectAccountLinkInput,
  ): Promise<CreateConnectAccountLinkOutput>;
  getConnectAccount(
    input: GetConnectAccountInput,
  ): Promise<GetConnectAccountOutput>;
  createPaymentIntent(
    input: CreatePaymentIntentInput,
  ): Promise<CreatePaymentIntentOutput>;
  createRefund(input: CreateRefundInput): Promise<CreateRefundOutput>;
  confirmTwinPaymentIntent(
    input: ConfirmTwinPaymentIntentInput,
  ): Promise<ConfirmTwinPaymentIntentOutput>;
  verifyWebhookSignature(input: VerifyWebhookSignatureInput): ParsedStripeEvent;
}
