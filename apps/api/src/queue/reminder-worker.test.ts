import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { db, AppointmentStatus, PlanTier, SmsStatus } from '@mygroomtime/db';
import { createApp } from '../app.js';
import { createMemorySessionStore } from '../adapters/session/index.js';
import { createStdoutEmailAdapter } from '../adapters/email/index.js';
import { makeTestEnv } from '../test-utils/env.js';
import { cleanupTestTenants, signup } from '../routes/appointments/test-helpers.js';
import { createReminderHandler } from './reminder-worker.js';
import { makeTestReminderInfra } from './test-helpers.js';
import { reminderJobId } from './queue-names.js';
import type { ReminderWorker } from './connection.js';
import type {
  SendSmsInput,
  SendSmsResult,
  TwilioAdapter,
  VerifyTwilioWebhookInput,
} from '../adapters/twilio/index.js';

const SLUG_PREFIX = 'reminder-worker-test-';

type CapturedCall = {
  input: SendSmsInput;
  ts: number;
};

function makeFakeTwilio(): {
  adapter: TwilioAdapter;
  calls: CapturedCall[];
  setResponder(fn: (input: SendSmsInput) => SendSmsResult): void;
} {
  const calls: CapturedCall[] = [];
  let responder: (input: SendSmsInput) => SendSmsResult = (input) => ({
    sent: true,
    twilioSid: `SM_fake_${input.idempotencyKey}`,
    smsMessageId: `sms_${input.idempotencyKey}`,
  });
  return {
    calls,
    setResponder(fn) {
      responder = fn;
    },
    adapter: {
      mode: 'twin',
      async sendSms(input: SendSmsInput): Promise<SendSmsResult> {
        calls.push({ input, ts: Date.now() });
        return responder(input);
      },
      verifyWebhookSignature(_: VerifyTwilioWebhookInput): boolean {
        return true;
      },
    },
  };
}

