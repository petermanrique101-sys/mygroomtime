import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp as createGeocodeTwinApp } from '@mygroomtime/twin-geocode';
import { db, PlanTier } from '@mygroomtime/db';
import { createApp, type ReminderInfra } from '../../app.js';
import { createMemorySessionStore } from '../../adapters/session/index.js';
import { createStdoutEmailAdapter } from '../../adapters/email/index.js';
import { createGeocodeAdapter } from '../../adapters/geocode/index.js';
import { makeTestEnv } from '../../test-utils/env.js';
import { makeTestReminderInfra } from '../../queue/test-helpers.js';
import { reminderJobId } from '../../queue/queue-names.js';
import {
  cleanupTestTenants,
  createClientAndPet,
  createServiceFor,
  signup,
  type TestTenant,
} from './test-helpers.js';

const SLUG_PREFIX = 'appts-reminders-test-';

function plusHours(ms: number, h: number): Date {
  return new Date(ms + h * 60 * 60 * 1000);
}

function startInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(10, 0, 0, 0);
  return d.toISOString();
}

describe('appointment routes — reminder lifecycle integration', () => {
  let app: FastifyInstance;
  let geocodeTwin: FastifyInstance;
  let infra: Awaited<ReturnType<typeof makeTestReminderInfra>>;
  let tenant: TestTenant;
  let petId: string;
  let serviceId: string;

  beforeAll(async () => {
    geocodeTwin = createGeocodeTwinApp({ logger: false });
    await geocodeTwin.listen({ port: 0, host: '127.0.0.1' });
    const port = (geocodeTwin.server.address() as { port: number }).port;

    infra = await makeTestReminderInfra();
    const reminderInfra: ReminderInfra = {
      queue: infra.queue,
      worker: null,
      connection: infra.connection,
    };
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
      reminderInfra,
    });
  });

  afterAll(async () => {
    await cleanupTestTenants(SLUG_PREFIX);
    await app.close();
    await geocodeTwin.close();
  });

  beforeEach(async () => {
    await cleanupTestTenants(SLUG_PREFIX);
    await infra.queue.obliterate({ force: true }).catch(() => undefined);
    const ts = Date.now() + Math.floor(Math.random() * 1000);
    tenant = await signup(app, SLUG_PREFIX, `ar-${ts}`, `ar-${ts}`);
    await db.global.tenant.update({
      where: { id: tenant.tenantId },
      data: { plan: PlanTier.pro, smsRemindersEnabled: true },
    });
    const cp = await createClientAndPet(app, tenant);
    petId = cp.petId;
    const svc = await createServiceFor(app, tenant);
    serviceId = svc.id;
  });

  it('Create with reminders enabled → 3 jobs in queue with deterministic IDs', async () => {
    const start = startInDays(5);
    const res = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { cookie: tenant.cookie },
      payload: { petId, serviceId, start },
    });
    expect(res.statusCode).toBe(201);
    const id = (res.json() as { appointment: { id: string } }).appointment.id;

    const counts = await infra.queue.getJobCounts('delayed', 'wait');
    expect((counts.delayed ?? 0) + (counts.wait ?? 0)).toBe(3);
    expect(await infra.queue.getJob(reminderJobId('reminder-48h', id))).toBeTruthy();
    expect(await infra.queue.getJob(reminderJobId('reminder-2h', id))).toBeTruthy();
    expect(await infra.queue.getJob(reminderJobId('reminder-post', id))).toBeTruthy();
  });

  it('Create with reminders disabled → 0 jobs in queue', async () => {
    await db.global.tenant.update({
      where: { id: tenant.tenantId },
      data: { smsRemindersEnabled: false },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { cookie: tenant.cookie },
      payload: { petId, serviceId, start: startInDays(5) },
    });
    expect(res.statusCode).toBe(201);
    const counts = await infra.queue.getJobCounts('delayed', 'wait');
    expect((counts.delayed ?? 0) + (counts.wait ?? 0)).toBe(0);
  });

  it('Reschedule shifts the job timestamps (remove + add, no ghost)', async () => {
    const start = startInDays(5);
    const created = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { cookie: tenant.cookie },
      payload: { petId, serviceId, start },
    });
    const id = (created.json() as { appointment: { id: string } }).appointment.id;
    const old48 = await infra.queue.getJob(reminderJobId('reminder-48h', id));
    const oldDelay = old48?.opts.delay;

    const newStart = plusHours(new Date(start).getTime(), 24).toISOString();
    const patch = await app.inject({
      method: 'PATCH',
      url: `/appointments/${id}`,
      headers: { cookie: tenant.cookie },
      payload: { start: newStart },
    });
    expect(patch.statusCode).toBe(200);

    const new48 = await infra.queue.getJob(reminderJobId('reminder-48h', id));
    expect(new48?.opts.delay).toBeGreaterThan(oldDelay ?? 0);
    const counts = await infra.queue.getJobCounts('delayed', 'wait');
    expect((counts.delayed ?? 0) + (counts.wait ?? 0)).toBe(3);
  });

  it('DELETE → all three reminder jobs removed', async () => {
    const start = startInDays(5);
    const created = await app.inject({
      method: 'POST',
      url: '/appointments',
      headers: { cookie: tenant.cookie },
      payload: { petId, serviceId, start },
    });
    const id = (created.json() as { appointment: { id: string } }).appointment.id;
    const before = await infra.queue.getJobCounts('delayed', 'wait');
    expect((before.delayed ?? 0) + (before.wait ?? 0)).toBe(3);

    const del = await app.inject({
      method: 'DELETE',
      url: `/appointments/${id}`,
      headers: { cookie: tenant.cookie },
    });
    expect(del.statusCode).toBe(204);

    const after = await infra.queue.getJobCounts('delayed', 'wait');
    expect((after.delayed ?? 0) + (after.wait ?? 0)).toBe(0);
  });
});
