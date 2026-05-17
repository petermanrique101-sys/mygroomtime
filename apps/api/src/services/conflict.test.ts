import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp as createGeocodeTwinApp } from '@mygroomtime/twin-geocode';
import { createApp } from '../app.js';
import { createMemorySessionStore } from '../adapters/session/index.js';
import { createStdoutEmailAdapter } from '../adapters/email/index.js';
import { createGeocodeAdapter } from '../adapters/geocode/index.js';
import { makeTestEnv } from '../test-utils/env.js';
import { db } from '@mygroomtime/db';
import {
  cleanupTestTenants,
  createClientAndPet,
  createServiceFor,
  signup,
  type TestTenant,
} from '../routes/appointments/test-helpers.js';
import { ensureDefaultVehicle } from '../routes/appointments/find.js';
import { canPlaceAppointment } from './conflict.js';
import type { GmapsAdapter } from '../adapters/gmaps/index.js';

const SLUG_PREFIX = 'conflict-svc-test-';

function fakeGmaps(durationSec: number, throws = false): GmapsAdapter {
  return {
    mode: 'twin',
    async distanceMatrix({ origins, destinations }) {
      if (throws) throw new Error('boom');
      return {
        rows: origins.map(() =>
          destinations.map(() => ({ durationSec, distanceM: 1000, status: 'OK' as const })),
        ),
      };
    },
  };
}

function plus(minutesFromNow: number): Date {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + minutesFromNow);
  return d;
}

async function seedAppt(
  app: FastifyInstance,
  tenant: TestTenant,
  petId: string,
  serviceId: string,
  start: Date,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/appointments',
    headers: { cookie: tenant.cookie },
    payload: { petId, serviceId, start: start.toISOString() },
  });
  if (res.statusCode !== 201) throw new Error(`seed failed: ${res.statusCode} ${res.body}`);
  return (res.json() as { appointment: { id: string } }).appointment.id;
}

describe('canPlaceAppointment', () => {
  let app: FastifyInstance;
  let geocodeTwin: FastifyInstance;
  let tenant: TestTenant;
  let petId: string;
  let serviceId: string;
  let vehicleId: string;

  beforeAll(async () => {
    geocodeTwin = createGeocodeTwinApp({ logger: false });
    await geocodeTwin.listen({ port: 0, host: '127.0.0.1' });
    const port = (geocodeTwin.server.address() as { port: number }).port;
    const geocodeTwinUrl = `http://127.0.0.1:${port}`;
    app = await createApp({
      logger: false,
      env: makeTestEnv(),
      sessionStore: createMemorySessionStore(),
      emailAdapter: createStdoutEmailAdapter(),
      adapters: {
        geocode: createGeocodeAdapter({ mode: 'twin', apiKey: '', twinUrl: geocodeTwinUrl }),
      },
    });
  });

  afterAll(async () => {
    await cleanupTestTenants(SLUG_PREFIX);
    await app.close();
    await geocodeTwin.close();
  });

  beforeEach(async () => {
    await cleanupTestTenants(SLUG_PREFIX);
    const ts = Date.now();
    tenant = await signup(app, SLUG_PREFIX, `cf-${ts}`, `cf-${ts}`);
    const cp = await createClientAndPet(app, tenant);
    petId = cp.petId;
    const svc = await createServiceFor(app, tenant);
    serviceId = svc.id;
    const scoped = db.forTenant(tenant.tenantId);
    vehicleId = await ensureDefaultVehicle(scoped);
  });

  it('past — rejects a start in the past', async () => {
    const scoped = db.forTenant(tenant.tenantId);
    const res = await canPlaceAppointment({
      scoped,
      vehicleId,
      appointmentId: null,
      start: plus(-60),
      durationMin: 90,
      gmaps: fakeGmaps(600),
      defaultBufferMin: 15,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('past');
  });

  it('overlap — straight time-range overlap with another appt on same vehicle', async () => {
    const start = plus(120);
    await seedAppt(app, tenant, petId, serviceId, start);
    const scoped = db.forTenant(tenant.tenantId);
    const res = await canPlaceAppointment({
      scoped,
      vehicleId,
      appointmentId: null,
      start: new Date(start.getTime() + 10 * 60_000),
      durationMin: 90,
      gmaps: fakeGmaps(600),
      defaultBufferMin: 15,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('overlap');
  });

  it('valid — fits cleanly after the only appointment with buffer respected', async () => {
    const start = plus(120);
    await seedAppt(app, tenant, petId, serviceId, start);
    const scoped = db.forTenant(tenant.tenantId);
    const proposedStart = new Date(start.getTime() + (90 + 60) * 60_000);
    const res = await canPlaceAppointment({
      scoped,
      vehicleId,
      appointmentId: null,
      start: proposedStart,
      durationMin: 60,
      gmaps: fakeGmaps(600),
      defaultBufferMin: 15,
    });
    expect(res.ok).toBe(true);
  });

  it('buffer (after-neighbor too close) — new slot ends inside drive-time window', async () => {
    const first = plus(180);
    await seedAppt(app, tenant, petId, serviceId, first);
    const scoped = db.forTenant(tenant.tenantId);
    const proposedStart = new Date(first.getTime() - 90 * 60_000);
    const res = await canPlaceAppointment({
      scoped,
      vehicleId,
      appointmentId: null,
      start: proposedStart,
      durationMin: 85,
      gmaps: fakeGmaps(600),
      defaultBufferMin: 30,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('buffer');
  });

  it('buffer (before-neighbor too close) — new slot starts inside drive-time window', async () => {
    const first = plus(180);
    await seedAppt(app, tenant, petId, serviceId, first);
    const scoped = db.forTenant(tenant.tenantId);
    const proposedStart = new Date(first.getTime() + 91 * 60_000);
    const res = await canPlaceAppointment({
      scoped,
      vehicleId,
      appointmentId: null,
      start: proposedStart,
      durationMin: 30,
      gmaps: fakeGmaps(600),
      defaultBufferMin: 30,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('buffer');
  });

  it('self — moving an appointment is not blocked by itself', async () => {
    const start = plus(150);
    const id = await seedAppt(app, tenant, petId, serviceId, start);
    const scoped = db.forTenant(tenant.tenantId);
    const res = await canPlaceAppointment({
      scoped,
      vehicleId,
      appointmentId: id,
      start,
      durationMin: 90,
      gmaps: fakeGmaps(600),
      defaultBufferMin: 15,
    });
    expect(res.ok).toBe(true);
  });
});
