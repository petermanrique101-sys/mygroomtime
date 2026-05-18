import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp as createGeocodeTwinApp } from '@mygroomtime/twin-geocode';
import { createApp as createGmapsTwinApp } from '@mygroomtime/twin-google-maps';
import { db, PlanTier, AppointmentStatus } from '@mygroomtime/db';
import { createApp } from '../../app.js';
import { createMemorySessionStore } from '../../adapters/session/index.js';
import { createStdoutEmailAdapter } from '../../adapters/email/index.js';
import { createGeocodeAdapter } from '../../adapters/geocode/index.js';
import { createGmapsAdapter } from '../../adapters/gmaps/index.js';
import { makeTestEnv } from '../../test-utils/env.js';
import {
  cleanupTestTenants,
  createClientAndPet,
  createServiceFor,
  signup,
  type TestTenant,
} from './test-helpers.js';

const SLUG_PREFIX = 'appts-rebook-test-';

describe('POST /appointments/:id/rebook', () => {
  let app: FastifyInstance;
  let geocodeTwin: FastifyInstance;
  let gmapsTwin: FastifyInstance;
  let tenant: TestTenant;
  let petId: string;
  let clientId: string;
  let serviceId: string;

  beforeAll(async () => {
    geocodeTwin = createGeocodeTwinApp({ logger: false });
    await geocodeTwin.listen({ port: 0, host: '127.0.0.1' });
    const geocodePort = (geocodeTwin.server.address() as { port: number }).port;

    gmapsTwin = createGmapsTwinApp({ logger: false });
    await gmapsTwin.listen({ port: 0, host: '127.0.0.1' });
    const gmapsPort = (gmapsTwin.server.address() as { port: number }).port;

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
      },
    });
  });

  afterAll(async () => {
    await cleanupTestTenants(SLUG_PREFIX);
    await app.close();
    await geocodeTwin.close();
    await gmapsTwin.close();
  });

  beforeEach(async () => {
    await cleanupTestTenants(SLUG_PREFIX);
    const ts = Date.now() + Math.floor(Math.random() * 1000);
    tenant = await signup(app, SLUG_PREFIX, `rb-${ts}`, `rb-${ts}`);
    await db.global.tenant.update({
      where: { id: tenant.tenantId },
      data: { plan: PlanTier.starter },
    });
    const cp = await createClientAndPet(app, tenant);
    petId = cp.petId;
    clientId = cp.clientId;
    const svc = await createServiceFor(app, tenant);
    serviceId = svc.id;
  });

  async function seedCompletedAppt(daysFromNow = 1): Promise<string> {
    const start = new Date();
    start.setDate(start.getDate() + daysFromNow);
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
        status: AppointmentStatus.completed,
        completedAt: new Date(),
        tipCents: 0,
        finalAmountCents: 8500,
      },
    });
    return id;
  }

  it('First rebook: creates a new RecurringSeries + a future Appointment at +6 weeks', async () => {
    const parentId = await seedCompletedAppt();
    const res = await app.inject({
      method: 'POST',
      url: `/appointments/${parentId}/rebook`,
      headers: { cookie: tenant.cookie },
      payload: { intervalWeeks: 6 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      recurringSeries: { id: string; intervalWeeks: number };
      nextAppointment: { id: string; start: string };
      reusedSeries: boolean;
    };
    expect(body.recurringSeries.intervalWeeks).toBe(6);
    expect(body.reusedSeries).toBe(false);

    const scoped = db.forTenant(tenant.tenantId);
    const parent = await scoped.appointment.findFirst({ where: { id: parentId } });
    const next = await scoped.appointment.findFirst({ where: { id: body.nextAppointment.id } });
    expect(next?.scheduledStart.getTime()).toBe(
      parent!.scheduledStart.getTime() + 6 * 7 * 24 * 60 * 60 * 1000,
    );
    expect(next?.recurringSeriesId).toBe(body.recurringSeries.id);
  });

  it('Second rebook with same interval reuses the existing RecurringSeries', async () => {
    const parent1 = await seedCompletedAppt();
    const first = await app.inject({
      method: 'POST',
      url: `/appointments/${parent1}/rebook`,
      headers: { cookie: tenant.cookie },
      payload: { intervalWeeks: 6 },
    });
    expect(first.statusCode).toBe(201);
    const firstBody = first.json() as { recurringSeries: { id: string } };

    // Complete the child appointment + rebook again
    const childId = (first.json() as { nextAppointment: { id: string } }).nextAppointment.id;
    const scoped = db.forTenant(tenant.tenantId);
    await scoped.appointment.update({
      where: { id: childId },
      data: {
        status: AppointmentStatus.completed,
        completedAt: new Date(),
        tipCents: 0,
        finalAmountCents: 8500,
      },
    });

    const second = await app.inject({
      method: 'POST',
      url: `/appointments/${childId}/rebook`,
      headers: { cookie: tenant.cookie },
      payload: { intervalWeeks: 6 },
    });
    expect(second.statusCode).toBe(201);
    const secondBody = second.json() as {
      recurringSeries: { id: string };
      reusedSeries: boolean;
    };
    expect(secondBody.reusedSeries).toBe(true);
    expect(secondBody.recurringSeries.id).toBe(firstBody.recurringSeries.id);
  });

  it('Snapshot copy: new appointment gets snapshot from parent, NOT live Service master', async () => {
    const parentId = await seedCompletedAppt();
    // Reprice the live service after parent was booked
    const scoped = db.forTenant(tenant.tenantId);
    await scoped.service.update({
      where: { id: serviceId },
      data: { basePriceCents: 99_999, color: '#ff0000', name: 'Renamed' },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/appointments/${parentId}/rebook`,
      headers: { cookie: tenant.cookie },
      payload: { intervalWeeks: 4 },
    });
    expect(res.statusCode).toBe(201);
    const nextId = (res.json() as { nextAppointment: { id: string } }).nextAppointment.id;
    const next = await scoped.appointment.findFirst({ where: { id: nextId } });
    // The new appointment must NOT carry the new live values
    expect(next?.servicePriceCentsSnapshot).toBe(8500);
    expect(next?.serviceColorSnapshot).not.toBe('#ff0000');
    expect(next?.serviceNameSnapshot).not.toBe('Renamed');
  });

  it('Rebook a not-yet-completed appointment → 409 not_completed', async () => {
    const start = new Date();
    start.setDate(start.getDate() + 1);
    start.setHours(10, 0, 0, 0);
    const created = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { cookie: tenant.cookie },
      payload: { petId, serviceId, start: start.toISOString() },
    });
    const id = (created.json() as { appointment: { id: string } }).appointment.id;

    const res = await app.inject({
      method: 'POST',
      url: `/appointments/${id}/rebook`,
      headers: { cookie: tenant.cookie },
      payload: { intervalWeeks: 6 },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe('not_completed');
  });

  it('Conflict: future slot already taken → 409 rebook_conflict with detail', async () => {
    const parentId = await seedCompletedAppt();
    // Find parent start, then create a competing appointment at parent + 4 weeks
    const scoped = db.forTenant(tenant.tenantId);
    const parent = await scoped.appointment.findFirst({ where: { id: parentId } });
    const competingStart = new Date(parent!.scheduledStart.getTime() + 4 * 7 * 24 * 60 * 60 * 1000);
    await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { cookie: tenant.cookie },
      payload: { petId, serviceId, start: competingStart.toISOString() },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/appointments/${parentId}/rebook`,
      headers: { cookie: tenant.cookie },
      payload: { intervalWeeks: 4 },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: string; conflict: { reason: string } };
    expect(body.error).toBe('rebook_conflict');
    expect(['overlap', 'buffer']).toContain(body.conflict.reason);

    // Confirm no new RecurringSeries was created
    const seriesCount = await scoped.recurringSeries.count({
      where: { clientId },
    });
    expect(seriesCount).toBe(0);
  });
});
