import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { createApp as createGeocodeTwinApp } from '@mygroomtime/twin-geocode';
import { createApp as createGmapsTwinApp } from '@mygroomtime/twin-google-maps';
import {
  createApp as createStripeTwinApp,
  type TwinAppHandle as StripeTwinHandle,
} from '@mygroomtime/twin-stripe';
import { db, PlanTier, AppointmentStatus } from '@mygroomtime/db';
import { createApp } from '../app.js';
import { createMemorySessionStore } from '../adapters/session/index.js';
import { createStdoutEmailAdapter } from '../adapters/email/index.js';
import { createGeocodeAdapter } from '../adapters/geocode/index.js';
import { createGmapsAdapter } from '../adapters/gmaps/index.js';
import { createStripeAdapter } from '../adapters/stripe/index.js';
import { makeTestEnv } from '../test-utils/env.js';
import {
  cleanupTestTenants,
  createClientAndPet,
  createServiceFor,
  signup,
  type TestTenant,
} from '../routes/appointments/test-helpers.js';

const SLUG_PREFIX = 'mut-dedupe-test-';
const WEBHOOK_SECRET = 'whsec_mut_dedupe_test';

describe('mutation-dedupe middleware', () => {
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
    tenant = await signup(app, SLUG_PREFIX, `md-${ts}`, `md-${ts}`);
    await db.global.tenant.update({
      where: { id: tenant.tenantId },
      data: {
        plan: PlanTier.starter,
        stripeConnectAccountId: 'acct_TWIN_dedupe',
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
        depositChargeId: opts.withDeposit ? 'pi_TWIN_deposit_dedupe' : null,
      },
    });
    return id;
  }

  // why: poll the MutationLog table because the row is written in onResponse, which fires
  // *after* the HTTP response is acknowledged by the test runner. Waiting ~200ms is plenty;
  // in practice the row is there within a tick or two.
  async function waitForLog(mutationId: string, timeoutMs = 1000): Promise<{
    statusCode: number;
    status: string;
    resultPayloadJson: unknown;
  } | null> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const row = await db.global.mutationLog.findUnique({ where: { id: mutationId } });
      if (row) {
        return {
          statusCode: row.statusCode,
          status: row.status,
          resultPayloadJson: row.resultPayloadJson,
        };
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    return null;
  }

  it('replay: same mutation id returns the same payload without re-executing', async () => {
    const mutationId = randomUUID();
    const start = new Date();
    start.setDate(start.getDate() + 2);
    start.setHours(11, 0, 0, 0);

    const first = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { cookie: tenant.cookie, 'x-mutation-id': mutationId },
      payload: { petId, serviceId, start: start.toISOString() },
    });
    expect(first.statusCode).toBe(201);
    const firstBody = first.json() as { appointment: { id: string } };
    const firstId = firstBody.appointment.id;

    await waitForLog(mutationId);

    const second = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { cookie: tenant.cookie, 'x-mutation-id': mutationId },
      payload: { petId, serviceId, start: start.toISOString() },
    });
    expect(second.statusCode).toBe(201);
    const secondBody = second.json() as { appointment: { id: string } };
    expect(secondBody.appointment.id).toBe(firstId);

    const rows = await db
      .forTenant(tenant.tenantId)
      .appointment.findMany({ where: { id: firstId } });
    expect(rows).toHaveLength(1);
  });

  it('replay of a failed mutation returns the same 4xx without re-running the handler', async () => {
    const mutationId = randomUUID();

    const first = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { cookie: tenant.cookie, 'x-mutation-id': mutationId },
      payload: { petId, serviceId, start: 'not-a-date' },
    });
    expect(first.statusCode).toBe(400);
    await waitForLog(mutationId);

    const second = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { cookie: tenant.cookie, 'x-mutation-id': mutationId },
      payload: { petId, serviceId, start: new Date().toISOString() },
    });
    expect(second.statusCode).toBe(400);
  });

  it('missing X-Mutation-Id returns 400 when the test opts out of auto-generate', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { cookie: tenant.cookie, 'x-test-skip-mutation-autogen': '1' },
      payload: { petId, serviceId, start: new Date().toISOString() },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { reason: string }).reason).toBe('mutation_id_required');
  });

  it('mutation-dedupe is not applied to GET endpoints (no header required)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/appointments?from=2026-01-01T00:00:00.000Z&to=2026-12-31T00:00:00.000Z',
      headers: { cookie: tenant.cookie, 'x-test-skip-mutation-autogen': '1' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('Complete-flow replay produces one Stripe PI and the same balance capture', async () => {
    const apptId = await seedStartedAppt({ withDeposit: true });
    const mutationId = randomUUID();

    const first = await app.inject({
      method: 'POST',
      url: `/appointments/${apptId}/complete`,
      headers: { cookie: tenant.cookie, 'x-mutation-id': mutationId },
      payload: { tipCents: 1500 },
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json() as {
      finalAmountCents: number;
      balanceChargeId: string | null;
    };
    expect(firstBody.balanceChargeId).toMatch(/^pi_TWIN_/);
    const firstPi = firstBody.balanceChargeId!;
    await waitForLog(mutationId);

    const second = await app.inject({
      method: 'POST',
      url: `/appointments/${apptId}/complete`,
      headers: { cookie: tenant.cookie, 'x-mutation-id': mutationId },
      payload: { tipCents: 9999 },
    });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json() as { balanceChargeId: string | null };
    expect(secondBody.balanceChargeId).toBe(firstPi);

    const row = await db
      .forTenant(tenant.tenantId)
      .appointment.findFirst({ where: { id: apptId } });
    expect(row?.tipCents).toBe(1500);
    expect(row?.finalAmountCents).toBe(10_000);
    expect(row?.balanceChargeId).toBe(firstPi);
  });

  it('cross-tenant replay of an id used by another account returns 400', async () => {
    const mutationId = randomUUID();
    const first = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { cookie: tenant.cookie, 'x-mutation-id': mutationId },
      payload: { petId, serviceId, start: new Date(Date.now() + 24 * 60 * 60_000).toISOString() },
    });
    expect(first.statusCode).toBe(201);
    await waitForLog(mutationId);

    const ts = Date.now() + Math.floor(Math.random() * 1000);
    const other = await signup(app, SLUG_PREFIX, `other-${ts}`, `other-${ts}`);
    await db.global.tenant.update({
      where: { id: other.tenantId },
      data: { plan: PlanTier.starter },
    });
    const cp = await createClientAndPet(app, other);
    const svc = await createServiceFor(app, other);

    const cross = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { cookie: other.cookie, 'x-mutation-id': mutationId },
      payload: { petId: cp.petId, serviceId: svc.id, start: new Date(Date.now() + 24 * 60 * 60_000).toISOString() },
    });
    expect(cross.statusCode).toBe(400);
    expect((cross.json() as { reason: string }).reason).toBe('mutation_id_conflict');
  });
});
