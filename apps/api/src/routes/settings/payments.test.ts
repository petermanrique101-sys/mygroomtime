import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  createApp as createStripeTwinApp,
  type TwinAppHandle,
  signPayload,
} from '@mygroomtime/twin-stripe';
import { db } from '@mygroomtime/db';
import { createApp } from '../../app.js';
import { createMemorySessionStore } from '../../adapters/session/index.js';
import { createStdoutEmailAdapter } from '../../adapters/email/index.js';
import { createStripeAdapter } from '../../adapters/stripe/index.js';
import { makeTestEnv } from '../../test-utils/env.js';
import {
  cleanupTestTenants,
  signup,
  type TestTenant,
} from '../appointments/test-helpers.js';

const SLUG_PREFIX = 'settings-pay-';
const WEBHOOK_SECRET = 'whsec_settings_test';

describe('settings/payments — Connect onboarding flow', () => {
  let app: FastifyInstance;
  let stripeTwin: TwinAppHandle;
  let stripeTwinUrl: string;
  let tenant: TestTenant;

  beforeAll(async () => {
    stripeTwin = createStripeTwinApp({
      logger: false,
      webhookUrl: null,
      webhookSecret: WEBHOOK_SECRET,
    });
    await stripeTwin.app.listen({ port: 0, host: '127.0.0.1' });
    const port = (stripeTwin.app.server.address() as { port: number }).port;
    stripeTwinUrl = `http://127.0.0.1:${port}`;
    stripeTwin.setPublicOrigin(stripeTwinUrl);

    const env = makeTestEnv();
    env.stripe.twinUrl = stripeTwinUrl;
    env.stripe.webhookSecret = WEBHOOK_SECRET;
    app = await createApp({
      logger: false,
      env,
      sessionStore: createMemorySessionStore(),
      emailAdapter: createStdoutEmailAdapter(),
      adapters: {
        stripe: createStripeAdapter({
          mode: 'twin',
          secretKey: 'sk_test',
          webhookSecret: WEBHOOK_SECRET,
          twinUrl: stripeTwinUrl,
        }),
      },
    });
  });

  afterAll(async () => {
    await cleanupTestTenants(SLUG_PREFIX);
    await app.close();
    await stripeTwin.app.close();
  });

  beforeEach(async () => {
    await cleanupTestTenants(SLUG_PREFIX);
    await db.global.webhookEvent.deleteMany({
      where: { eventId: { startsWith: 'evt_settings_' } },
    });
    const ts = Date.now();
    tenant = await signup(app, SLUG_PREFIX, `pay-${ts}`, `pay-${ts}`);
  });

  it('GET /settings/payments returns needsOnboarding=true before any account', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/settings/payments',
      headers: { cookie: tenant.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { needsOnboarding: boolean; connectAccountId: string | null };
    expect(body.needsOnboarding).toBe(true);
    expect(body.connectAccountId).toBeNull();
  });

  it('POST /settings/payments/onboard lazy-creates account + returns onboarding URL', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/settings/payments/onboard',
      headers: { cookie: tenant.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { url: string };
    expect(body.url).toContain('/__twin_onboarding/');

    const tenantRow = await db.global.tenant.findUnique({
      where: { id: tenant.tenantId },
      select: { stripeConnectAccountId: true },
    });
    expect(tenantRow?.stripeConnectAccountId).toMatch(/^acct_TWIN_/);
  });

  it('visiting onboarding URL flips capabilities + fires account.updated', async () => {
    const onboard = await app.inject({
      method: 'POST',
      url: '/settings/payments/onboard',
      headers: { cookie: tenant.cookie },
    });
    const { url } = onboard.json() as { url: string };
    const visit = await fetch(url, { redirect: 'manual' });
    expect([200, 302].includes(visit.status)).toBe(true);

    const status = await app.inject({
      method: 'GET',
      url: '/settings/payments',
      headers: { cookie: tenant.cookie },
    });
    const body = status.json() as { chargesEnabled: boolean; needsOnboarding: boolean };
    expect(body.chargesEnabled).toBe(true);
    expect(body.needsOnboarding).toBe(false);
  });

  it('account.updated webhook updates tenant flags', async () => {
    await db.global.tenant.update({
      where: { id: tenant.tenantId },
      data: { stripeConnectAccountId: 'acct_TWIN_wh' },
    });
    const payload = JSON.stringify({
      id: 'evt_settings_wh',
      type: 'account.updated',
      data: {
        object: {
          id: 'acct_TWIN_wh',
          charges_enabled: true,
          payouts_enabled: true,
          details_submitted: true,
        },
      },
    });
    const ts = Math.floor(Date.now() / 1000);
    const sig = signPayload(WEBHOOK_SECRET, ts, payload);
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': sig },
      payload,
    });
    expect(res.statusCode).toBe(200);
    const row = await db.global.tenant.findUnique({
      where: { id: tenant.tenantId },
      select: { stripeConnectChargesEnabled: true, stripeConnectPayoutsEnabled: true },
    });
    expect(row?.stripeConnectChargesEnabled).toBe(true);
    expect(row?.stripeConnectPayoutsEnabled).toBe(true);
  });
});
