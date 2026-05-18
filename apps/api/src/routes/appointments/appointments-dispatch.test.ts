import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp as createGeocodeTwinApp } from '@mygroomtime/twin-geocode';
import { db, PlanTier } from '@mygroomtime/db';
import { createApp } from '../../app.js';
import { createMemorySessionStore } from '../../adapters/session/index.js';
import { createStdoutEmailAdapter } from '../../adapters/email/index.js';
import { createGeocodeAdapter } from '../../adapters/geocode/index.js';
import { makeTestEnv } from '../../test-utils/env.js';
import {
  cleanupTestTenants,
  createClientAndPet,
  createServiceFor,
  nextWeekdayAt,
  signup,
  type TestTenant,
} from './test-helpers.js';

const SLUG_PREFIX = 'appts-dispatch-test-';

describe('appointments routes — cross-vehicle dispatch', () => {
  let app: FastifyInstance;
  let geocodeTwin: FastifyInstance;
  let business: TestTenant;

  beforeAll(async () => {
    geocodeTwin = createGeocodeTwinApp({ logger: false });
    await geocodeTwin.listen({ port: 0, host: '127.0.0.1' });
    const port = (geocodeTwin.server.address() as { port: number }).port;
    const geocodeTwinUrl = `http://127.0.0.1:${port}`;
    const env = makeTestEnv();
    app = await createApp({
      logger: false,
      env,
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
    business = await signup(app, SLUG_PREFIX, `apptD-${ts}`, `apptD-${ts}`);
    await db.global.tenant.update({
      where: { id: business.tenantId },
      data: { plan: PlanTier.business },
    });
  });

  it('PATCH vehicleId moves the appointment to the destination van', async () => {
    const { petId } = await createClientAndPet(app, business);
    const service = await createServiceFor(app, business);
    // create an appointment — lazy-creates the first vehicle
    const created = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { cookie: business.cookie },
      payload: { petId, serviceId: service.id, start: nextWeekdayAt(10) },
    });
    expect(created.statusCode).toBe(201);
    const apptId = (created.json() as { appointment: { id: string; vehicleId: string } })
      .appointment.id;

    // create Van 2 with a second user assigned (we'll just use the same owner for simplicity)
    const owner = await db.forTenant(business.tenantId).user.findFirst({ where: {} });
    const v2 = await app.inject({
      method: 'POST',
      url: '/vehicles',
      headers: { cookie: business.cookie },
      payload: { name: 'Van 2', assignedGroomerId: owner!.id },
    });
    const van2 = (v2.json() as { vehicle: { id: string; assignedGroomerId: string | null } })
      .vehicle;

    const moved = await app.inject({
      method: 'PATCH',
      url: `/appointments/${apptId}`,
      headers: { cookie: business.cookie },
      payload: { vehicleId: van2.id },
    });
    expect(moved.statusCode).toBe(200);
    const body = moved.json() as {
      appointment: { vehicleId: string; groomerId: string | null };
    };
    expect(body.appointment.vehicleId).toBe(van2.id);
    // groomer inherits the destination vehicle's assigned driver
    expect(body.appointment.groomerId).toBe(van2.assignedGroomerId);
  });

  it('PATCH vehicleId preserves an explicit groomerId override', async () => {
    const { petId } = await createClientAndPet(app, business);
    const service = await createServiceFor(app, business);
    const created = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { cookie: business.cookie },
      payload: { petId, serviceId: service.id, start: nextWeekdayAt(11) },
    });
    const apptId = (created.json() as { appointment: { id: string } }).appointment.id;

    const owner = await db.forTenant(business.tenantId).user.findFirst({ where: {} });
    const v2 = await app.inject({
      method: 'POST',
      url: '/vehicles',
      headers: { cookie: business.cookie },
      payload: { name: 'Van 2' }, // no assigned driver
    });
    const van2id = (v2.json() as { vehicle: { id: string } }).vehicle.id;

    const moved = await app.inject({
      method: 'PATCH',
      url: `/appointments/${apptId}`,
      headers: { cookie: business.cookie },
      payload: { vehicleId: van2id, groomerId: owner!.id },
    });
    expect(moved.statusCode).toBe(200);
    const body = moved.json() as {
      appointment: { vehicleId: string; groomerId: string | null };
    };
    expect(body.appointment.vehicleId).toBe(van2id);
    expect(body.appointment.groomerId).toBe(owner!.id);
  });

  it('PATCH vehicleId to an inactive/missing van returns 404', async () => {
    const { petId } = await createClientAndPet(app, business);
    const service = await createServiceFor(app, business);
    const created = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { cookie: business.cookie },
      payload: { petId, serviceId: service.id, start: nextWeekdayAt(12) },
    });
    const apptId = (created.json() as { appointment: { id: string } }).appointment.id;

    const moved = await app.inject({
      method: 'PATCH',
      url: `/appointments/${apptId}`,
      headers: { cookie: business.cookie },
      payload: { vehicleId: 'nope-not-a-real-id' },
    });
    expect(moved.statusCode).toBe(404);
    expect((moved.json() as { error: string }).error).toBe('vehicle_not_found');
  });
});
