import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { db } from '@mygroomtime/db';
import { signPayload } from '@mygroomtime/twin-stripe';
import { createApp } from '../../../app.js';
import { createMemorySessionStore } from '../../../adapters/session/index.js';
import { createStdoutEmailAdapter } from '../../../adapters/email/index.js';
import { makeTestEnv } from '../../../test-utils/env.js';

const PREFIX = 'webhook-stripe-test-';
const WEBHOOK_SECRET = 'whsec_test_unused';

async function cleanupTenants(): Promise<void> {
  const rows = await db.global.tenant.findMany({
    where: { slug: { startsWith: PREFIX } },
    select: { id: true },
  });
  for (const t of rows) await db.global.tenant.delete({ where: { id: t.id } });
  await db.global.webhookEvent.deleteMany({
    where: { eventId: { startsWith: 'evt_webhook_test_' } },
  });
}

async function makeTenant(suffix: string): Promise<{ id: string }> {
  const tenant = await db.global.tenant.create({
    data: {
      slug: `${PREFIX}${suffix}`,
      businessName: `${PREFIX}biz-${suffix}`,
    },
    select: { id: true },
  });
  return tenant;
}

async function signedPost(
  app: FastifyInstance,
  payload: string,
  secret = WEBHOOK_SECRET,
): Promise<Awaited<ReturnType<typeof app.inject>>> {
  const ts = Math.floor(Date.now() / 1000);
  const sig = signPayload(secret, ts, payload);
  return app.inject({
    method: 'POST',
    url: '/webhooks/stripe',
    headers: { 'content-type': 'application/json', 'stripe-signature': sig },
    payload,
  });
}

