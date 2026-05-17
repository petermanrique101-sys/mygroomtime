import Stripe from 'stripe';
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
  CreatePaymentIntentInput,
  CreatePaymentIntentOutput,
  CreateRefundInput,
  CreateRefundOutput,
  VerifyWebhookSignatureInput,
  ParsedStripeEvent,
} from './types.js';
import { parseStripeEvent } from './parse.js';

// why: pinning the API version prevents Stripe from silently bumping us mid-cycle.
// If you upgrade the SDK, also bump this string and re-run the adapter tests.
const PINNED_API_VERSION: Stripe.StripeConfig['apiVersion'] = '2025-02-24.acacia';

function notImplemented(method: string): never {
  throw new Error(`not implemented: stripe.live.${method}`);
}

export function createStripeLiveAdapter(env: StripeAdapterEnv): StripeAdapter {
  const client = new Stripe(env.secretKey || 'sk_live_unconfigured', {
    apiVersion: (env.apiVersion as Stripe.StripeConfig['apiVersion']) ?? PINNED_API_VERSION,
  });

  return {
    mode: 'live',

    async createCustomer(input: CreateCustomerInput): Promise<CreateCustomerOutput> {
      const customer = await client.customers.create({
        email: input.email,
        name: input.name,
        metadata: input.metadata,
      });
      return { id: customer.id };
    },

    async createCheckoutSession(
      input: CreateCheckoutSessionInput,
    ): Promise<CreateCheckoutSessionOutput> {
      const session = await client.checkout.sessions.create({
        mode: 'subscription',
        customer: input.customerId,
        line_items: [{ price: input.priceId, quantity: 1 }],
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        metadata: input.metadata,
      });
      if (!session.url) {
        throw new Error('stripe.live.createCheckoutSession: Stripe returned no url');
      }
      return { url: session.url, sessionId: session.id };
    },

    async updateSubscription(
      input: UpdateSubscriptionInput,
    ): Promise<UpdateSubscriptionOutput> {
      const existing = await client.subscriptions.retrieve(input.subscriptionId);
      const firstItem = existing.items.data[0];
      if (!firstItem) {
        throw new Error('stripe.live.updateSubscription: subscription has no items');
      }
      const updated = await client.subscriptions.update(input.subscriptionId, {
        items: [{ id: firstItem.id, price: input.newPriceId }],
        proration_behavior: input.prorate ? 'create_prorations' : 'none',
      });
      return { id: updated.id, status: updated.status };
    },

    async cancelSubscription(
      input: CancelSubscriptionInput,
    ): Promise<CancelSubscriptionOutput> {
      const canceled = await client.subscriptions.cancel(input.subscriptionId);
      return { id: canceled.id };
    },

    async createConnectAccount(
      _input: CreateConnectAccountInput,
    ): Promise<CreateConnectAccountOutput> {
      notImplemented('createConnectAccount');
    },
    async createConnectAccountLink(
      _input: CreateConnectAccountLinkInput,
    ): Promise<CreateConnectAccountLinkOutput> {
      notImplemented('createConnectAccountLink');
    },
    async createPaymentIntent(
      _input: CreatePaymentIntentInput,
    ): Promise<CreatePaymentIntentOutput> {
      notImplemented('createPaymentIntent');
    },
    async createRefund(_input: CreateRefundInput): Promise<CreateRefundOutput> {
      notImplemented('createRefund');
    },

    verifyWebhookSignature(input: VerifyWebhookSignatureInput): ParsedStripeEvent {
      const event = client.webhooks.constructEvent(input.payload, input.signature, input.secret);
      return parseStripeEvent(event);
    },
  };
}
