import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp as createGeocodeTwinApp } from '@mygroomtime/twin-geocode';
import { createApp as createGmapsTwinApp } from '@mygroomtime/twin-google-maps';
import {
  createApp as createStripeTwinApp,
  type TwinAppHandle as StripeTwinHandle,
} from '@mygroomtime/twin-stripe';
import { db, PlanTier, AppointmentStatus } from '@mygroomtime/db';
import { createApp } from '../../app.js';
import { createMemorySessionStore } from '../../adapters/session/index.js';
import { createStdoutEmailAdapter } from '../../adapters/email/index.js';
import { createGeocodeAdapter } from '../../adapters/geocode/index.js';
import { createGmapsAdapter } from '../../adapters/gmaps/index.js';
import { createStripeAdapter } from '../../adapters/stripe/index.js';
import { makeTestEnv } from '../../test-utils/env.js';
import {
  cleanupTestTenants,
  createClientAndPet,
  createServiceFor,
  signup,
  type TestTenant,
} from './test-helpers.js';

const SLUG_PREFIX = 'appts-complete-test-';
const WEBHOOK_SECRET = 'whsec_complete_test';

describe('POST /appointments/:id/complete', () => {
  let app: FastifyInstance;
  let geocodeTwin: FastifyInstance;
  let gmapsTwin: FastifyInstance;
  let stripeTwin: StripeTwinHandle;
  let stripeTwinUrl: string;
  let tenant: TestTenant;
  let petId: string;
  let serviceId: string;

  beforeAll(async () => {
    geocodeTwin = createGeocodeTwinApp({ logger: false });
    await geocodeTwin.listen({ port: 0, host: '127.0.0.1' });
    const geocodePort = (geocodeTwin.server.address() as { port: number }).port;

    gmapsTwin = createGmapsTwinApp({ logger: false });
    await gmapsTwin.listen({ port: 0, host: '127.0.0.1' });
    const gmapsPort = (gmapsTwin.server.address() as { port: number }).port;

    stripeTwin = createStripeTwinApp({
      logger: false,
      webhookUrl: null,
      webhookSecret: WEBHOOK_SECRET,
    });
    await stripeTwin.app.listen({ port: 0, host: '127.0.0.1' });
    const stripePort = (stripeTwin.app.server.address() as { port: number }).port;
    stripeTwinUrl = `http://127.0.0.1:${stripePort}`;
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
        geocode: createGeocodeAdapter({
          mode: 'twin',
          apiKey: '',
          twinUrl: `http://127.0.0.1:${geocodePort}`,
        }),
        gmaps: createGmapsAdapter({
          mode: 'twin',
          apiKey: '',
          twinUrl: `http://127.0.0.1:${gmapsPort}`,
        }),
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
    await geocodeTwin.close();
    await gmapsTwin.close();
    await stripeTwin.app.close();
  });

  beforeEach(async () => {
    await cleanupTestTenants(SLUG_PREFIX);
    const ts = Date.now() + Math.floor(Math.random() * 1000);
    tenant = await signup(app, SLUG_PREFIX, `cp-${ts}`, `cp-${ts}`);
    await db.global.tenant.update({
      where: { id: tenant.tenantId },
      data: {
        plan: PlanTier.starter,
        stripeConnectAccountId: 'acct_TWIN_complete',
        stripeConnectChargesEnabled: true,
      },
    });
    const cp = await createClientAndPet(app, tenant);
    petId = cp.petId;
    const svc = await createServiceFor(app, tenant);
    serviceId = svc.id;
  });

  async function seedStartedAppt(opts: { withDeposit: boolean }): Promise<string> {
    const start = new Date();
    start.setDate(start.getDate() + 1);
    start.setHours(10, 0, 0, 0);
    const res = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { cookie: tenant.cookie },
      payload: { petId, serviceId, start: start.toISOString() },
    });
    if (res.statusCode !== 201) throw new Error(`appt create failed: ${res.body}`);
    const id = (res.json() as { appointment: { id: string } }).appointment.id;
    const scoped = db.forTenant(tenant.tenantId);
    await scoped.appointment.update({
      where: { id },
      data: {
        status: AppointmentStatus.started,
        startedAt: new Date(),
        depositChargeId: opts.withDeposit ? 'pi_TWIN_deposit_seed' : null,
      },
    });
    return id;
  }

  it('Complete WITH deposit: hits Stripe twin, captures balance, sets finalAmountCents', async () => {
    const id = await seedStartedAppt({ withDeposit: true });
    const res = await app.inject({
      method: 'POST',
      url: `/appointments/${id}/complete`,
      headers: { cookie: tenant.cookie },
      payload: { tipCents: 1500 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      appointment: { status: string; tipCents: number };
      finalAmountCents: number;
      balanceChargeId: string | null;
      alreadyCompleted: boolean;
    };
    expect(body.appointment.status).toBe('completed');
    // service price 8500 + tip 1500 = 10000 final
    expect(body.finalAmountCents).toBe(10_000);
    expect(body.alreadyCompleted).toBe(false);
    expect(body.balanceChargeId).toMatch(/^pi_TWIN_/);

    const row = await db.forTenant(tenant.tenantId).appointment.findFirst({ where: { id } });
    expect(row?.completedAt).not.toBeNull();
    expect(row?.tipCents).toBe(1500);
    expect(row?.finalAmountCents).toBe(10_000);
  });

  it('Complete WITHOUT deposit: skips Stripe, balanceChargeId null, finalAmountCents set', async () => {
    const id = await seedStartedAppt({ withDeposit: false });
    const res = await app.inject({
      method: 'POST',
      url: `/appointments/${id}/complete`,
      headers: { cookie: tenant.cookie },
      payload: { tipCents: 0 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      finalAmountCents: number;
      balanceChargeId: string | null;
    };
    expect(body.balanceChargeId).toBeNull();
    expect(body.finalAmountCents).toBe(8500);
  });

  it('Idempotent: second complete call returns same state, no new Stripe PI', async () => {
    const id = await seedStartedAppt({ withDeposit: true });
    const first = await app.inject({
      method: 'POST',
      url: `/appointments/${id}/complete`,
      headers: { cookie: tenant.cookie },
      payload: { tipCents: 1500 },
    });
    expect(first.statusCode).toBe(200);
    const firstId = (first.json() as { balanceChargeId: string | null }).balanceChargeId;

    const second = await app.inject({
      method: 'POST',
      url: `/appointments/${id}/complete`,
      headers: { cookie: tenant.cookie },
      payload: { tipCents: 9999 }, // attempted tip change is ignored
    });
    expect(second.statusCode).toBe(200);
    const body = second.json() as {
      alreadyCompleted: boolean;
      balanceChargeId: string | null;
      appointment: { tipCents: number };
    };
    expect(body.alreadyCompleted).toBe(true);
    expect(body.balanceChargeId).toBe(firstId);
    expect(body.appointment.tipCents).toBe(1500);
  });

  it('Complete on scheduled (not started) appointment → 409 invalid_transition', async () => {
    const start = new Date();
    start.setDate(start.getDate() + 1);
    start.setHours(10, 0, 0, 0);
    const res = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { cookie: tenant.cookie },
      payload: { petId, serviceId, start: start.toISOString() },
    });
    const id = (res.json() as { appointment: { id: string } }).appointment.id;

    const complete = await app.inject({
      method: 'POST',
      url: `/appointments/${id}/complete`,
      headers: { cookie: tenant.cookie },
      payload: { tipCents: 0 },
    });
    expect(complete.statusCode).toBe(409);
    expect((complete.json() as { error: string }).error).toBe('invalid_transition');
  });

  it('Starter tenant CAN mark complete (this is core, not Pro+)', async () => {
    const id = await seedStartedAppt({ withDeposit: false });
    const res = await app.inject({
      method: 'POST',
      url: `/appointments/${id}/complete`,
      headers: { cookie: tenant.cookie },
      payload: { tipCents: 0 },
    });
    expect(res.statusCode).toBe(200);
  });
});
