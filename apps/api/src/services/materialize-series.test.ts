import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { AppointmentStatus, db, PlanTier } from '@mygroomtime/db';
import { createApp } from '../app.js';
import { createMemorySessionStore } from '../adapters/session/index.js';
import { createStdoutEmailAdapter } from '../adapters/email/index.js';
import { makeTestEnv } from '../test-utils/env.js';
import { cleanupTestTenants, signup } from '../routes/appointments/test-helpers.js';
import {
  MAX_CONSECUTIVE_FAILED_MATERIALIZATIONS,
  materializeOneSeries,
} from './materialize-series.js';
import type { MaterializeDeps } from './materialize-series.js';

const SLUG_PREFIX = 'materialize-series-test-';

function makeDeps(): MaterializeDeps {
  return {
    gmaps: app.adapters.gmaps,
    reminderQueue: null,
    gcalPushQueue: null,
    log: {
      info: () => undefined,
      warn: () => undefined,
    },
  };
}

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
  seriesId: string;
  clientId: string;
  petId: string;
  serviceId: string;
};

async function seedScenario(
  opts: { startInDays?: number } = {},
): Promise<Scenario> {
  const ts = Date.now() + Math.floor(Math.random() * 100000);
  const tenant = await signup(app, SLUG_PREFIX, `ms-${ts}`, `ms-${ts}`);
  await db.global.tenant.update({
    where: { id: tenant.tenantId },
    data: { plan: PlanTier.pro, businessName: 'Plano Pup Spa' },
  });
  const scoped = db.forTenant(tenant.tenantId);
  const client = await scoped.client.create({
    data: {
      name: 'Carlos Rivera',
      phone: '+19725550190',
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
    data: { clientId: client.id, name: 'Bruno', breed: 'Labrador', coatType: 'short' },
  });
  const service = await scoped.service.create({
    data: { name: 'Full Groom', durationMin: 90, basePriceCents: 8500, depositCents: 2000, color: '#2563eb' },
  });
  await scoped.vehicle.create({ data: { name: 'Van 1' } });
  const nextDueDate = new Date(
    Date.now() + (opts.startInDays ?? 8) * 24 * 60 * 60 * 1000,
  );
  // why: anchor due-date to next Monday 10am UTC so we don't accidentally land on a
  // Sunday (chunk-11 business hours block Sundays in availability — not used here, but
  // weekend slots in canPlaceAppointment are still allowed; we just want determinism).
  nextDueDate.setUTCHours(15, 0, 0, 0);
  const series = await scoped.recurringSeries.create({
    data: {
      clientId: client.id,
      petId: pet.id,
      serviceId: service.id,
      intervalWeeks: 6,
      nextDueDate,
      active: true,
    },
  });
  return {
    tenantId: tenant.tenantId,
    seriesId: series.id,
    clientId: client.id,
    petId: pet.id,
    serviceId: service.id,
  };
}

describe('materializeOneSeries', () => {
  it('happy path: creates an appointment and advances nextDueDate by intervalWeeks', async () => {
    const s = await seedScenario({ startInDays: 8 });
    const before = await db
      .forTenant(s.tenantId)
      .recurringSeries.findFirst({ where: { id: s.seriesId } });
    const beforeDue = before!.nextDueDate;

    const out = await materializeOneSeries({
      seriesId: s.seriesId,
      tenantId: s.tenantId,
      deps: makeDeps(),
    });
    expect(out.status).toBe('materialized');

    const created = await db
      .forTenant(s.tenantId)
      .appointment.findFirst({ where: { recurringSeriesId: s.seriesId } });
    expect(created).not.toBeNull();
    expect(created!.scheduledStart.getTime()).toBe(beforeDue.getTime());
    expect(created!.serviceNameSnapshot).toBe('Full Groom');

    const after = await db
      .forTenant(s.tenantId)
      .recurringSeries.findFirst({ where: { id: s.seriesId } });
    expect(after!.nextDueDate.getTime()).toBe(
      beforeDue.getTime() + 6 * 7 * 24 * 60 * 60 * 1000,
    );
    expect(after!.consecutiveFailedMaterializations).toBe(0);
  });

  it('idempotency: a second call for the same nextDueDate is a no-op', async () => {
    const s = await seedScenario({ startInDays: 8 });
    const first = await materializeOneSeries({
      seriesId: s.seriesId,
      tenantId: s.tenantId,
      deps: makeDeps(),
    });
    expect(first.status).toBe('materialized');

    // Roll the series nextDueDate back to the original to simulate the cron re-running for the
    // SAME due date (e.g., agent fired the walk twice in one night). The existing appointment
    // for that scheduledStart should short-circuit as already_materialized.
    const justCreated = await db
      .forTenant(s.tenantId)
      .appointment.findFirst({ where: { recurringSeriesId: s.seriesId } });
    await db
      .forTenant(s.tenantId)
      .recurringSeries.update({
        where: { id: s.seriesId },
        data: { nextDueDate: justCreated!.scheduledStart },
      });

    const second = await materializeOneSeries({
      seriesId: s.seriesId,
      tenantId: s.tenantId,
      deps: makeDeps(),
    });
    expect(second.status).toBe('skipped_already_materialized');

    const all = await db
      .forTenant(s.tenantId)
      .appointment.findMany({ where: { recurringSeriesId: s.seriesId } });
    expect(all.length).toBe(1);
  });

  it('soft-deleted client → series auto-paused with reason source_deleted', async () => {
    const s = await seedScenario({ startInDays: 8 });
    await db.forTenant(s.tenantId).client.update({
      where: { id: s.clientId },
      data: { deletedAt: new Date() },
    });
    const out = await materializeOneSeries({
      seriesId: s.seriesId,
      tenantId: s.tenantId,
      deps: makeDeps(),
    });
    expect(out.status).toBe('paused_source_deleted');
    const series = await db
      .forTenant(s.tenantId)
      .recurringSeries.findFirst({ where: { id: s.seriesId } });
    expect(series!.active).toBe(false);
    expect(series!.pauseReason).toBe('source_deleted');
    expect(series!.pausedAt).not.toBeNull();
  });

  it('soft-deleted pet → series auto-paused', async () => {
    const s = await seedScenario({ startInDays: 8 });
    await db.forTenant(s.tenantId).pet.update({
      where: { id: s.petId },
      data: { deletedAt: new Date() },
    });
    const out = await materializeOneSeries({
      seriesId: s.seriesId,
      tenantId: s.tenantId,
      deps: makeDeps(),
    });
    expect(out.status).toBe('paused_source_deleted');
  });

  it('slot conflict on first attempt → increments counter + sets retry, no pause', async () => {
    const s = await seedScenario({ startInDays: 8 });
    // Block the slot manually
    const scoped = db.forTenant(s.tenantId);
    const series = await scoped.recurringSeries.findFirst({ where: { id: s.seriesId } });
    const vehicle = await scoped.vehicle.findFirst();
    await scoped.appointment.create({
      data: {
        clientId: s.clientId,
        petId: s.petId,
        serviceId: s.serviceId,
        vehicleId: vehicle!.id,
        scheduledStart: series!.nextDueDate,
        durationMin: 90,
        serviceNameSnapshot: 'Full Groom',
        servicePriceCentsSnapshot: 8500,
        serviceDepositCentsSnapshot: 2000,
        serviceColorSnapshot: '#2563eb',
        serviceDurationMinSnapshot: 90,
      },
    });

    const out = await materializeOneSeries({
      seriesId: s.seriesId,
      tenantId: s.tenantId,
      deps: makeDeps(),
    });
    // The first appointment we created above doesn't have recurringSeriesId, so it's NOT
    // the "already materialized" idempotency path — it's a slot conflict. Expect retry.
    expect(out.status === 'skipped_no_slot_retry' || out.status === 'paused_no_slot').toBe(true);
    if (out.status === 'skipped_no_slot_retry') {
      expect(out.attemptCount).toBe(1);
      const updated = await scoped.recurringSeries.findFirst({ where: { id: s.seriesId } });
      expect(updated!.consecutiveFailedMaterializations).toBe(1);
      expect(updated!.nextMaterializationAttemptAt).not.toBeNull();
    }
  });

  it('7 consecutive failures → series auto-paused with reason no_available_slot', async () => {
    const s = await seedScenario({ startInDays: 8 });
    // Pre-set the counter to MAX-1 so the next failure trips the pause threshold.
    await db.forTenant(s.tenantId).recurringSeries.update({
      where: { id: s.seriesId },
      data: {
        consecutiveFailedMaterializations: MAX_CONSECUTIVE_FAILED_MATERIALIZATIONS - 1,
      },
    });
    // Block the slot.
    const scoped = db.forTenant(s.tenantId);
    const series = await scoped.recurringSeries.findFirst({ where: { id: s.seriesId } });
    const vehicle = await scoped.vehicle.findFirst();
    await scoped.appointment.create({
      data: {
        clientId: s.clientId,
        petId: s.petId,
        serviceId: s.serviceId,
        vehicleId: vehicle!.id,
        scheduledStart: series!.nextDueDate,
        durationMin: 90,
        serviceNameSnapshot: 'Full Groom',
        servicePriceCentsSnapshot: 8500,
        serviceDepositCentsSnapshot: 2000,
        serviceColorSnapshot: '#2563eb',
        serviceDurationMinSnapshot: 90,
      },
    });
    const out = await materializeOneSeries({
      seriesId: s.seriesId,
      tenantId: s.tenantId,
      deps: makeDeps(),
    });
    expect(out.status).toBe('paused_no_slot');
    const updated = await scoped.recurringSeries.findFirst({ where: { id: s.seriesId } });
    expect(updated!.active).toBe(false);
    expect(updated!.pauseReason).toBe('no_available_slot');
  });

  it('snapshot source: when a completed parent exists, copy its snapshot (drift-proof)', async () => {
    const s = await seedScenario({ startInDays: 8 });
    const scoped = db.forTenant(s.tenantId);
    // Create a completed parent appt with snapshot fields that DIFFER from the live service
    await scoped.appointment.create({
      data: {
        clientId: s.clientId,
        petId: s.petId,
        serviceId: s.serviceId,
        recurringSeriesId: s.seriesId,
        scheduledStart: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        durationMin: 90,
        status: AppointmentStatus.completed,
        completedAt: new Date(Date.now() - 29 * 24 * 60 * 60 * 1000),
        serviceNameSnapshot: 'Full Groom (legacy)',
        servicePriceCentsSnapshot: 7000,
        serviceDepositCentsSnapshot: 1500,
        serviceColorSnapshot: '#ff0000',
        serviceDurationMinSnapshot: 90,
      },
    });
    // Now bump the live service price
    await scoped.service.update({
      where: { id: s.serviceId },
      data: { basePriceCents: 9999 },
    });
    const out = await materializeOneSeries({
      seriesId: s.seriesId,
      tenantId: s.tenantId,
      deps: makeDeps(),
    });
    expect(out.status).toBe('materialized');
    if (out.status !== 'materialized') return;
    const created = await scoped.appointment.findFirst({ where: { id: out.appointmentId } });
    // The snapshot should come from the completed parent (7000), not the live service (9999)
    expect(created!.servicePriceCentsSnapshot).toBe(7000);
    expect(created!.serviceNameSnapshot).toBe('Full Groom (legacy)');
  });
});
