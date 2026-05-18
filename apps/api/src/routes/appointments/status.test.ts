import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp as createGeocodeTwinApp } from '@mygroomtime/twin-geocode';
import { createApp as createGmapsTwinApp } from '@mygroomtime/twin-google-maps';
import { createApp as createTwilioTwinApp, type TwinAppHandle } from '@mygroomtime/twin-twilio';
import { db, PlanTier, AppointmentStatus } from '@mygroomtime/db';
import { createApp } from '../../app.js';
import { createMemorySessionStore } from '../../adapters/session/index.js';
import { createStdoutEmailAdapter } from '../../adapters/email/index.js';
import { createGeocodeAdapter } from '../../adapters/geocode/index.js';
import { createGmapsAdapter } from '../../adapters/gmaps/index.js';
import { createTwilioAdapter } from '../../adapters/twilio/index.js';
import { makeTestEnv } from '../../test-utils/env.js';
import {
  cleanupTestTenants,
  createClientAndPet,
  createServiceFor,
  signup,
  type TestTenant,
} from './test-helpers.js';

const SLUG_PREFIX = 'appts-status-test-';
const FROM = '+15555550150';
const AUTH = 'auth_status_twin';
const SID = 'AC_status_twin';

describe('PATCH /appointments/:id/status', () => {
  let app: FastifyInstance;
  let geocodeTwin: FastifyInstance;
  let gmapsTwin: FastifyInstance;
  let twilioTwin: TwinAppHandle;
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

    twilioTwin = createTwilioTwinApp({ logger: false, authToken: AUTH, fromNumber: FROM });
    await twilioTwin.app.listen({ port: 0, host: '127.0.0.1' });
    const addr = twilioTwin.app.server.address();
    if (!addr || typeof addr === 'string') throw new Error('twin address missing');
    const twilioUrl = `http://127.0.0.1:${addr.port}`;

    app = await createApp({
      logger: false,
      env: makeTestEnv(),
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
        twilio: createTwilioAdapter({
          mode: 'twin',
          accountSid: SID,
          authToken: AUTH,
          fromNumber: FROM,
          twinUrl: twilioUrl,
        }),
      },
    });
  });

  afterAll(async () => {
    await cleanupTestTenants(SLUG_PREFIX);
    await app.close();
    await geocodeTwin.close();
    await gmapsTwin.close();
    await twilioTwin.app.close();
  });

  beforeEach(async () => {
    await cleanupTestTenants(SLUG_PREFIX);
    await twilioTwin.app.inject({ method: 'POST', url: '/__twin_reset' });
    const ts = Date.now() + Math.floor(Math.random() * 1000);
    tenant = await signup(app, SLUG_PREFIX, `st-${ts}`, `st-${ts}`);
    await db.global.tenant.update({
      where: { id: tenant.tenantId },
      data: { plan: PlanTier.pro, phone: '+19725550100' },
    });
    const cp = await createClientAndPet(app, tenant);
    petId = cp.petId;
    const svc = await createServiceFor(app, tenant);
    serviceId = svc.id;
  });

  async function seedAppt(status: AppointmentStatus = AppointmentStatus.scheduled): Promise<string> {
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
    if (status !== AppointmentStatus.scheduled) {
      const scoped = db.forTenant(tenant.tenantId);
      await scoped.appointment.update({ where: { id }, data: { status } });
    }
    return id;
  }

  it('scheduled → on_the_way sets status + onTheWayAt, fires no SMS', async () => {
    const id = await seedAppt();
    const res = await app.inject({
      method: 'PATCH',
      url: `/appointments/${id}/status`,
      headers: { cookie: tenant.cookie },
      payload: { status: 'on_the_way' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { appointment: { status: string } };
    expect(body.appointment.status).toBe('on_the_way');

    const row = await db.forTenant(tenant.tenantId).appointment.findFirst({ where: { id } });
    expect(row?.onTheWayAt).not.toBeNull();

    const log = await twilioTwin.app.inject({ method: 'GET', url: '/__twin_messages' });
    const messages = (log.json() as { messages: unknown[] }).messages;
    expect(messages).toHaveLength(0);
  });

  it('scheduled → started sets status + startedAt', async () => {
    const id = await seedAppt();
    const res = await app.inject({
      method: 'PATCH',
      url: `/appointments/${id}/status`,
      headers: { cookie: tenant.cookie },
      payload: { status: 'started' },
    });
    expect(res.statusCode).toBe(200);
    const row = await db.forTenant(tenant.tenantId).appointment.findFirst({ where: { id } });
    expect(row?.startedAt).not.toBeNull();
    expect(row?.status).toBe('started');
  });

  it('started → on_the_way is rejected with 409 invalid_edge', async () => {
    const id = await seedAppt(AppointmentStatus.started);
    const res = await app.inject({
      method: 'PATCH',
      url: `/appointments/${id}/status`,
      headers: { cookie: tenant.cookie },
      payload: { status: 'on_the_way' },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: string; reason: string };
    expect(body.error).toBe('invalid_transition');
    expect(body.reason).toBe('invalid_edge');
  });

  it('no_show fires SMS via twilio twin with deposit-retention copy', async () => {
    const id = await seedAppt();
    const res = await app.inject({
      method: 'PATCH',
      url: `/appointments/${id}/status`,
      headers: { cookie: tenant.cookie },
      payload: { status: 'no_show' },
    });
    expect(res.statusCode).toBe(200);
    const row = await db.forTenant(tenant.tenantId).appointment.findFirst({ where: { id } });
    expect(row?.noShowAt).not.toBeNull();
    expect(row?.status).toBe('no_show');

    const log = await twilioTwin.app.inject({ method: 'GET', url: '/__twin_messages' });
    const messages = (log.json() as { messages: Array<{ body: string }> }).messages;
    expect(messages).toHaveLength(1);
    expect(messages[0]!.body).toMatch(/deposit was retained/i);
    expect(messages[0]!.body).toMatch(/\$20/);
  });

  it('no_show does NOT refund the deposit', async () => {
    const id = await seedAppt();
    // Seed a depositChargeId so we can confirm it stays untouched
    const scoped = db.forTenant(tenant.tenantId);
    await scoped.appointment.update({
      where: { id },
      data: { depositChargeId: 'pi_TWIN_test_deposit' },
    });
    await app.inject({
      method: 'PATCH',
      url: `/appointments/${id}/status`,
      headers: { cookie: tenant.cookie },
      payload: { status: 'no_show' },
    });
    const row = await scoped.appointment.findFirst({ where: { id } });
    expect(row?.depositChargeId).toBe('pi_TWIN_test_deposit');
  });

  it('canceled → on_the_way (terminal) returns 409 terminal', async () => {
    const id = await seedAppt(AppointmentStatus.canceled);
    const res = await app.inject({
      method: 'PATCH',
      url: `/appointments/${id}/status`,
      headers: { cookie: tenant.cookie },
      payload: { status: 'on_the_way' },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { reason: string }).reason).toBe('terminal');
  });

  it('Starter tenant can still mark on_the_way (not Pro+ gated)', async () => {
    await db.global.tenant.update({
      where: { id: tenant.tenantId },
      data: { plan: PlanTier.starter },
    });
    const id = await seedAppt();
    const res = await app.inject({
      method: 'PATCH',
      url: `/appointments/${id}/status`,
      headers: { cookie: tenant.cookie },
      payload: { status: 'on_the_way' },
    });
    expect(res.statusCode).toBe(200);
  });
});
