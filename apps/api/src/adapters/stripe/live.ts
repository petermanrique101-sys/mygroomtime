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
} from './types.js';
import { parseStripeEvent } from './parse.js';

// why: pinning the API version prevents Stripe from silently bumping us mid-cycle.
// If you upgrade the SDK, also bump this string and re-run the adapter tests.
const PINNED_API_VERSION: Stripe.StripeConfig['apiVersion'] = '2025-02-24.acacia';

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
      input: CreateConnectAccountInput,
    ): Promise<CreateConnectAccountOutput> {
      const account = await client.accounts.create({
        type: 'express',
        country: input.country,
        email: input.email,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
      });
      return { id: account.id };
    },

    async createConnectAccountLink(
      input: CreateConnectAccountLinkInput,
    ): Promise<CreateConnectAccountLinkOutput> {
      const link = await client.accountLinks.create({
        account: input.accountId,
        refresh_url: input.refreshUrl,
        return_url: input.returnUrl,
        type: 'account_onboarding',
      });
      return { url: link.url };
    },

    async getConnectAccount(
      input: GetConnectAccountInput,
    ): Promise<GetConnectAccountOutput> {
      const account = await client.accounts.retrieve(input.accountId);
      return {
        id: account.id,
        chargesEnabled: account.charges_enabled === true,
        payoutsEnabled: account.payouts_enabled === true,
        detailsSubmitted: account.details_submitted === true,
      };
    },

    async createPaymentIntent(
      input: CreatePaymentIntentInput,
    ): Promise<CreatePaymentIntentOutput> {
      // why: direct charge with destination — funds settle to the connected account
      // immediately, application_fee_amount=0 because v1 doesn't monetize Connect.
      // TODO(v2): set application_fee_amount once we price the platform layer.
      const pi = await client.paymentIntents.create(
        {
          amount: input.amountCents,
          currency: input.currency,
          metadata: input.metadata,
          on_behalf_of: input.connectedAccountId,
          transfer_data: { destination: input.connectedAccountId },
          application_fee_amount: 0,
          automatic_payment_methods: { enabled: true },
        },
        input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined,
      );
      if (!pi.client_secret) {
        throw new Error('stripe.live.createPaymentIntent: Stripe returned no client_secret');
      }
      return { id: pi.id, clientSecret: pi.client_secret, status: pi.status };
    },

    async createRefund(input: CreateRefundInput): Promise<CreateRefundOutput> {
      const refund = await client.refunds.create({
        payment_intent: input.paymentIntentId,
        amount: input.amountCents,
      });
      return { id: refund.id };
    },

    async confirmTwinPaymentIntent(
      _input: ConfirmTwinPaymentIntentInput,
    ): Promise<ConfirmTwinPaymentIntentOutput> {
      // why: this seam exists for dev/test against the twin only. In live, the
      // customer browser confirms via Stripe.js — never the server.
      throw new Error('stripe.live.confirmTwinPaymentIntent: not available in live mode');
    },

    verifyWebhookSignature(input: VerifyWebhookSignatureInput): ParsedStripeEvent {
      const event = client.webhooks.constructEvent(input.payload, input.signature, input.secret);
      return parseStripeEvent(event);
    },
  };
}
