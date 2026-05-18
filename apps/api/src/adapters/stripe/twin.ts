import type {
  StripeAdapter,
  StripeAdapterEnv,
  CreateCustomerInput,
  CreateCustomerOutput,
  CreateCheckoutSessionInput,
  CreateCheckoutSessionOutput,
  UpdateSubscriptionInput,
  UpdateSubscriptionOutput,
  CancelSubscriptionInput,
  CancelSubscriptionOutput,
  CreateConnectAccountInput,
  CreateConnectAccountOutput,
  CreateConnectAccountLinkInput,
  CreateConnectAccountLinkOutput,
  GetConnectAccountInput,
  GetConnectAccountOutput,
  CreatePaymentIntentInput,
  CreatePaymentIntentOutput,
  CreateRefundInput,
  CreateRefundOutput,
  ConfirmTwinPaymentIntentInput,
  ConfirmTwinPaymentIntentOutput,
  VerifyWebhookSignatureInput,
  ParsedStripeEvent,
  PreviewPlanChangeInput,
  ChangePlanInput,
  CreatePortalSessionInput,
  CreatePortalSessionOutput,
  PlanPreview,
} from './types.js';
import { parseStripeEvent } from './parse.js';
import { verifyTwinSignature } from './verify-twin.js';

function appendForm(params: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  if (typeof value === 'string') {
    params.append(key, value);
    return;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    params.append(key, String(value));
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => appendForm(params, `${key}[${i}]`, v));
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      appendForm(params, `${key}[${k}]`, v);
    }
  }
}

function toForm(obj: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) appendForm(params, k, v);
  return params.toString();
}

