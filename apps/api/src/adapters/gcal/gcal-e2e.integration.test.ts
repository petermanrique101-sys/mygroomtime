import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AddressInfo } from 'node:net';
import { createApp as createGcalTwin } from '@mygroomtime/twin-google-calendar';
import { db, PlanTier } from '@mygroomtime/db';
import { createApp } from '../../app.js';
import { createMemorySessionStore } from '../session/index.js';
import { createStdoutEmailAdapter } from '../email/index.js';
import { makeTestEnv } from '../../test-utils/env.js';
import { cleanupTestTenants, signup } from '../../routes/appointments/test-helpers.js';
import { createGcalPushHandler } from '../../queue/gcal-push-worker.js';
import { createGcalPullHandler } from '../../queue/gcal-pull-worker.js';
import {
  resolveConflict,
  type ConflictAppointment,
} from '../../services/gcal-conflict.js';
import { encryptToken } from '../../services/token-encrypt.js';
import { createGcalTwinAdapter } from './twin.js';
import {
  SLUG_PREFIX,
  authorize,
  fakePullJob,
  fakePushJob,
  seedProTenantWithLink,
} from './gcal-e2e.helpers.js';

let twinUrl = '';
let twinHandle: ReturnType<typeof createGcalTwin>;
let app: FastifyInstance;

beforeAll(async () => {
  twinHandle = createGcalTwin({ logger: false });
  await twinHandle.app.listen({ host: '127.0.0.1', port: 0 });
  const addr = twinHandle.app.server.address() as AddressInfo;
  twinUrl = `http://127.0.0.1:${addr.port}`;

  const env = makeTestEnv();
  env.gcal.twinUrl = twinUrl;

  app = await createApp({
    logger: false,
    env,
    sessionStore: createMemorySessionStore(),
    emailAdapter: createStdoutEmailAdapter(),
    adapters: { gcal: createGcalTwinAdapter(env.gcal) },
  });
});

afterAll(async () => {
  await cleanupTestTenants(SLUG_PREFIX);
  await app.close();
  await twinHandle.app.close();
});

beforeEach(async () => {
  await cleanupTestTenants(SLUG_PREFIX);
  twinHandle.state.reset();
});

function pushDeps() {
  return {
    gcal: app.adapters.gcal,
    redis: null,
    encryptionKey: app.appEnv.gcal.tokenEncryptionKey,
    log: app.log,
  };
}

function pullDeps() {
  return {
    gcal: app.adapters.gcal,
    redis: null,
    encryptionKey: app.appEnv.gcal.tokenEncryptionKey,
    reminderQueue: null,
    log: app.log,
  };
}

describe('gcal e2e — push direction', () => {
  it('create: twin event has mgt tags and appt.googleEventId is set', async () => {
    const seed = await seedProTenantWithLink({
      app,
      twinUrl,
      twinHandle,
      scenarioPrefix: 'pushcreate',
    });
    const handler = createGcalPushHandler(pushDeps());
    await handler(fakePushJob('gcal-push.create', seed.appointmentId, seed.tenantId));

    const stored = await db
      .forTenant(seed.tenantId)
      .appointment.findFirst({ where: { id: seed.appointmentId } });
    expect(stored?.googleEventId).toBeTruthy();

    const evs = Array.from(twinHandle.state.events.values());
    expect(evs.length).toBe(1);
    const tagged = evs[0]!;
    expect(tagged.extendedProperties.private.mgtAppointmentId).toBe(seed.appointmentId);
    expect(tagged.extendedProperties.private.mgtTenantId).toBe(seed.tenantId);
    expect(tagged.summary).toBe('Full Groom — Bruno');
  });

  it('update: same googleEventId, twin sees new start time', async () => {
    const seed = await seedProTenantWithLink({
      app,
      twinUrl,
      twinHandle,
      scenarioPrefix: 'pushupd',
    });
    const handler = createGcalPushHandler(pushDeps());
    await handler(fakePushJob('gcal-push.create', seed.appointmentId, seed.tenantId));
    const before = await db
      .forTenant(seed.tenantId)
      .appointment.findFirst({ where: { id: seed.appointmentId } });
    const eventId = before!.googleEventId!;

    await db.forTenant(seed.tenantId).appointment.update({
      where: { id: seed.appointmentId },
      data: { scheduledStart: new Date('2026-07-01T16:00:00.000Z') },
    });
    await handler(fakePushJob('gcal-push.update', seed.appointmentId, seed.tenantId));

    const after = await db
      .forTenant(seed.tenantId)
      .appointment.findFirst({ where: { id: seed.appointmentId } });
    expect(after!.googleEventId).toBe(eventId);
    const ev = twinHandle.state.events.get(eventId)!;
    expect(ev.startIso).toBe('2026-07-01T16:00:00.000Z');
  });

  it('delete: twin event flips to cancelled', async () => {
    const seed = await seedProTenantWithLink({
      app,
      twinUrl,
      twinHandle,
      scenarioPrefix: 'pushdel',
    });
    const handler = createGcalPushHandler(pushDeps());
    await handler(fakePushJob('gcal-push.create', seed.appointmentId, seed.tenantId));
    const created = await db
      .forTenant(seed.tenantId)
      .appointment.findFirst({ where: { id: seed.appointmentId } });
    const eventId = created!.googleEventId!;

    await handler(fakePushJob('gcal-push.delete', seed.appointmentId, seed.tenantId));
    expect(twinHandle.state.events.get(eventId)!.status).toBe('cancelled');
  });
});

