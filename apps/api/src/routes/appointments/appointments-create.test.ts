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

const SLUG_PREFIX = 'appts-create-test-';

describe('appointments routes — create', () => {
  let app: FastifyInstance;
  let geocodeTwin: FastifyInstance;
  let tenantA: TestTenant;

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
    tenantA = await signup(app, SLUG_PREFIX, `apptC-${ts}`, `apptC-${ts}`);
  });

  it('creates with snapshot fields populated from the service master', async () => {
    const { petId } = await createClientAndPet(app, tenantA);
    const service = await createServiceFor(app, tenantA);

    const start = nextWeekdayAt(10);
    const res = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { cookie: tenantA.cookie },
      payload: { petId, serviceId: service.id, start },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      appointment: {
        id: string;
        serviceNameSnapshot: string;
        servicePriceCentsSnapshot: number;
        serviceDepositCentsSnapshot: number;
        serviceColorSnapshot: string;
        serviceDurationMinSnapshot: number;
        durationMin: number;
        end: string;
      };
    };
    expect(body.appointment.serviceNameSnapshot).toBe('Full Groom');
    expect(body.appointment.servicePriceCentsSnapshot).toBe(8500);
    expect(body.appointment.serviceDepositCentsSnapshot).toBe(2000);
    expect(body.appointment.serviceColorSnapshot).toBe('#2563eb');
    expect(body.appointment.serviceDurationMinSnapshot).toBe(90);
    expect(body.appointment.durationMin).toBe(90);
    const expectedEnd = new Date(new Date(start).getTime() + 90 * 60_000).toISOString();
    expect(body.appointment.end).toBe(expectedEnd);
  });

  it('409 on overlap with another non-canceled appt on same vehicle', async () => {
    const { petId } = await createClientAndPet(app, tenantA);
    const service = await createServiceFor(app, tenantA);

    const start = nextWeekdayAt(10);
    const first = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { cookie: tenantA.cookie },
      payload: { petId, serviceId: service.id, start },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { cookie: tenantA.cookie },
      payload: { petId, serviceId: service.id, start },
    });
    expect(second.statusCode).toBe(409);
    const body = second.json() as { error: string; conflictingId: string };
    expect(body.error).toBe('appointment_overlap');
    expect(body.conflictingId).toBe(
      (first.json() as { appointment: { id: string } }).appointment.id,
    );
  });

  it('Soft-canceled appointment does not block a new one at the same slot', async () => {
    const { petId } = await createClientAndPet(app, tenantA);
    const service = await createServiceFor(app, tenantA);
    const start = nextWeekdayAt(13);

    const created = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { cookie: tenantA.cookie },
      payload: { petId, serviceId: service.id, start },
    });
    const id = (created.json() as { appointment: { id: string } }).appointment.id;

    const cancel = await app.inject({
      method: 'DELETE',
      url: `/appointments/${id}`,
      headers: { cookie: tenantA.cookie },
    });
    expect(cancel.statusCode).toBe(204);

    const retry = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { cookie: tenantA.cookie },
      payload: { petId, serviceId: service.id, start },
    });
    expect(retry.statusCode).toBe(201);
  });

  it('with mutationUuid — replays the same body returns the same row', async () => {
    const { petId } = await createClientAndPet(app, tenantA);
    const service = await createServiceFor(app, tenantA);
    const mutationUuid = '11111111-2222-3333-4444-555555555555';

    const first = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { cookie: tenantA.cookie },
      payload: { petId, serviceId: service.id, start: nextWeekdayAt(8), mutationUuid },
    });
    expect(first.statusCode).toBe(201);
    const firstId = (first.json() as { appointment: { id: string } }).appointment.id;

    const replay = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { cookie: tenantA.cookie },
      payload: { petId, serviceId: service.id, start: nextWeekdayAt(8), mutationUuid },
    });
    expect(replay.statusCode).toBe(200);
    expect((replay.json() as { appointment: { id: string } }).appointment.id).toBe(firstId);
  });

  it('with __ZERO_RESULTS__ override geocode saves unverified with warning', async () => {
    const { petId } = await createClientAndPet(app, tenantA);
    const service = await createServiceFor(app, tenantA);
    const res = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { cookie: tenantA.cookie },
      payload: {
        petId,
        serviceId: service.id,
        start: nextWeekdayAt(12),
        addressOverride: {
          street: '__ZERO_RESULTS__ House',
          city: 'Plano',
          state: 'TX',
          zip: '75093',
        },
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      appointment: { addressOverride: { verified: boolean; lat: number | null } | null };
      warning: { code: string; message: string } | null;
    };
    expect(body.appointment.addressOverride?.verified).toBe(false);
    expect(body.appointment.addressOverride?.lat).toBeNull();
    expect(body.warning?.code).toBe('address_unverified');
  });
});
