import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { db, PlanTier, SmsDirection, SmsStatus } from '@mygroomtime/db';
import { createApp } from '../app.js';
import { createMemorySessionStore } from '../adapters/session/index.js';
import { createStdoutEmailAdapter } from '../adapters/email/index.js';
import { makeTestEnv } from '../test-utils/env.js';
import { cleanupTestTenants, signup } from '../routes/appointments/test-helpers.js';
import { dispatchInbound, type DispatchDeps } from './inbound-sms-dispatch.js';
import type {
  SendSmsInput,
  SendSmsResult,
  TwilioAdapter,
  VerifyTwilioWebhookInput,
} from '../adapters/twilio/index.js';

const SLUG_PREFIX = 'inbound-dispatch-test-';

type Capture = { input: SendSmsInput };

function fakeTwilio(): { adapter: TwilioAdapter; calls: Capture[] } {
  const calls: Capture[] = [];
  return {
    calls,
    adapter: {
      mode: 'twin',
      async sendSms(input: SendSmsInput): Promise<SendSmsResult> {
        calls.push({ input });
        return {
          sent: true,
          twilioSid: `SM_fake_${input.idempotencyKey}`,
          smsMessageId: `sms_${input.idempotencyKey}`,
        };
      },
      verifyWebhookSignature(_: VerifyTwilioWebhookInput): boolean {
        return true;
      },
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
  slug: string;
  clientId: string;
  petId: string;
  serviceId: string;
  appointmentId: string;
};

async function seedScenario(): Promise<Scenario> {
  const ts = Date.now() + Math.floor(Math.random() * 100000);
  const tenant = await signup(app, SLUG_PREFIX, `id-${ts}`, `id-${ts}`);
  await db.global.tenant.update({
    where: { id: tenant.tenantId },
    data: { plan: PlanTier.pro, phone: '+19725550100' },
  });
  const slug = (await db.global.tenant.findUnique({ where: { id: tenant.tenantId } }))!.slug;
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
  const appt = await scoped.appointment.create({
    data: {
      clientId: client.id,
      petId: pet.id,
      serviceId: service.id,
      scheduledStart: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      durationMin: 90,
      serviceNameSnapshot: service.name,
      servicePriceCentsSnapshot: service.basePriceCents,
      serviceDepositCentsSnapshot: service.depositCents,
      serviceColorSnapshot: service.color,
      serviceDurationMinSnapshot: service.durationMin,
    },
  });
  // Outbound reminder-7d row so the dispatcher can find a "recent reminder" appointment.
  await scoped.smsMessage.create({
    data: {
      clientId: client.id,
      appointmentId: appt.id,
      direction: SmsDirection.out,
      toE164: '+19725550199',
      fromE164: '+15555550100',
      body: '7d reminder...',
      status: SmsStatus.sent,
      idempotencyKey: `reminder-7d:${appt.id}`,
      sentAt: new Date(),
    },
  });
  return {
    tenantId: tenant.tenantId,
    slug,
    clientId: client.id,
    petId: pet.id,
    serviceId: service.id,
    appointmentId: appt.id,
  };
}

function makeDeps(adapter: TwilioAdapter): DispatchDeps {
  return {
    twilio: adapter,
    sessionStore: app.adapters.session,
    rescheduleTokenSecret: 'test-reschedule-secret-32-bytes-pad',
    webOrigin: 'http://localhost:5173',
    log: { info: () => undefined, warn: () => undefined },
  };
}

describe('dispatchInbound — priority + branch outcomes', () => {
  it('STOP body → opt_out applied, client.smsOptOut=true', async () => {
    const s = await seedScenario();
    const tw = fakeTwilio();
    const out = await dispatchInbound(
      { from: '+19725550199', to: '+15555550100', body: 'STOP', messageSid: 'SM_in_1' },
      makeDeps(tw.adapter),
    );
    expect(out.action).toBe('opted_out');
    const client = await db
      .forTenant(s.tenantId)
      .client.findFirst({ where: { id: s.clientId } });
    expect(client!.smsOptOut).toBe(true);
    expect(client!.smsOptOutAt).not.toBeNull();
  });

  it('Exact "R" body → reschedule_link_sent, link includes the tenant subdomain', async () => {
    const s = await seedScenario();
    const tw = fakeTwilio();
    const out = await dispatchInbound(
      { from: '+19725550199', to: '+15555550100', body: 'R', messageSid: 'SM_in_2' },
      makeDeps(tw.adapter),
    );
    expect(out.action).toBe('reschedule_link_sent');
    expect(tw.calls.length).toBe(1);
    expect(tw.calls[0]!.input.body).toContain(`http://${s.slug}.localhost:5173/public/reschedule/`);
  });

  it('Lowercase "r" matches the exact-R branch (case-insensitive)', async () => {
    await seedScenario();
    const tw = fakeTwilio();
    const out = await dispatchInbound(
      { from: '+19725550199', to: '+15555550100', body: 'r', messageSid: 'SM_in_3' },
      makeDeps(tw.adapter),
    );
    expect(out.action).toBe('reschedule_link_sent');
  });

  it('"Rad!" does NOT match the R-only branch — falls through to fallback', async () => {
    await seedScenario();
    const tw = fakeTwilio();
    const out = await dispatchInbound(
      { from: '+19725550199', to: '+15555550100', body: 'Rad!', messageSid: 'SM_in_4' },
      makeDeps(tw.adapter),
    );
    expect(out.action).toBe('fallback_sent');
  });

  it('Substring RESCHEDULE matches', async () => {
    await seedScenario();
    const tw = fakeTwilio();
    const out = await dispatchInbound(
      {
        from: '+19725550199',
        to: '+15555550100',
        body: 'Please RESCHEDULE me tomorrow',
        messageSid: 'SM_in_5',
      },
      makeDeps(tw.adapter),
    );
    expect(out.action).toBe('reschedule_link_sent');
  });

  it('Exact "C" → confirmation_logged with thank-you reply', async () => {
    await seedScenario();
    const tw = fakeTwilio();
    const out = await dispatchInbound(
      { from: '+19725550199', to: '+15555550100', body: 'C', messageSid: 'SM_in_6' },
      makeDeps(tw.adapter),
    );
    expect(out.action).toBe('confirmation_logged');
    expect(tw.calls.length).toBe(1);
    expect(tw.calls[0]!.input.body).toMatch(/Thanks! See you/);
  });

  it('Exact "YES" matches confirmation', async () => {
    await seedScenario();
    const tw = fakeTwilio();
    const out = await dispatchInbound(
      { from: '+19725550199', to: '+15555550100', body: 'YES', messageSid: 'SM_in_7' },
      makeDeps(tw.adapter),
    );
    expect(out.action).toBe('confirmation_logged');
  });

  it('Garbage body → fallback_sent', async () => {
    await seedScenario();
    const tw = fakeTwilio();
    const out = await dispatchInbound(
      { from: '+19725550199', to: '+15555550100', body: 'huh?', messageSid: 'SM_in_8' },
      makeDeps(tw.adapter),
    );
    expect(out.action).toBe('fallback_sent');
    expect(tw.calls.length).toBe(1);
    expect(tw.calls[0]!.input.body).toMatch(/didn't catch/);
  });

  it('Unknown phone (no matching client) → no_match action, no DB writes', async () => {
    await seedScenario();
    const tw = fakeTwilio();
    const out = await dispatchInbound(
      { from: '+12025550404', to: '+15555550100', body: 'STOP', messageSid: 'SM_in_9' },
      makeDeps(tw.adapter),
    );
    expect(out.action).toBe('no_match');
    expect(tw.calls.length).toBe(0);
  });
});
