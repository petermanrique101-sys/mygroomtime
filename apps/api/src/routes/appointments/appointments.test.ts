import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp as createGeocodeTwinApp } from '@mygroomtime/twin-geocode';
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

const SLUG_PREFIX = 'appts-rud-test-';

describe('appointments routes — read/update/delete', () => {
  let app: FastifyInstance;
  let geocodeTwin: FastifyInstance;
  let tenantA: TestTenant;
  let tenantB: TestTenant;

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
    tenantA = await signup(app, SLUG_PREFIX, `apptA-${ts}`, `apptA-${ts}`);
    tenantB = await signup(app, SLUG_PREFIX, `apptB-${ts}`, `apptB-${ts}`);
  });

  it('GET /appointments only returns appointments in the requesting tenant', async () => {
    const aClient = await createClientAndPet(app, tenantA);
    const aService = await createServiceFor(app, tenantA);
    const bClient = await createClientAndPet(app, tenantB);
    const bService = await createServiceFor(app, tenantB);

    await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { cookie: tenantA.cookie },
      payload: { petId: aClient.petId, serviceId: aService.id, start: nextWeekdayAt(9) },
    });
    await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { cookie: tenantB.cookie },
      payload: { petId: bClient.petId, serviceId: bService.id, start: nextWeekdayAt(11) },
    });

    const from = new Date();
    from.setDate(from.getDate() + 1);
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + 1);

    const listA = await app.inject({
      method: 'GET',
      url: `/appointments?from=${from.toISOString()}&to=${to.toISOString()}`,
      headers: { cookie: tenantA.cookie },
    });
    expect(listA.statusCode).toBe(200);
    const bodyA = listA.json() as { appointments: { id: string }[] };
    expect(bodyA.appointments.length).toBe(1);

    const listB = await app.inject({
      method: 'GET',
      url: `/appointments?from=${from.toISOString()}&to=${to.toISOString()}`,
      headers: { cookie: tenantB.cookie },
    });
    const bodyB = listB.json() as { appointments: { id: string }[] };
    expect(bodyB.appointments.length).toBe(1);
    expect(bodyB.appointments[0]!.id).not.toBe(bodyA.appointments[0]!.id);
  });

  it('Service master changes do not affect existing appointment snapshots', async () => {
    const { petId } = await createClientAndPet(app, tenantA);
    const service = await createServiceFor(app, tenantA);
    const created = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { cookie: tenantA.cookie },
      payload: { petId, serviceId: service.id, start: nextWeekdayAt(15) },
    });
    const id = (created.json() as { appointment: { id: string } }).appointment.id;

    const bumpRes = await app.inject({
      method: 'PATCH',
      url: `/services/${service.id}`,
      headers: { cookie: tenantA.cookie },
      payload: { basePriceCents: 9500 },
    });
    expect(bumpRes.statusCode).toBe(200);

    const fetched = await app.inject({
      method: 'GET',
      url: `/appointments/${id}`,
      headers: { cookie: tenantA.cookie },
    });
    const body = fetched.json() as {
      appointment: { servicePriceCentsSnapshot: number; serviceNameSnapshot: string };
    };
    expect(body.appointment.servicePriceCentsSnapshot).toBe(8500);
    expect(body.appointment.serviceNameSnapshot).toBe('Full Groom');
  });

  it('Soft-deleting the service leaves the appointment loadable with full snapshot fields', async () => {
    const { petId } = await createClientAndPet(app, tenantA);
    const service = await createServiceFor(app, tenantA);
    const created = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { cookie: tenantA.cookie },
      payload: { petId, serviceId: service.id, start: nextWeekdayAt(16) },
    });
    const id = (created.json() as { appointment: { id: string } }).appointment.id;

    const del = await app.inject({
      method: 'DELETE',
      url: `/services/${service.id}`,
      headers: { cookie: tenantA.cookie },
    });
    expect(del.statusCode).toBe(204);

    const fetched = await app.inject({
      method: 'GET',
      url: `/appointments/${id}`,
      headers: { cookie: tenantA.cookie },
    });
    expect(fetched.statusCode).toBe(200);
    const body = fetched.json() as {
      appointment: { serviceNameSnapshot: string; serviceColorSnapshot: string };
    };
    expect(body.appointment.serviceNameSnapshot).toBe('Full Groom');
    expect(body.appointment.serviceColorSnapshot).toBe('#2563eb');
  });

  it('DELETE /appointments/:id — soft-cancels, sets canceledAt, leaves row in place', async () => {
    const { petId } = await createClientAndPet(app, tenantA);
    const service = await createServiceFor(app, tenantA);
    const created = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { cookie: tenantA.cookie },
      payload: { petId, serviceId: service.id, start: nextWeekdayAt(17) },
    });
    const id = (created.json() as { appointment: { id: string } }).appointment.id;

    const del = await app.inject({
      method: 'DELETE',
      url: `/appointments/${id}`,
      headers: { cookie: tenantA.cookie },
    });
    expect(del.statusCode).toBe(204);

    const fetched = await app.inject({
      method: 'GET',
      url: `/appointments/${id}`,
      headers: { cookie: tenantA.cookie },
    });
    expect(fetched.statusCode).toBe(200);
    const body = fetched.json() as { appointment: { status: string; canceledAt: string | null } };
    expect(body.appointment.status).toBe('canceled');
    expect(body.appointment.canceledAt).not.toBeNull();
  });

  it('PATCH /appointments/:id — supports notes update + setting/clearing the override', async () => {
    const { petId } = await createClientAndPet(app, tenantA);
    const service = await createServiceFor(app, tenantA);
    const created = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { cookie: tenantA.cookie },
      payload: { petId, serviceId: service.id, start: nextWeekdayAt(18) },
    });
    const id = (created.json() as { appointment: { id: string } }).appointment.id;

    const notesPatch = await app.inject({
      method: 'PATCH',
      url: `/appointments/${id}`,
      headers: { cookie: tenantA.cookie },
      payload: { notes: 'Gate code 1234' },
    });
    expect(notesPatch.statusCode).toBe(200);
    expect((notesPatch.json() as { appointment: { notes: string } }).appointment.notes).toBe(
      'Gate code 1234',
    );

    const setOverride = await app.inject({
      method: 'PATCH',
      url: `/appointments/${id}`,
      headers: { cookie: tenantA.cookie },
      payload: {
        addressOverride: {
          street: '777 Override Ln',
          city: 'Plano',
          state: 'TX',
          zip: '75093',
        },
      },
    });
    expect(setOverride.statusCode).toBe(200);
    const withOverride = setOverride.json() as {
      appointment: { addressOverride: { zip: string; verified: boolean } | null };
    };
    expect(withOverride.appointment.addressOverride?.zip).toBe('75093');

    const clearOverride = await app.inject({
      method: 'PATCH',
      url: `/appointments/${id}`,
      headers: { cookie: tenantA.cookie },
      payload: { addressOverride: null },
    });
    expect(clearOverride.statusCode).toBe(200);
    const cleared = clearOverride.json() as { appointment: { addressOverride: unknown } };
    expect(cleared.appointment.addressOverride).toBeNull();
  });

  it('GET /appointments rejects ranges over 1 year', async () => {
    const from = new Date('2026-01-01T00:00:00.000Z').toISOString();
    const to = new Date('2027-06-01T00:00:00.000Z').toISOString();
    const res = await app.inject({
      method: 'GET',
      url: `/appointments?from=${from}&to=${to}`,
      headers: { cookie: tenantA.cookie },
    });
    expect(res.statusCode).toBe(400);
  });

  it('Returns 401 without an auth cookie', async () => {
    const from = new Date().toISOString();
    const to = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const res = await app.inject({
      method: 'GET',
      url: `/appointments?from=${from}&to=${to}`,
    });
    expect(res.statusCode).toBe(401);
  });
});
