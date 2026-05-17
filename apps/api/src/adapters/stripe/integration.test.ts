import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createApp as createTwinApp, type TwinAppHandle, signPayload } from '@mygroomtime/twin-stripe';
import { createStripeAdapter } from './index.js';

const WEBHOOK_SECRET = 'whsec_integration';

type DeliveredEvent = { headers: Record<string, string>; body: string; parsed: { type: string; id: string } };

let twin: TwinAppHandle;
let twinUrl: string;
let collector: Server;
let collectorUrl: string;
let delivered: DeliveredEvent[];

async function waitFor(predicate: () => boolean, timeoutMs = 1500): Promise<void> {
  const start = Date.now();
  while (!predicate() && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 20));
  }
}

beforeAll(async () => {
  delivered = [];
  collector = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => {
      const hdrs: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') hdrs[k] = v;
        else if (Array.isArray(v)) hdrs[k] = v.join(',');
      }
      let parsed: { type: string; id: string };
      try {
        parsed = JSON.parse(body) as { type: string; id: string };
      } catch {
        parsed = { type: 'invalid', id: '' };
      }
      delivered.push({ headers: hdrs, body, parsed });
      res.statusCode = 200;
      res.end('{}');
    });
  });
  await new Promise<void>((resolve) => {
    collector.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = collector.address();
  if (!addr || typeof addr === 'string') throw new Error('collector address missing');
  collectorUrl = `http://127.0.0.1:${addr.port}/hook`;

  twin = createTwinApp({ logger: false, webhookUrl: collectorUrl, webhookSecret: WEBHOOK_SECRET });
  await twin.app.listen({ port: 0, host: '127.0.0.1' });
  const twinAddr = twin.app.server.address();
  if (!twinAddr || typeof twinAddr === 'string') throw new Error('twin address missing');
  twinUrl = `http://127.0.0.1:${twinAddr.port}`;
  twin.setPublicOrigin(twinUrl);
});

afterAll(async () => {
  await twin.app.close();
  await new Promise<void>((resolve) => collector.close(() => resolve()));
});

describe('stripe adapter ↔ twin — full subscription lifecycle', () => {
  it('createCustomer → createCheckoutSession → auto-complete → webhook flips plan', async () => {
    const adapter = createStripeAdapter({
      mode: 'twin',
      secretKey: 'sk_test',
      webhookSecret: WEBHOOK_SECRET,
      twinUrl,
    });

    const customer = await adapter.createCustomer({
      email: 'owner@biz.test',
      metadata: { tenantId: 'tenant_xyz' },
    });
    expect(customer.id).toMatch(/^cus_TWIN_/);

    const session = await adapter.createCheckoutSession({
      customerId: customer.id,
      priceId: 'price_starter_twin',
      successUrl: 'http://example.test/ok?session={CHECKOUT_SESSION_ID}',
      cancelUrl: 'http://example.test/cancel',
      metadata: { tenantId: 'tenant_xyz', tier: 'starter' },
    });
    expect(session.url).toContain('/checkout/');

    delivered.length = 0;
    const auto = await fetch(`${session.url}?auto=1`, { redirect: 'manual' });
    expect(auto.status).toBe(302);

    await waitFor(() => delivered.some((e) => e.parsed.type === 'checkout.session.completed'));
    const completion = delivered.find((e) => e.parsed.type === 'checkout.session.completed');
    expect(completion).toBeTruthy();

    const event = adapter.verifyWebhookSignature({
      payload: completion!.body,
      signature: completion!.headers['stripe-signature']!,
      secret: WEBHOOK_SECRET,
    });
    expect(event.type).toBe('checkout.session.completed');
    if (event.type === 'checkout.session.completed') {
      expect(event.metadata.tenantId).toBe('tenant_xyz');
      expect(event.metadata.tier).toBe('starter');
      expect(event.subscriptionId).toMatch(/^sub_TWIN_/);
    }
  });

  it('updateSubscription + cancelSubscription touch the right ids', async () => {
    const adapter = createStripeAdapter({
      mode: 'twin',
      secretKey: 'sk_test',
      webhookSecret: WEBHOOK_SECRET,
      twinUrl,
    });
    const customer = await adapter.createCustomer({ email: 'sub@biz.test' });
    const session = await adapter.createCheckoutSession({
      customerId: customer.id,
      priceId: 'price_pro_twin',
      successUrl: 'http://example.test/ok',
      cancelUrl: 'http://example.test/cancel',
      metadata: {},
    });
    delivered.length = 0;
    await fetch(`${session.url}?auto=1`, { redirect: 'manual' });
    await waitFor(() => delivered.some((e) => e.parsed.type === 'customer.subscription.created'));
    const subCreated = delivered.find(
      (e) => e.parsed.type === 'customer.subscription.created',
    );
    const subId = JSON.parse(subCreated!.body).data.object.id as string;

    const updated = await adapter.updateSubscription({
      subscriptionId: subId,
      newPriceId: 'price_business_twin',
      prorate: true,
    });
    expect(updated.id).toBe(subId);

    const canceled = await adapter.cancelSubscription({ subscriptionId: subId });
    expect(canceled.id).toBe(subId);
  });
});

describe('stripe adapter ↔ twin — webhook signature roundtrip', () => {
  it('verifyWebhookSignature accepts a valid signature and parses the event', () => {
    const adapter = createStripeAdapter({
      mode: 'twin',
      secretKey: 'sk_test',
      webhookSecret: WEBHOOK_SECRET,
      twinUrl,
    });
    const payload = JSON.stringify({
      id: 'evt_x',
      type: 'invoice.payment_failed',
      data: { object: { subscription: 'sub_1', customer: 'cus_1', attempt_count: 1 } },
    });
    const ts = Math.floor(Date.now() / 1000);
    const sig = signPayload(WEBHOOK_SECRET, ts, payload);

    const event = adapter.verifyWebhookSignature({ payload, signature: sig, secret: WEBHOOK_SECRET });
    expect(event.type).toBe('invoice.payment_failed');
    if (event.type === 'invoice.payment_failed') {
      expect(event.subscriptionId).toBe('sub_1');
    }
  });

  it('verifyWebhookSignature rejects tampering with a thrown error', () => {
    const adapter = createStripeAdapter({
      mode: 'twin',
      secretKey: 'sk_test',
      webhookSecret: WEBHOOK_SECRET,
      twinUrl,
    });
    const payload = JSON.stringify({ id: 'evt_y', type: 'unhandled', data: { object: {} } });
    const ts = Math.floor(Date.now() / 1000);
    const sig = signPayload(WEBHOOK_SECRET, ts, payload);
    expect(() =>
      adapter.verifyWebhookSignature({
        payload: payload + 'TAMPER',
        signature: sig,
        secret: WEBHOOK_SECRET,
      }),
    ).toThrow(/signature verification failed/);
  });
});
