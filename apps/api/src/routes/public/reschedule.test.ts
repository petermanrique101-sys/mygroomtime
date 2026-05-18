import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { AppointmentStatus, db, PlanTier } from '@mygroomtime/db';
import { createApp } from '../../app.js';
import { createMemorySessionStore } from '../../adapters/session/index.js';
import { createStdoutEmailAdapter } from '../../adapters/email/index.js';
import { makeTestEnv } from '../../test-utils/env.js';
import { cleanupTestTenants, signup } from '../appointments/test-helpers.js';
import { issueRescheduleToken } from '../../services/reschedule-tokens.js';

const SLUG_PREFIX = 'public-reschedule-test-';

let app: FastifyInstance;

beforeAll(async () => {
  app = await createApp({
    logger: false,
    env: makeTestEnv(),
    sessionStore: createMemorySessionStore(),
    emailAdapter: createStdoutEmailAdapter(),
  });
});

afterAll(async () => {
  await cleanupTestTenants(SLUG_PREFIX);
  await app.close();
});

beforeEach(async () => {
  await cleanupTestTenants(SLUG_PREFIX);
});

type Scenario = {
  tenantId: string;
  tenantSlug: string;
  clientId: string;
  appointmentId: string;
  serviceId: string;
  scheduledStart: Date;
};

async function seedScenario(): Promise<Scenario> {
  const ts = Date.now() + Math.floor(Math.random() * 100000);
  const t = await signup(app, SLUG_PREFIX, `pr-${ts}`, `pr-${ts}`);
  await db.global.tenant.update({
    where: { id: t.tenantId },
    data: { plan: PlanTier.pro, businessName: 'Plano Pup Spa' },
  });
  const tenantRow = (await db.global.tenant.findUnique({ where: { id: t.tenantId } }))!;
  const scoped = db.forTenant(t.tenantId);
  const client = await scoped.client.create({
    data: {
      name: 'Carlos Rivera',
      phone: '+19725550199',
      addressStreet: '1 A St',
      addressCity: 'Plano',
      addressState: 'TX',
      addressZip: '75024',
      addressLat: 33.02,
      addressLng: -96.69,
      addressVerified: true,
    },
  });
  const pet = await scoped.pet.create({
    data: { clientId: client.id, name: 'Bruno', breed: 'Lab', coatType: 'short' },
  });
  const service = await scoped.service.create({
    data: { name: 'Full Groom', durationMin: 90, basePriceCents: 8500, depositCents: 2000, color: '#2563eb' },
  });
  const vehicle = await scoped.vehicle.create({ data: { name: 'Van 1' } });
  const start = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  start.setUTCHours(15, 0, 0, 0);
  const appt = await scoped.appointment.create({
    data: {
      clientId: client.id,
      petId: pet.id,
      serviceId: service.id,
      vehicleId: vehicle.id,
      scheduledStart: start,
      durationMin: 90,
      depositChargeId: 'pi_original_deposit',
      serviceNameSnapshot: service.name,
      servicePriceCentsSnapshot: service.basePriceCents,
      serviceDepositCentsSnapshot: service.depositCents,
      serviceColorSnapshot: service.color,
      serviceDurationMinSnapshot: service.durationMin,
    },
  });
  return {
    tenantId: t.tenantId,
    tenantSlug: tenantRow.slug,
    clientId: client.id,
    appointmentId: appt.id,
    serviceId: service.id,
    scheduledStart: start,
  };
}

async function mintToken(s: Scenario): Promise<string> {
  const { token } = await issueRescheduleToken({
    appointmentId: s.appointmentId,
    tenantId: s.tenantId,
    scheduledStart: s.scheduledStart,
    webOrigin: 'http://localhost:5173',
    tenantSlug: s.tenantSlug,
    secret: 'test-reschedule-secret-32-bytes-pad',
    sessionStore: app.adapters.session,
  });
  return token;
}