async function postForm<T>(
  twinUrl: string,
  path: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<T> {
  const res = await fetch(`${twinUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: toForm(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`stripe twin POST ${path} failed: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

async function getJson<T>(twinUrl: string, path: string): Promise<T> {
  const res = await fetch(`${twinUrl}${path}`, { method: 'GET' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`stripe twin GET ${path} failed: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

async function deleteJson<T>(twinUrl: string, path: string): Promise<T> {
  const res = await fetch(`${twinUrl}${path}`, { method: 'DELETE' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`stripe twin DELETE ${path} failed: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

type CustomerWire = { id: string };
type CheckoutSessionWire = { id: string; url: string };
type SubscriptionWire = {
  id: string;
  status: string;
  current_period_end: number;
  items: { data: Array<{ id: string; price: { id: string } }> };
};
type UpcomingInvoiceWire = {
  amount_due: number;
  period_end: number;
  lines: { data: Array<{ amount: number; proration: boolean }> };
};
type PortalSessionWire = { id: string; url: string };
type AccountWire = {
  id: string;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
};
type AccountLinkWire = { url: string };
type PaymentIntentWire = { id: string; client_secret: string; status: string };
type RefundWire = { id: string };

export function createStripeTwinAdapter(env: StripeAdapterEnv): StripeAdapter {
  const base = env.twinUrl.replace(/\/+$/, '');
  return {
    mode: 'twin',

    async createCustomer(input: CreateCustomerInput): Promise<CreateCustomerOutput> {
      const wire = await postForm<CustomerWire>(base, '/v1/customers', {
        email: input.email,
        name: input.name,
        metadata: input.metadata,
      });
      return { id: wire.id };
    },

    async createCheckoutSession(
      input: CreateCheckoutSessionInput,
    ): Promise<CreateCheckoutSessionOutput> {
      const wire = await postForm<CheckoutSessionWire>(base, '/v1/checkout/sessions', {
        mode: 'subscription',
        customer: input.customerId,
        line_items: [{ price: input.priceId, quantity: 1 }],
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        metadata: input.metadata,
      });
      return { url: wire.url, sessionId: wire.id };
    },

    async updateSubscription(
      input: UpdateSubscriptionInput,
    ): Promise<UpdateSubscriptionOutput> {
      const wire = await postForm<SubscriptionWire>(
        base,
        `/v1/subscriptions/${input.subscriptionId}`,
        {
          items: [{ price: input.newPriceId }],
          proration_behavior: input.prorate ? 'create_prorations' : 'none',
        },
      );
      return { id: wire.id, status: wire.status };
    },

    async cancelSubscription(
      input: CancelSubscriptionInput,
    ): Promise<CancelSubscriptionOutput> {
      const wire = await deleteJson<SubscriptionWire>(
        base,
        `/v1/subscriptions/${input.subscriptionId}`,
      );
      return { id: wire.id };
    },

    async createConnectAccount(
      input: CreateConnectAccountInput,
    ): Promise<CreateConnectAccountOutput> {
      const wire = await postForm<AccountWire>(base, '/v1/accounts', {
        email: input.email,
        country: input.country,
      });
      return { id: wire.id };
    },

    async createConnectAccountLink(
      input: CreateConnectAccountLinkInput,
    ): Promise<CreateConnectAccountLinkOutput> {
      const wire = await postForm<AccountLinkWire>(base, '/v1/account_links', {
        account: input.accountId,
        refresh_url: input.refreshUrl,
        return_url: input.returnUrl,
        type: 'account_onboarding',
      });
      return { url: wire.url };
    },

    async getConnectAccount(
      input: GetConnectAccountInput,
    ): Promise<GetConnectAccountOutput> {
      const wire = await getJson<AccountWire>(base, `/v1/accounts/${input.accountId}`);
      return {
        id: wire.id,
        chargesEnabled: wire.charges_enabled,
        payoutsEnabled: wire.payouts_enabled,
        detailsSubmitted: wire.details_submitted,
      };
    },

    async createPaymentIntent(
      input: CreatePaymentIntentInput,
    ): Promise<CreatePaymentIntentOutput> {
      const headers: Record<string, string> = {};
      if (input.idempotencyKey) headers['idempotency-key'] = input.idempotencyKey;
      const wire = await postForm<PaymentIntentWire>(
        base,
        '/v1/payment_intents',
        {
          amount: input.amountCents,
          currency: input.currency,
          on_behalf_of: input.connectedAccountId,
          transfer_data: { destination: input.connectedAccountId },
          application_fee_amount: 0,
          metadata: input.metadata,
        },
        headers,
      );
      return { id: wire.id, clientSecret: wire.client_secret, status: wire.status };
    },

    async createRefund(input: CreateRefundInput): Promise<CreateRefundOutput> {
      const wire = await postForm<RefundWire>(base, '/v1/refunds', {
        payment_intent: input.paymentIntentId,
        amount: input.amountCents,
      });
      return { id: wire.id };
    },

    async confirmTwinPaymentIntent(
      input: ConfirmTwinPaymentIntentInput,
    ): Promise<ConfirmTwinPaymentIntentOutput> {
      const wire = await postForm<PaymentIntentWire>(
        base,
        `/v1/payment_intents/${input.paymentIntentId}/confirm`,
        { payment_method: 'tok_visa_ok' },
      );
      return { id: wire.id, status: wire.status };
    },

    async previewPlanChange(input: PreviewPlanChangeInput): Promise<PlanPreview> {
      const sub = await getJson<SubscriptionWire>(
        base,
        `/v1/subscriptions/${input.subscriptionId}`,
      );
      const firstItem = sub.items.data[0];
      if (!firstItem) {
        throw new Error('stripe.twin.previewPlanChange: subscription has no items');
      }
      const upcoming = await postForm<UpcomingInvoiceWire>(base, '/v1/invoices/upcoming', {
        customer: input.customerId,
        subscription: input.subscriptionId,
        subscription_items: [{ id: firstItem.id, price: input.newPriceId }],
        subscription_proration_behavior: 'create_prorations',
      });
      let prorationDelta = 0;
      let nextChargeCents = 0;
      for (const line of upcoming.lines.data) {
        if (line.proration) {
          prorationDelta += line.amount;
        } else if (line.amount > nextChargeCents) {
          nextChargeCents = line.amount;
        }
      }
      return {
        amountDueCents: Math.max(0, upcoming.amount_due),
        creditCents: prorationDelta < 0 ? -prorationDelta : 0,
        chargeCents: prorationDelta > 0 ? prorationDelta : 0,
        currentPeriodEndIso: new Date(sub.current_period_end * 1000).toISOString(),
        nextChargeCents,
      };
    },

    async changePlan(input: ChangePlanInput): Promise<void> {
      const sub = await getJson<SubscriptionWire>(
        base,
        `/v1/subscriptions/${input.subscriptionId}`,
      );
      const firstItem = sub.items.data[0];
      if (!firstItem) {
        throw new Error('stripe.twin.changePlan: subscription has no items');
      }
      await postForm<SubscriptionWire>(
        base,
        `/v1/subscriptions/${input.subscriptionId}`,
        {
          items: [{ id: firstItem.id, price: input.newPriceId }],
          proration_behavior: 'create_prorations',
        },
        { 'idempotency-key': input.idempotencyKey },
      );
    },

    async createPortalSession(
      input: CreatePortalSessionInput,
    ): Promise<CreatePortalSessionOutput> {
      const wire = await postForm<PortalSessionWire>(base, '/v1/billing_portal/sessions', {
        customer: input.customerId,
        return_url: input.returnUrl,
      });
      return { url: wire.url };
    },

    verifyWebhookSignature(input: VerifyWebhookSignatureInput): ParsedStripeEvent {
      const payload = typeof input.payload === 'string' ? input.payload : input.payload.toString('utf8');
      if (!verifyTwinSignature(input.secret, input.signature, payload)) {
        throw new Error('stripe.twin.verifyWebhookSignature: signature verification failed');
      }
      const parsed: unknown = JSON.parse(payload);
      return parseStripeEvent(parsed);
    },
  };
}