async function seedScenario(
  app: FastifyInstance,
  plan: PlanTier = PlanTier.pro,
): Promise<{
  tenantId: string;
  appointmentId: string;
  clientId: string;
}> {
  const ts = Date.now() + Math.floor(Math.random() * 100000);
  const tenant = await signup(app, SLUG_PREFIX, `rw-${ts}`, `rw-${ts}`);
  await db.global.tenant.update({
    where: { id: tenant.tenantId },
    data: { plan, businessName: 'Plano Pup Spa', smsRemindersEnabled: true },
  });
  const scoped = db.forTenant(tenant.tenantId);
  const client = await scoped.client.create({
    data: {
      name: 'Carlos Rivera',
      phone: '+19725550199',
      addressStreet: '1 A St',
      addressCity: 'Plano',
      addressState: 'TX',
      addressZip: '75024',
    },
  });
  const pet = await scoped.pet.create({
    data: { clientId: client.id, name: 'Bruno', breed: 'Labrador', coatType: 'short' },
  });
  const service = await scoped.service.create({
    data: { name: 'Full Groom', durationMin: 90, basePriceCents: 8500, depositCents: 2000 },
  });
  const vehicle = await scoped.vehicle.create({ data: { name: 'Van 1' } });
  const appt = await scoped.appointment.create({
    data: {
      clientId: client.id,
      petId: pet.id,
      serviceId: service.id,
      vehicleId: vehicle.id,
      scheduledStart: new Date(Date.now() + 72 * 60 * 60 * 1000),
      durationMin: service.durationMin,
      serviceNameSnapshot: service.name,
      servicePriceCentsSnapshot: service.basePriceCents,
      serviceDepositCentsSnapshot: service.depositCents,
      serviceColorSnapshot: service.color,
      serviceDurationMinSnapshot: service.durationMin,
    },
  });
  return { tenantId: tenant.tenantId, appointmentId: appt.id, clientId: client.id };
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

describe('reminder worker — fire-time outcomes', () => {
  it('canceled appointment → handler returns success without calling adapter', async () => {
    const { tenantId, appointmentId } = await seedScenario(app);
    await db.forTenant(tenantId).appointment.update({
      where: { id: appointmentId },
      data: { status: AppointmentStatus.canceled, canceledAt: new Date() },
    });

    const fake = makeFakeTwilio();
    const handler = createReminderHandler({ twilio: fake.adapter, log: app.log });
    let infra: Awaited<ReturnType<typeof makeTestReminderInfra>> | null = null;
    try {
      infra = await makeTestReminderInfra(handler);
      const job = await infra.queue.add(
        'reminder-2h',
        { appointmentId, tenantId },
        { jobId: reminderJobId('reminder-2h', appointmentId) },
      );
      await waitForJobCompletion(infra.worker!, job.id!);
      expect(fake.calls.length).toBe(0);
    } finally {
      if (infra) await infra.close();
    }
  });

  it('pro tenant + opted-in client → adapter.sendSms called with correct args', async () => {
    const { tenantId, appointmentId, clientId } = await seedScenario(app);

    const fake = makeFakeTwilio();
    const handler = createReminderHandler({ twilio: fake.adapter, log: app.log });
    let infra: Awaited<ReturnType<typeof makeTestReminderInfra>> | null = null;
    try {
      infra = await makeTestReminderInfra(handler);
      const job = await infra.queue.add(
        'reminder-48h',
        { appointmentId, tenantId },
        { jobId: reminderJobId('reminder-48h', appointmentId) },
      );
      await waitForJobCompletion(infra.worker!, job.id!);
      expect(fake.calls.length).toBe(1);
      const call = fake.calls[0]!;
      expect(call.input.toE164).toBe('+19725550199');
      expect(call.input.tenantId).toBe(tenantId);
      expect(call.input.clientId).toBe(clientId);
      expect(call.input.appointmentId).toBe(appointmentId);
      expect(call.input.idempotencyKey).toBe(`reminder-48h:${appointmentId}`);
      expect(call.input.body).toContain('Plano Pup Spa');
      expect(call.input.body).toContain('Bruno');
      expect(call.input.body).toContain('Full Groom');
    } finally {
      if (infra) await infra.close();
    }
  });

  it('opted-out client → real adapter records skipped_opt_out, worker succeeds', async () => {
    const { tenantId, appointmentId, clientId } = await seedScenario(app);
    await db.forTenant(tenantId).client.update({
      where: { id: clientId },
      data: { smsOptOut: true, smsOptOutAt: new Date() },
    });

    const handler = createReminderHandler({ twilio: app.adapters.twilio, log: app.log });
    let infra: Awaited<ReturnType<typeof makeTestReminderInfra>> | null = null;
    try {
      infra = await makeTestReminderInfra(handler);
      const job = await infra.queue.add(
        'reminder-48h',
        { appointmentId, tenantId },
        { jobId: reminderJobId('reminder-48h', appointmentId) },
      );
      await waitForJobCompletion(infra.worker!, job.id!);
      const rows = await db.forTenant(tenantId).smsMessage.findMany({
        where: { appointmentId },
      });
      expect(rows.length).toBe(1);
      expect(rows[0]!.status).toBe(SmsStatus.skipped_opt_out);
    } finally {
      if (infra) await infra.close();
    }
  });

  it('tier-gated tenant (starter) → real adapter records skipped_tier, worker succeeds', async () => {
    const { tenantId, appointmentId } = await seedScenario(app, PlanTier.starter);

    const handler = createReminderHandler({ twilio: app.adapters.twilio, log: app.log });
    let infra: Awaited<ReturnType<typeof makeTestReminderInfra>> | null = null;
    try {
      infra = await makeTestReminderInfra(handler);
      const job = await infra.queue.add(
        'reminder-post',
        { appointmentId, tenantId },
        { jobId: reminderJobId('reminder-post', appointmentId) },
      );
      await waitForJobCompletion(infra.worker!, job.id!);
      const rows = await db.forTenant(tenantId).smsMessage.findMany({
        where: { appointmentId },
      });
      expect(rows.length).toBe(1);
      expect(rows[0]!.status).toBe(SmsStatus.skipped_tier);
    } finally {
      if (infra) await infra.close();
    }
  });

  it('infra error during sendSms → throws, BullMQ retries (attempts > 1)', async () => {
    const { tenantId, appointmentId } = await seedScenario(app);

    const fake = makeFakeTwilio();
    let calls = 0;
    fake.setResponder(() => {
      calls += 1;
      throw new Error('simulated db unavailable');
    });
    const handler = createReminderHandler({ twilio: fake.adapter, log: app.log });
    let infra: Awaited<ReturnType<typeof makeTestReminderInfra>> | null = null;
    try {
      infra = await makeTestReminderInfra(handler);
      const job = await infra.queue.add(
        'reminder-2h',
        { appointmentId, tenantId },
        {
          jobId: reminderJobId('reminder-2h', appointmentId),
          attempts: 2,
          backoff: { type: 'fixed', delay: 50 },
        },
      );
      await waitForJobFailure(infra.worker!, job.id!);
      expect(calls).toBeGreaterThanOrEqual(2);
    } finally {
      if (infra) await infra.close();
    }
  });
});

async function waitForJobCompletion(worker: ReminderWorker, jobId: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      worker.off('completed', onDone);
      worker.off('failed', onFail);
      reject(new Error(`worker did not complete job ${jobId} within 5s`));
    }, 5000);
    function onDone(job: { id?: string }): void {
      if (job.id === jobId) {
        clearTimeout(timeout);
        worker.off('completed', onDone);
        worker.off('failed', onFail);
        resolve();
      }
    }
    function onFail(job: { id?: string } | undefined, err: Error): void {
      if (job?.id === jobId) {
        clearTimeout(timeout);
        worker.off('completed', onDone);
        worker.off('failed', onFail);
        reject(err);
      }
    }
    worker.on('completed', onDone);
    worker.on('failed', onFail);
  });
}

async function waitForJobFailure(
  worker: ReminderWorker,
  jobId: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      worker.off('failed', onFail);
      worker.off('completed', onDone);
      reject(new Error(`worker did not exhaust attempts for ${jobId} within 5s`));
    }, 5000);
    function onFail(job: { id?: string; attemptsMade?: number; opts?: { attempts?: number } } | undefined): void {
      if (job?.id !== jobId) return;
      const made = job.attemptsMade ?? 0;
      const allowed = job.opts?.attempts ?? 1;
      if (made >= allowed) {
        clearTimeout(timeout);
        worker.off('failed', onFail);
        worker.off('completed', onDone);
        resolve();
      }
    }
    function onDone(job: { id?: string }): void {
      if (job.id === jobId) {
        clearTimeout(timeout);
        worker.off('failed', onFail);
        worker.off('completed', onDone);
        reject(new Error(`expected failure but job ${jobId} completed`));
      }
    }
    worker.on('failed', onFail);
    worker.on('completed', onDone);
  });
}