describe('public reschedule — verify', () => {
  it('valid token → returns appointment summary', async () => {
    const s = await seedScenario();
    const token = await mintToken(s);
    const res = await app.inject({
      method: 'POST',
      url: '/public/reschedule/verify',
      payload: { token },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      tenantSlug: string;
      source: { appointmentId: string };
    };
    expect(body.tenantSlug).toBe(s.tenantSlug);
    expect(body.source.appointmentId).toBe(s.appointmentId);
  });

  it('invalid signature → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/public/reschedule/verify',
      payload: { token: 'not.a.valid.jwt' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('public reschedule — commit', () => {
  it('happy path: cancels old appt, creates new, preserves depositChargeId, links via rescheduledFromAppointmentId', async () => {
    const s = await seedScenario();
    const token = await mintToken(s);
    const newStart = new Date(s.scheduledStart.getTime() + 24 * 60 * 60 * 1000);
    const res = await app.inject({
      method: 'POST',
      url: '/public/reschedule/commit',
      payload: { token, newStart: newStart.toISOString() },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      newAppointment: { id: string; start: string; depositChargeId: string | null };
      canceledAppointmentId: string;
    };
    expect(body.canceledAppointmentId).toBe(s.appointmentId);
    expect(body.newAppointment.depositChargeId).toBe('pi_original_deposit');

    const newAppt = await db
      .forTenant(s.tenantId)
      .appointment.findFirst({ where: { id: body.newAppointment.id } });
    expect(newAppt!.rescheduledFromAppointmentId).toBe(s.appointmentId);
    expect(new Date(newAppt!.scheduledStart).getTime()).toBe(newStart.getTime());

    const oldAppt = await db
      .forTenant(s.tenantId)
      .appointment.findFirst({ where: { id: s.appointmentId } });
    expect(oldAppt!.status).toBe(AppointmentStatus.canceled);
    expect(oldAppt!.canceledAt).not.toBeNull();
  });

  it('already-used token returns 409 with linkedAppointmentId', async () => {
    const s = await seedScenario();
    const token = await mintToken(s);
    const firstStart = new Date(s.scheduledStart.getTime() + 24 * 60 * 60 * 1000);
    const first = await app.inject({
      method: 'POST',
      url: '/public/reschedule/commit',
      payload: { token, newStart: firstStart.toISOString() },
    });
    expect(first.statusCode).toBe(200);
    // Use a DIFFERENT slot on retry so the slot-conflict path doesn't short-circuit
    // before the already-consumed jti check.
    const secondStart = new Date(s.scheduledStart.getTime() + 72 * 60 * 60 * 1000);
    const second = await app.inject({
      method: 'POST',
      url: '/public/reschedule/commit',
      payload: { token, newStart: secondStart.toISOString() },
    });
    expect(second.statusCode).toBe(409);
    const body = second.json() as { error: string; linkedAppointmentId: string | null };
    expect(body.error).toBe('already_used');
    expect(body.linkedAppointmentId).not.toBeNull();
  });

  it('slot conflict at commit → 409, does NOT consume the jti (retry-able)', async () => {
    const s = await seedScenario();
    const token = await mintToken(s);
    // Block the new slot with a manual appointment
    const scoped = db.forTenant(s.tenantId);
    const newStart = new Date(s.scheduledStart.getTime() + 24 * 60 * 60 * 1000);
    const vehicle = await scoped.vehicle.findFirst();
    await scoped.appointment.create({
      data: {
        clientId: s.clientId,
        petId: (await scoped.pet.findFirst({ where: { clientId: s.clientId } }))!.id,
        serviceId: s.serviceId,
        vehicleId: vehicle!.id,
        scheduledStart: newStart,
        durationMin: 90,
        serviceNameSnapshot: 'Full Groom',
        servicePriceCentsSnapshot: 8500,
        serviceDepositCentsSnapshot: 2000,
        serviceColorSnapshot: '#2563eb',
        serviceDurationMinSnapshot: 90,
      },
    });
    const conflict = await app.inject({
      method: 'POST',
      url: '/public/reschedule/commit',
      payload: { token, newStart: newStart.toISOString() },
    });
    expect(conflict.statusCode).toBe(409);
    expect((conflict.json() as { error: string }).error).toBe('slot_unavailable');

    // The token must still be usable for a different slot — jti must NOT have been consumed
    const goodStart = new Date(s.scheduledStart.getTime() + 48 * 60 * 60 * 1000);
    const retry = await app.inject({
      method: 'POST',
      url: '/public/reschedule/commit',
      payload: { token, newStart: goodStart.toISOString() },
    });
    expect(retry.statusCode).toBe(200);
  });
});