describe('gcal e2e — pull direction', () => {
  it('external time-edit on a tagged event updates our scheduledStart', async () => {
    const seed = await seedProTenantWithLink({
      app,
      twinUrl,
      twinHandle,
      scenarioPrefix: 'pull',
    });
    const push = createGcalPushHandler(pushDeps());
    await push(fakePushJob('gcal-push.create', seed.appointmentId, seed.tenantId));

    const stored = await db
      .forTenant(seed.tenantId)
      .appointment.findFirst({ where: { id: seed.appointmentId } });
    const eventId = stored!.googleEventId!;
    await new Promise((r) => setTimeout(r, 10));
    await fetch(`${twinUrl}/__twin__/external-event-patched`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        eventId,
        patch: {
          start: { dateTime: '2026-07-01T16:00:00.000Z' },
          end: { dateTime: '2026-07-01T17:30:00.000Z' },
        },
      }),
    });

    const link = await db.global.googleCalendarLink.findFirst({
      where: { userId: seed.userId },
    });
    const pull = createGcalPullHandler(pullDeps());
    await pull(fakePullJob(link!.id));

    const reloaded = await db
      .forTenant(seed.tenantId)
      .appointment.findFirst({ where: { id: seed.appointmentId } });
    expect(reloaded!.scheduledStart.toISOString()).toBe('2026-07-01T16:00:00.000Z');
  });

  it('external deletion on a tagged event cancels our appointment', async () => {
    const seed = await seedProTenantWithLink({
      app,
      twinUrl,
      twinHandle,
      scenarioPrefix: 'pulldel',
    });
    const push = createGcalPushHandler(pushDeps());
    await push(fakePushJob('gcal-push.create', seed.appointmentId, seed.tenantId));

    const stored = await db
      .forTenant(seed.tenantId)
      .appointment.findFirst({ where: { id: seed.appointmentId } });
    const eventId = stored!.googleEventId!;
    await new Promise((r) => setTimeout(r, 10));
    await fetch(`${twinUrl}/__twin__/external-event-deleted`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eventId }),
    });

    const link = await db.global.googleCalendarLink.findFirst({
      where: { userId: seed.userId },
    });
    const pull = createGcalPullHandler(pullDeps());
    await pull(fakePullJob(link!.id));

    const reloaded = await db
      .forTenant(seed.tenantId)
      .appointment.findFirst({ where: { id: seed.appointmentId } });
    expect(reloaded!.status).toBe('canceled');
    expect(reloaded!.canceledAt).not.toBeNull();
  });
});