describe('POST /webhooks/stripe', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createApp({
      logger: false,
      env: makeTestEnv(),
      sessionStore: createMemorySessionStore(),
      emailAdapter: createStdoutEmailAdapter(),
    });
  });

  afterAll(async () => {
    await cleanupTenants();
    await app.close();
  });

  beforeEach(async () => {
    await cleanupTenants();
  });

  it('400 on missing Stripe-Signature header', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ id: 'evt_x', type: 'unhandled' }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('400 on invalid signature; no WebhookEvent row created', async () => {
    const payload = JSON.stringify({ id: 'evt_webhook_test_bad', type: 'unhandled' });
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=deadbeef' },
      payload,
    });
    expect(res.statusCode).toBe(400);
    const row = await db.global.webhookEvent.findFirst({
      where: { eventId: 'evt_webhook_test_bad' },
    });
    expect(row).toBeNull();
  });

  it('checkout.session.completed flips plan + clears pastDueAt', async () => {
    const tenant = await makeTenant('flip');
    await db.global.tenant.update({
      where: { id: tenant.id },
      data: { pastDueAt: new Date('2024-01-01') },
    });

    const payload = JSON.stringify({
      id: 'evt_webhook_test_complete',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_x',
          customer: 'cus_x',
          subscription: 'sub_flip_1',
          current_period_end: 1900000000,
          metadata: { tenantId: tenant.id, tier: 'pro' },
        },
      },
    });
    const res = await signedPost(app, payload);
    expect(res.statusCode).toBe(200);

    const updated = await db.global.tenant.findUnique({ where: { id: tenant.id } });
    expect(updated?.plan).toBe('pro');
    expect(updated?.stripeSubscriptionId).toBe('sub_flip_1');
    expect(updated?.stripeSubscriptionStatus).toBe('active');
    expect(updated?.pastDueAt).toBeNull();
  });

  it('idempotent: replaying the same event id flips plan exactly once', async () => {
    const tenant = await makeTenant('dedupe');
    const payload = JSON.stringify({
      id: 'evt_webhook_test_dedupe',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_dd',
          customer: 'cus_dd',
          subscription: 'sub_dd_1',
          current_period_end: 1900000000,
          metadata: { tenantId: tenant.id, tier: 'starter' },
        },
      },
    });

    const first = await signedPost(app, payload);
    expect(first.statusCode).toBe(200);
    const replay = await signedPost(app, payload);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual({ deduped: true });

    const rows = await db.global.webhookEvent.findMany({
      where: { eventId: 'evt_webhook_test_dedupe' },
    });
    expect(rows.length).toBe(1);
  });

  it('concurrent delivery of the same event: exactly one row, no double flip', async () => {
    const tenant = await makeTenant('concurrent');
    const payload = JSON.stringify({
      id: 'evt_webhook_test_concurrent',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_cc',
          customer: 'cus_cc',
          subscription: 'sub_cc_1',
          current_period_end: 1900000000,
          metadata: { tenantId: tenant.id, tier: 'business' },
        },
      },
    });

    const [a, b] = await Promise.all([signedPost(app, payload), signedPost(app, payload)]);
    expect([a.statusCode, b.statusCode].every((c) => c === 200)).toBe(true);
    const responses = [a.json(), b.json()];
    const dedupedCount = responses.filter((r) => (r as { deduped?: boolean }).deduped).length;
    expect(dedupedCount).toBe(1);

    const rows = await db.global.webhookEvent.findMany({
      where: { eventId: 'evt_webhook_test_concurrent' },
    });
    expect(rows.length).toBe(1);
    const updated = await db.global.tenant.findUnique({ where: { id: tenant.id } });
    expect(updated?.plan).toBe('business');
  });

  it('invoice.payment_failed sets pastDueAt without changing plan', async () => {
    const tenant = await makeTenant('pf');
    await db.global.tenant.update({
      where: { id: tenant.id },
      data: { plan: 'starter', stripeSubscriptionId: 'sub_pf_1' },
    });

    const payload = JSON.stringify({
      id: 'evt_webhook_test_pf',
      type: 'invoice.payment_failed',
      data: { object: { subscription: 'sub_pf_1', customer: 'cus_pf', attempt_count: 1 } },
    });
    const res = await signedPost(app, payload);
    expect(res.statusCode).toBe(200);

    const updated = await db.global.tenant.findUnique({ where: { id: tenant.id } });
    expect(updated?.plan).toBe('starter');
    expect(updated?.pastDueAt).not.toBeNull();
  });

  it('customer.subscription.updated status=past_due flips plan to past_due', async () => {
    const tenant = await makeTenant('pd');
    await db.global.tenant.update({
      where: { id: tenant.id },
      data: { plan: 'pro', stripeSubscriptionId: 'sub_pd_1' },
    });

    const payload = JSON.stringify({
      id: 'evt_webhook_test_pd',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_pd_1',
          customer: 'cus_pd',
          status: 'past_due',
          current_period_end: 1900000000,
        },
      },
    });
    const res = await signedPost(app, payload);
    expect(res.statusCode).toBe(200);
    const updated = await db.global.tenant.findUnique({ where: { id: tenant.id } });
    expect(updated?.plan).toBe('past_due');
  });

  it('customer.subscription.deleted flips to canceled and clears subscription fields', async () => {
    const tenant = await makeTenant('del');
    await db.global.tenant.update({
      where: { id: tenant.id },
      data: {
        plan: 'past_due',
        stripeSubscriptionId: 'sub_del_1',
        stripeSubscriptionStatus: 'past_due',
        currentPeriodEnd: new Date('2030-01-01'),
      },
    });

    const payload = JSON.stringify({
      id: 'evt_webhook_test_del',
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_del_1', customer: 'cus_del', status: 'canceled' } },
    });
    const res = await signedPost(app, payload);
    expect(res.statusCode).toBe(200);

    const updated = await db.global.tenant.findUnique({ where: { id: tenant.id } });
    expect(updated?.plan).toBe('canceled');
    expect(updated?.stripeSubscriptionId).toBeNull();
    expect(updated?.currentPeriodEnd).toBeNull();
  });

  it('unknown event type → 200 ignored, recorded as processed', async () => {
    const payload = JSON.stringify({
      id: 'evt_webhook_test_unk',
      type: 'charge.dispute.created',
      data: { object: {} },
    });
    const res = await signedPost(app, payload);
    expect(res.statusCode).toBe(200);
    const row = await db.global.webhookEvent.findFirst({
      where: { eventId: 'evt_webhook_test_unk' },
    });
    expect(row?.status).toBe('processed');
  });
});
