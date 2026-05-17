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
  signup,
  type TestTenant,
} from './test-helpers.js';

const SLUG_PREFIX = 'appts-reschedule-test-';

function plusMinutes(d: Date, m: number): Date {
  return new Date(d.getTime() + m * 60_000);
}

function tomorrowAt(hour: number, minute = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, minute, 0, 0);
  return d;
}

describe('PATCH /appointments/:id — start rescheduling', () => {
  let app: FastifyInstance;
  let geocodeTwin: FastifyInstance;
  let tenant: TestTenant;
  let petId: string;
  let serviceId: string;

  beforeAll(async () => {
    geocodeTwin = createGeocodeTwinApp({ logger: false });
    await geocodeTwin.listen({ port: 0, host: '127.0.0.1' });
    const port = (geocodeTwin.server.address() as { port: number }).port;
    app = await createApp({
      logger: false,
      env: makeTestEnv(),
      sessionStore: createMemorySessionStore(),
      emailAdapter: createStdoutEmailAdapter(),
      adapters: {
        geocode: createGeocodeAdapter({
          mode: 'twin',
          apiKey: '',
          twinUrl: `http://127.0.0.1:${port}`,
        }),
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
    tenant = await signup(app, SLUG_PREFIX, `rs-${ts}`, `rs-${ts}`);
    const cp = await createClientAndPet(app, tenant);
    petId = cp.petId;
    const svc = await createServiceFor(app, tenant);
    serviceId = svc.id;
  });

  async function seedAppt(start: Date): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { cookie: tenant.cookie },
      payload: { petId, serviceId, start: start.toISOString() },
    });
    if (res.statusCode !== 201) throw new Error(`create failed: ${res.statusCode} ${res.body}`);
    return (res.json() as { appointment: { id: string } }).appointment.id;
  }

  it('valid new start — 200, persisted, duration snapshot unchanged', async () => {
    const start = tomorrowAt(9);
    const id = await seedAppt(start);
    const newStart = plusMinutes(start, 60);

    const res = await app.inject({
      method: 'PATCH',
      url: `/appointments/${id}`,
      headers: { cookie: tenant.cookie },
      payload: { start: newStart.toISOString() },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      appointment: { start: string; serviceDurationMinSnapshot: number; durationMin: number };
    };
    expect(new Date(body.appointment.start).getTime()).toBe(newStart.getTime());
    expect(body.appointment.serviceDurationMinSnapshot).toBe(90);
    expect(body.appointment.durationMin).toBe(90);
  });

  it('conflicting new start (overlap) — 409 with reason=overlap', async () => {
    const a = tomorrowAt(9);
    const b = tomorrowAt(13);
    await seedAppt(a);
    const idB = await seedAppt(b);

    const overlapping = plusMinutes(a, 30);
    const res = await app.inject({
      method: 'PATCH',
      url: `/appointments/${idB}`,
      headers: { cookie: tenant.cookie },
      payload: { start: overlapping.toISOString() },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as {
      error: string;
      reason: string;
      detail: { neighborPetName: string | null };
    };
    expect(body.error).toBe('appointment_conflict');
    expect(body.reason).toBe('overlap');
    expect(body.detail.neighborPetName).toBeTruthy();
  });

  it('moving to the past — 409 with reason=past', async () => {
    const id = await seedAppt(tomorrowAt(9));
    const past = new Date(Date.now() - 60 * 60_000);
    const res = await app.inject({
      method: 'PATCH',
      url: `/appointments/${id}`,
      headers: { cookie: tenant.cookie },
      payload: { start: past.toISOString() },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { reason: string };
    expect(body.reason).toBe('past');
  });

  it('PATCH with same start as existing — 200, no conflict check explosion', async () => {
    const start = tomorrowAt(9);
    const id = await seedAppt(start);
    const res = await app.inject({
      method: 'PATCH',
      url: `/appointments/${id}`,
      headers: { cookie: tenant.cookie },
      payload: { start: start.toISOString() },
    });
    expect(res.statusCode).toBe(200);
  });

  it('PATCH notes + start together — both apply', async () => {
    const id = await seedAppt(tomorrowAt(10));
    const newStart = tomorrowAt(11);
    const res = await app.inject({
      method: 'PATCH',
      url: `/appointments/${id}`,
      headers: { cookie: tenant.cookie },
      payload: { start: newStart.toISOString(), notes: 'Side gate' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { appointment: { start: string; notes: string } };
    expect(new Date(body.appointment.start).getTime()).toBe(newStart.getTime());
    expect(body.appointment.notes).toBe('Side gate');
  });
});