describe('gcal e2e — conflict + lifecycle', () => {
  it('deposit charge id preserved when Google wins on time', async () => {
    const seed = await seedProTenantWithLink({
      app,
      twinUrl,
      twinHandle,
      scenarioPrefix: 'depositkept',
    });
    await db.forTenant(seed.tenantId).appointment.update({
      where: { id: seed.appointmentId },
      data: { depositChargeId: 'pi_pretend_deposit' },
    });
    const push = createGcalPushHandler(pushDeps());
    await push(fakePushJob('gcal-push.create', seed.appointmentId, seed.tenantId));

    const stored = await db
      .forTenant(seed.tenantId)
      .appointment.findFirst({ where: { id: seed.appointmentId } });
    const eventId = stored!.googleEventId!;
    await new Promise((r) => setTimeout(r, 10));
    await fetch(`${twinUrl}/__twin__/external-event-patched`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        eventId,
        patch: {
          start: { dateTime: '2026-07-01T18:00:00.000Z' },
          end: { dateTime: '2026-07-01T19:30:00.000Z' },
        },
      }),
    });

    const link = await db.global.googleCalendarLink.findFirst({
      where: { userId: seed.userId },
    });
    const pull = createGcalPullHandler(pullDeps());
    await pull(fakePullJob(link!.id));

    const reloaded = await db
      .forTenant(seed.tenantId)
      .appointment.findFirst({ where: { id: seed.appointmentId } });
    expect(reloaded!.scheduledStart.toISOString()).toBe('2026-07-01T18:00:00.000Z');
    // why: payment + recurring + snapshot columns are never touched by gcal pull.
    expect(reloaded!.depositChargeId).toBe('pi_pretend_deposit');
    expect(reloaded!.serviceNameSnapshot).toBe('Full Groom');
  });

  it('ours newer than theirs → no DB change', async () => {
    const seed = await seedProTenantWithLink({
      app,
      twinUrl,
      twinHandle,
      scenarioPrefix: 'ourswin',
    });
    const ours: ConflictAppointment = {
      id: seed.appointmentId,
      scheduledStart: new Date('2026-07-01T15:00:00.000Z'),
      durationMin: 90,
      notes: 'orig',
      status: 'scheduled',
      updatedAt: new Date('2026-07-01T14:00:00.000Z'),
    };
    const theirs = {
      id: 'evt_x',
      summary: 'Full Groom',
      description: 'orig\n\n1 A St',
      start: '2026-07-01T16:00:00.000Z',
      end: '2026-07-01T17:30:00.000Z',
      status: 'confirmed' as const,
      extendedProperties: { private: { mgtAppointmentId: seed.appointmentId } },
      updated: '2026-07-01T13:00:00.000Z',
    };
    expect(resolveConflict({ ours, theirs }).kind).toBe('ours_wins');
  });

  it('disconnect: deleting the link stops new pushes', async () => {
    const seed = await seedProTenantWithLink({
      app,
      twinUrl,
      twinHandle,
      scenarioPrefix: 'disconnect',
    });
    const push = createGcalPushHandler(pushDeps());
    await db.forTenant(seed.tenantId).googleCalendarLink.deleteMany({
      where: { userId: seed.userId },
    });
    await push(fakePushJob('gcal-push.create', seed.appointmentId, seed.tenantId));
    expect(twinHandle.state.events.size).toBe(0);
  });

  it('reconnect: new link, push resumes; old events remain on twin', async () => {
    const seed = await seedProTenantWithLink({
      app,
      twinUrl,
      twinHandle,
      scenarioPrefix: 'reconn',
    });
    const push = createGcalPushHandler(pushDeps());
    await push(fakePushJob('gcal-push.create', seed.appointmentId, seed.tenantId));
    expect(twinHandle.state.events.size).toBe(1);

    await db.forTenant(seed.tenantId).googleCalendarLink.deleteMany({
      where: { userId: seed.userId },
    });
    expect(twinHandle.state.events.size).toBe(1);

    const tok = await authorize({ app, twinUrl });
    await db.global.googleCalendarLink.create({
      data: {
        tenantId: seed.tenantId,
        userId: seed.userId,
        googleUserId: 'twin-user-2',
        googleEmail: 'twin-user-2@mygroomtime.test',
        googleCalendarId: 'primary',
        encryptedRefreshToken: encryptToken(
          tok.refresh,
          app.appEnv.gcal.tokenEncryptionKey,
        ),
      },
    });
    await db.forTenant(seed.tenantId).appointment.update({
      where: { id: seed.appointmentId },
      data: { googleEventId: null },
    });
    await push(fakePushJob('gcal-push.create', seed.appointmentId, seed.tenantId));
    expect(twinHandle.state.events.size).toBe(2);
  });
});

describe('gcal e2e — tier gating', () => {
  it('Starter sees 403 + reason: tier_gated on /connect', async () => {
    const ts = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const tenant = await signup(app, SLUG_PREFIX, `starter-${ts}`, `starter-${ts}`);
    const res = await app.inject({
      method: 'POST',
      url: '/settings/integrations/google-calendar/connect',
      headers: { cookie: tenant.cookie },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json() as { reason: string; requiredPlan: string };
    expect(body.reason).toBe('tier_gated');
    expect(body.requiredPlan).toBe('pro');
  });

  it('Pro returns a connect URL', async () => {
    const ts = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const tenant = await signup(app, SLUG_PREFIX, `pro-${ts}`, `pro-${ts}`);
    await db.global.tenant.update({
      where: { id: tenant.tenantId },
      data: { plan: PlanTier.pro },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/settings/integrations/google-calendar/connect',
      headers: { cookie: tenant.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { url: string };
    expect(body.url).toContain('/oauth/auth');
    expect(body.url).toContain('redirect_uri=');
    expect(body.url).toContain('state=');
  });
});
