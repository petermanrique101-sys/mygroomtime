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
} from '../appointments/test-helpers.js';

const SLUG_PREFIX = 'vehicles-test-';

async function promoteToBusiness(tenantId: string): Promise<void> {
  await db.global.tenant.update({
    where: { id: tenantId },
    data: { plan: PlanTier.business },
  });
}

describe('vehicles routes', () => {
  let app: FastifyInstance;
  let geocodeTwin: FastifyInstance;
  let business: TestTenant;
  let starter: TestTenant;

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
    business = await signup(app, SLUG_PREFIX, `vehB-${ts}`, `vehB-${ts}`);
    starter = await signup(app, SLUG_PREFIX, `vehS-${ts}`, `vehS-${ts}`);
    await promoteToBusiness(business.tenantId);
  });

  it('starter tenant POST /vehicles → 403 business_tier_required', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/vehicles',
      headers: { cookie: starter.cookie },
      payload: { name: 'Van 2' },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json() as { error: string; reason: string; requiredPlan: string };
    expect(body.error).toBe('plan_required');
    expect(body.reason).toBe('business_tier_required');
    expect(body.requiredPlan).toBe('business');
  });

  it('starter tenant can GET /vehicles (read is universal)', async () => {
    // first ensure a vehicle exists by creating an appointment
    const { petId } = await createClientAndPet(app, starter);
    const service = await createServiceFor(app, starter);
    await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { cookie: starter.cookie },
      payload: { petId, serviceId: service.id, start: nextWeekdayAt(10) },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/vehicles',
      headers: { cookie: starter.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { vehicles: Array<{ name: string }> };
    expect(body.vehicles.length).toBeGreaterThanOrEqual(1);
  });

  it('business tenant can create + list + update + soft-delete vehicles', async () => {
    // create one appointment so the lazy default van exists
    const { petId } = await createClientAndPet(app, business);
    const service = await createServiceFor(app, business);
    await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { cookie: business.cookie },
      payload: { petId, serviceId: service.id, start: nextWeekdayAt(10) },
    });

    const created = await app.inject({
      method: 'POST',
      url: '/vehicles',
      headers: { cookie: business.cookie },
      payload: { name: 'Van 2' },
    });
    expect(created.statusCode).toBe(201);
    const newVehicle = (created.json() as { vehicle: { id: string; name: string } }).vehicle;
    expect(newVehicle.name).toBe('Van 2');

    const list = await app.inject({
      method: 'GET',
      url: '/vehicles',
      headers: { cookie: business.cookie },
    });
    const vehicles = (list.json() as { vehicles: Array<{ id: string; active: boolean }> })
      .vehicles;
    expect(vehicles.length).toBeGreaterThanOrEqual(2);

    const renamed = await app.inject({
      method: 'PATCH',
      url: `/vehicles/${newVehicle.id}`,
      headers: { cookie: business.cookie },
      payload: { name: 'Van 2 — Maria' },
    });
    expect(renamed.statusCode).toBe(200);

    const del = await app.inject({
      method: 'DELETE',
      url: `/vehicles/${newVehicle.id}`,
      headers: { cookie: business.cookie },
    });
    expect(del.statusCode).toBe(204);
  });

  it('DELETE blocked when last active vehicle would be removed', async () => {
    const { petId } = await createClientAndPet(app, business);
    const service = await createServiceFor(app, business);
    await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { cookie: business.cookie },
      payload: { petId, serviceId: service.id, start: nextWeekdayAt(10) },
    });

    const list = await app.inject({
      method: 'GET',
      url: '/vehicles',
      headers: { cookie: business.cookie },
    });
    const vehicles = (list.json() as { vehicles: Array<{ id: string }> }).vehicles;
    const sole = vehicles[0]!.id;

    const del = await app.inject({
      method: 'DELETE',
      url: `/vehicles/${sole}`,
      headers: { cookie: business.cookie },
    });
    // why: lazy-create-default invariant — must always have one active vehicle. The
    // delete attempt sees a future appt or a "last active" block. Either 409 reason
    // proves the guard fired.
    expect(del.statusCode).toBe(409);
    const body = del.json() as { reason: string };
    expect(['last_active_vehicle', 'future_appointments']).toContain(body.reason);
  });

  it('DELETE blocked when future appointments exist on the vehicle', async () => {
    const { petId } = await createClientAndPet(app, business);
    const service = await createServiceFor(app, business);
    // create a fresh second vehicle so we have 2 active
    const create = await app.inject({
      method: 'POST',
      url: '/vehicles',
      headers: { cookie: business.cookie },
      payload: { name: 'Van 2' },
    });
    const second = (create.json() as { vehicle: { id: string } }).vehicle.id;

    // create an appointment, then re-assign it to the second van
    const a = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { cookie: business.cookie },
      payload: { petId, serviceId: service.id, start: nextWeekdayAt(11) },
    });
    const apptId = (a.json() as { appointment: { id: string } }).appointment.id;

    await app.inject({
      method: 'PATCH',
      url: `/appointments/${apptId}`,
      headers: { cookie: business.cookie },
      payload: { vehicleId: second },
    });

    const del = await app.inject({
      method: 'DELETE',
      url: `/vehicles/${second}`,
      headers: { cookie: business.cookie },
    });
    expect(del.statusCode).toBe(409);
    const body = del.json() as { reason: string; futureAppointmentCount: number };
    expect(body.reason).toBe('future_appointments');
    expect(body.futureAppointmentCount).toBe(1);
  });
});
