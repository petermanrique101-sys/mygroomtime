import { describe, it, expect } from 'vitest';
import { createStripeAdapter } from './index.js';
import type { StripeAdapterEnv } from './types.js';
import { parseStripeEvent } from './parse.js';

const baseEnv: Omit<StripeAdapterEnv, 'mode'> = {
  secretKey: 'sk_test',
  webhookSecret: 'whsec_test',
  twinUrl: 'http://localhost:4242',
};

describe('stripe adapter — wiring', () => {
  it('returns a twin instance when mode=twin', () => {
    const adapter = createStripeAdapter({ ...baseEnv, mode: 'twin' });
    expect(adapter.mode).toBe('twin');
  });

  it('returns a live instance when mode=live', () => {
    const adapter = createStripeAdapter({ ...baseEnv, mode: 'live' });
    expect(adapter.mode).toBe('live');
  });

  it('live Connect methods still throw "not implemented" (chunk 12)', async () => {
    const adapter = createStripeAdapter({ ...baseEnv, mode: 'live' });
    await expect(
      adapter.createConnectAccount({ email: 'x@y.test', country: 'US' }),
    ).rejects.toThrow('not implemented: stripe.live.createConnectAccount');
    await expect(
      adapter.createPaymentIntent({
        amountCents: 1000,
        currency: 'usd',
        connectedAccountId: 'acct_x',
      }),
    ).rejects.toThrow('not implemented: stripe.live.createPaymentIntent');
  });
});

describe('parseStripeEvent — discriminated union', () => {
  it('parses checkout.session.completed', () => {
    const parsed = parseStripeEvent({
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_1',
          customer: 'cus_1',
          subscription: 'sub_1',
          metadata: { tenantId: 't1', tier: 'starter' },
          current_period_end: 1700000000,
        },
      },
    });
    expect(parsed.type).toBe('checkout.session.completed');
    if (parsed.type === 'checkout.session.completed') {
      expect(parsed.sessionId).toBe('cs_1');
      expect(parsed.customerId).toBe('cus_1');
      expect(parsed.subscriptionId).toBe('sub_1');
      expect(parsed.metadata.tenantId).toBe('t1');
      expect(parsed.currentPeriodEnd).toBe(1700000000);
    }
  });

  it('parses customer.subscription.updated', () => {
    const parsed = parseStripeEvent({
      id: 'evt_2',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_1',
          customer: 'cus_1',
          status: 'past_due',
          current_period_end: 1700000000,
        },
      },
    });
    expect(parsed.type).toBe('customer.subscription.updated');
    if (parsed.type === 'customer.subscription.updated') {
      expect(parsed.subscriptionId).toBe('sub_1');
      expect(parsed.status).toBe('past_due');
      expect(parsed.currentPeriodEnd).toBe(1700000000);
    }
  });

  it('parses customer.subscription.deleted', () => {
    const parsed = parseStripeEvent({
      id: 'evt_3',
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_1', customer: 'cus_1', status: 'canceled' } },
    });
    expect(parsed.type).toBe('customer.subscription.deleted');
    if (parsed.type === 'customer.subscription.deleted') {
      expect(parsed.subscriptionId).toBe('sub_1');
      expect(parsed.status).toBe('canceled');
    }
  });

  it('parses invoice.payment_failed', () => {
    const parsed = parseStripeEvent({
      id: 'evt_4',
      type: 'invoice.payment_failed',
      data: { object: { subscription: 'sub_1', customer: 'cus_1', attempt_count: 2 } },
    });
    expect(parsed.type).toBe('invoice.payment_failed');
    if (parsed.type === 'invoice.payment_failed') {
      expect(parsed.subscriptionId).toBe('sub_1');
      expect(parsed.attemptCount).toBe(2);
    }
  });

  it('unrecognized event type → unhandled', () => {
    const parsed = parseStripeEvent({
      id: 'evt_5',
      type: 'charge.dispute.created',
      data: { object: {} },
    });
    expect(parsed.type).toBe('unhandled');
    if (parsed.type === 'unhandled') {
      expect(parsed.rawType).toBe('charge.dispute.created');
    }
  });

  it('garbage input → unhandled with safe defaults', () => {
    const parsed = parseStripeEvent(null);
    expect(parsed.type).toBe('unhandled');
    expect(parsed.id).toBe('evt_unknown');
  });
});
