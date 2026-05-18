import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { AppointmentStatus, db, PlanTier } from '@mygroomtime/db';
import { createApp } from '../app.js';
import { createMemorySessionStore } from '../adapters/session/index.js';
import { createStdoutEmailAdapter } from '../adapters/email/index.js';
import { makeTestEnv } from '../test-utils/env.js';
import { cleanupTestTenants, signup } from '../routes/appointments/test-helpers.js';
import { materializeOneSeries } from './materialize-series.js';
import { dispatchInbound } from './inbound-sms-dispatch.js';

const SLUG_PREFIX = 'mat-loop-integ-';

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

describe('chunk-17 end-to-end loop', () => {
  it('materialize → inbound R reply → reschedule commit → old canceled, new created, deposit preserved', async () => {
    // === setup: tenant + service + pet + initial completed parent appointment ===
    const ts = Date.now() + Math.floor(Math.random() * 100000);
    const tenant = await signup(app, SLUG_PREFIX, `loop-${ts}`, `loop-${ts}`);
    await db.global.tenant.update({
      where: { id: tenant.tenantId },
      data: { plan: PlanTier.pro, businessName: 'Plano Pup Spa', phone: '+19725550100' },
    });
    const tenantRow = (await db.global.tenant.findUnique({ where: { id: tenant.tenantId } }))!;
    const scoped = db.forTenant(tenant.tenantId);
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
    const series = await scoped.recurringSeries.create({
      data: {
        clientId: client.id,
        petId: pet.id,
        serviceId: service.id,
        intervalWeeks: 6,
        nextDueDate: nextMonday15Z(8),
        active: true,
      },
    });
    // Completed parent (~30 days ago) with original snapshot — supplies snapshot fields
    await scoped.appointment.create({
      data: {
        clientId: client.id,
        petId: pet.id,
        serviceId: service.id,
        vehicleId: vehicle.id,
        recurringSeriesId: series.id,
        scheduledStart: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        durationMin: 90,
        status: AppointmentStatus.completed,
        completedAt: new Date(Date.now() - 29 * 24 * 60 * 60 * 1000),
        depositChargeId: 'pi_chunk17_original_deposit',
        serviceNameSnapshot: service.name,
        servicePriceCentsSnapshot: service.basePriceCents,
        serviceDepositCentsSnapshot: service.depositCents,
        serviceColorSnapshot: service.color,
        serviceDurationMinSnapshot: service.durationMin,
      },
    });

    // === step 1: materialize ===
    const materializeOutcome = await materializeOneSeries({
      seriesId: series.id,
      tenantId: tenant.tenantId,
      deps: {
        gmaps: app.adapters.gmaps,
        reminderQueue: null,
        log: { info: () => undefined, warn: () => undefined },
      },
    });
    expect(materializeOutcome.status).toBe('materialized');
    if (materializeOutcome.status !== 'materialized') return;
    const materializedAppt = await scoped.appointment.findFirst({
      where: { id: materializeOutcome.appointmentId },
    });
    expect(materializedAppt!.recurringSeriesId).toBe(series.id);
    expect(materializedAppt!.serviceNameSnapshot).toBe('Full Groom');

    // why: materialization itself doesn't carry the parent's depositChargeId — a fresh
    // recurring instance has no deposit until/unless paid. To exercise the reschedule's
    // "deposit preserved" path, we plant one here (as if the customer prepaid the deposit
    // out-of-band) so the commit step can verify it survives the rebook.
    await scoped.appointment.update({
      where: { id: materializedAppt!.id },
      data: { depositChargeId: 'pi_chunk17_original_deposit' },
    });

    // === step 2: simulate inbound R reply via the dispatcher ===
    // We need an outbound SMS row so dispatcher can find a "recent appointment". Pretend
    // the 7-day reminder fired.
    await scoped.smsMessage.create({
      data: {
        clientId: client.id,
        appointmentId: materializedAppt!.id,
        direction: 'out',
        toE164: '+19725550199',
        fromE164: '+15555550100',
        body: '7d reminder...',
        status: 'sent',
        idempotencyKey: `reminder-7d:${materializedAppt!.id}`,
        sentAt: new Date(),
      },
    });

    const capturedSends: string[] = [];
    const fakeAdapter = {
      mode: 'twin' as const,
      async sendSms(input: { body: string }): Promise<{ sent: true; twilioSid: string; smsMessageId: string }> {
        capturedSends.push(input.body);
        return { sent: true, twilioSid: 'SM_x', smsMessageId: 'sms_x' };
      },
      verifyWebhookSignature(): boolean {
        return true;
      },
    };

    const dispatchOutcome = await dispatchInbound(
      { from: '+19725550199', to: '+15555550100', body: 'R', messageSid: 'SM_loop_in_1' },
      {
        twilio: fakeAdapter,
        sessionStore: app.adapters.session,
        rescheduleTokenSecret: 'test-reschedule-secret-32-bytes-pad',
        webOrigin: 'http://localhost:5173',
        log: { info: () => undefined, warn: () => undefined },
      },
    );
    expect(dispatchOutcome.action).toBe('reschedule_link_sent');
    expect(capturedSends.length).toBe(1);
    expect(capturedSends[0]).toContain(`http://${tenantRow.slug}.localhost:5173/public/reschedule/`);

    // Extract the token from the URL we sent back to the customer
    const m = capturedSends[0]!.match(/\/public\/reschedule\/([^\s]+)/);
    expect(m).not.toBeNull();
    const realToken = m![1]!;

    // === step 3: customer hits the verify endpoint ===
    const verifyRes = await app.inject({
      method: 'POST',
      url: '/public/reschedule/verify',
      payload: { token: realToken },
    });
    expect(verifyRes.statusCode).toBe(200);
    const verifyBody = verifyRes.json() as {
      source: { appointmentId: string };
      tenantSlug: string;
    };
    expect(verifyBody.source.appointmentId).toBe(materializedAppt!.id);

    // === step 4: customer picks a new slot, commit ===
    const newStart = new Date(materializedAppt!.scheduledStart.getTime() + 24 * 60 * 60 * 1000);
    const commitRes = await app.inject({
      method: 'POST',
      url: '/public/reschedule/commit',
      payload: { token: realToken, newStart: newStart.toISOString() },
    });
    expect(commitRes.statusCode).toBe(200);
    const commitBody = commitRes.json() as {
      newAppointment: { id: string; depositChargeId: string | null };
      canceledAppointmentId: string;
    };
    expect(commitBody.canceledAppointmentId).toBe(materializedAppt!.id);
    expect(commitBody.newAppointment.depositChargeId).toBe('pi_chunk17_original_deposit');

    // === step 5: verify final state ===
    const oldAppt = await scoped.appointment.findFirst({ where: { id: materializedAppt!.id } });
    expect(oldAppt!.status).toBe(AppointmentStatus.canceled);
    const newAppt = await scoped.appointment.findFirst({ where: { id: commitBody.newAppointment.id } });
    expect(newAppt!.scheduledStart.getTime()).toBe(newStart.getTime());
    expect(newAppt!.rescheduledFromAppointmentId).toBe(materializedAppt!.id);
    expect(newAppt!.recurringSeriesId).toBe(series.id);
    expect(newAppt!.depositChargeId).toBe('pi_chunk17_original_deposit');
  });
});

function nextMonday15Z(daysAhead: number): Date {
  const d = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  // why: nudge forward to Monday so weekend issues don't surface in the buffer math
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(15, 0, 0, 0);
  return d;
}
