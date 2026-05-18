import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  createApp as createTwilioTwinApp,
  type TwinAppHandle,
} from '@mygroomtime/twin-twilio';
import {
  db,
  PlanTier,
  SmsDirection,
  SmsStatus,
  type Client as DbClient,
} from '@mygroomtime/db';
import { createTwilioAdapter } from './index.js';
import type { TwilioAdapter } from './types.js';
import { cleanupTestTenants, signup } from '../../routes/appointments/test-helpers.js';
import { createApp } from '../../app.js';
import { makeTestEnv } from '../../test-utils/env.js';
import { createMemorySessionStore } from '../session/index.js';
import { createStdoutEmailAdapter } from '../email/index.js';

const PREFIX = 'twilio-adapter-';
const FROM = '+15555550100';
const AUTH = 'auth_test_twin';
const ACCOUNT_SID = 'AC_test_twin';

let twin: TwinAppHandle;
let twinUrl: string;
let adapter: TwilioAdapter;
let app: FastifyInstance;

beforeAll(async () => {
  twin = createTwilioTwinApp({
    logger: false,
    authToken: AUTH,
    fromNumber: FROM,
  });
  await twin.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = twin.app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('twin address missing');
  twinUrl = `http://127.0.0.1:${addr.port}`;
  adapter = createTwilioAdapter({
    mode: 'twin',
    accountSid: ACCOUNT_SID,
    authToken: AUTH,
    fromNumber: FROM,
    twinUrl,
  });

  app = await createApp({
    logger: false,
    env: makeTestEnv(),
    sessionStore: createMemorySessionStore(),
    emailAdapter: createStdoutEmailAdapter(),
  });
});

afterAll(async () => {
  await cleanupTestTenants(PREFIX);
  await app.close();
  await twin.app.close();
});

async function freshTenant(plan: PlanTier): Promise<{ tenantId: string; client: DbClient }> {
  const ts = Date.now() + Math.floor(Math.random() * 100000);
  const tenant = await signup(app, PREFIX, `ta-${ts}`, `ta-${ts}`);
  await db.global.tenant.update({
    where: { id: tenant.tenantId },
    data: { plan },
  });
  const client = await db.forTenant(tenant.tenantId).client.create({
    data: {
      name: 'Test Customer',
      phone: '+19725550199',
      addressStreet: '1 A St',
      addressCity: 'Plano',
      addressState: 'TX',
      addressZip: '75024',
    },
  });
  return { tenantId: tenant.tenantId, client };
}

beforeEach(async () => {
  await cleanupTestTenants(PREFIX);
  await twin.app.inject({ method: 'POST', url: '/__twin_reset' });
});

describe('twilio adapter ↔ twin — outbound SMS', () => {
  it('pro tenant + non-opted-out client → SMS sent, twin records it, audit row = sent', async () => {
    const { tenantId, client } = await freshTenant(PlanTier.pro);
    const res = await adapter.sendSms({
      toE164: '+19725550199',
      body: 'Hi Carlos, this is Bobs Grooming confirming Bruno on Monday',
      idempotencyKey: `booking-confirmation:${client.id}-1`,
      tenantId,
      clientId: client.id,
    });
    expect(res.sent).toBe(true);
    if (!res.sent) throw new Error('expected sent');
    expect(res.twilioSid).toMatch(/^SM_TWIN_/);

    const audit = await db.forTenant(tenantId).smsMessage.findFirst({
      where: { id: res.smsMessageId },
    });
    expect(audit?.status).toBe(SmsStatus.sent);
    expect(audit?.direction).toBe(SmsDirection.out);
    expect(audit?.twilioSid).toBe(res.twilioSid);
    expect(audit?.body.endsWith(' Reply STOP to opt out.')).toBe(true);

    const log = await twin.app.inject({ method: 'GET', url: '/__twin_messages' });
    const messages = (log.json() as { messages: Array<{ body: string }> }).messages;
    expect(messages).toHaveLength(1);
    expect(messages[0]!.body.endsWith(' Reply STOP to opt out.')).toBe(true);
  });

  it('starter tenant → tier_gated short-circuit, no twin call, audit row = skipped_tier', async () => {
    const { tenantId, client } = await freshTenant(PlanTier.starter);
    const res = await adapter.sendSms({
      toE164: '+19725550199',
      body: 'Hi',
      idempotencyKey: `booking-confirmation:${client.id}-tier`,
      tenantId,
      clientId: client.id,
    });
    expect(res.sent).toBe(false);
    if (res.sent) throw new Error('unreachable');
    expect(res.reason).toBe('tier_gated');

    const audit = await db.forTenant(tenantId).smsMessage.findFirst({
      where: { id: res.smsMessageId },
    });
    expect(audit?.status).toBe(SmsStatus.skipped_tier);

    const log = await twin.app.inject({ method: 'GET', url: '/__twin_messages' });
    expect((log.json() as { messages: unknown[] }).messages).toHaveLength(0);
  });

  it('opted-out client → opted_out short-circuit, no twin call, audit row = skipped_opt_out', async () => {
    const { tenantId, client } = await freshTenant(PlanTier.pro);
    await db.forTenant(tenantId).client.update({
      where: { id: client.id },
      data: { smsOptOut: true, smsOptOutAt: new Date() },
    });
    const res = await adapter.sendSms({
      toE164: '+19725550199',
      body: 'Hi',
      idempotencyKey: `booking-confirmation:${client.id}-opt`,
      tenantId,
      clientId: client.id,
    });
    expect(res.sent).toBe(false);
    if (res.sent) throw new Error('unreachable');
    expect(res.reason).toBe('opted_out');

    const audit = await db.forTenant(tenantId).smsMessage.findFirst({
      where: { id: res.smsMessageId },
    });
    expect(audit?.status).toBe(SmsStatus.skipped_opt_out);

    const log = await twin.app.inject({ method: 'GET', url: '/__twin_messages' });
    expect((log.json() as { messages: unknown[] }).messages).toHaveLength(0);
  });

  it('idempotency: same key twice → second call short-circuits to duplicate, one twin message', async () => {
    const { tenantId, client } = await freshTenant(PlanTier.pro);
    const key = `booking-confirmation:${client.id}-dupe`;
    const first = await adapter.sendSms({
      toE164: '+19725550199',
      body: 'Hi unique',
      idempotencyKey: key,
      tenantId,
      clientId: client.id,
    });
    expect(first.sent).toBe(true);

    const second = await adapter.sendSms({
      toE164: '+19725550199',
      body: 'Hi unique',
      idempotencyKey: key,
      tenantId,
      clientId: client.id,
    });
    expect(second.sent).toBe(false);
    if (second.sent) throw new Error('unreachable');
    expect(second.reason).toBe('duplicate');
    if (first.sent) {
      expect(second.smsMessageId).toBe(first.smsMessageId);
    }

    const rows = await db.forTenant(tenantId).smsMessage.findMany({
      where: { idempotencyKey: key },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe(SmsStatus.sent);
  });

  it('truncates body > 160 chars and preserves the STOP suffix', async () => {
    const { tenantId, client } = await freshTenant(PlanTier.pro);
    const longBody = 'A'.repeat(300);
    const res = await adapter.sendSms({
      toE164: '+19725550199',
      body: longBody,
      idempotencyKey: `booking-confirmation:${client.id}-trunc`,
      tenantId,
      clientId: client.id,
    });
    expect(res.sent).toBe(true);
    if (!res.sent) throw new Error('expected sent');
    const audit = await db.forTenant(tenantId).smsMessage.findFirst({
      where: { id: res.smsMessageId },
    });
    expect(audit?.body.length).toBeLessThanOrEqual(160);
    expect(audit?.body.endsWith(' Reply STOP to opt out.')).toBe(true);
    expect(audit?.body).toContain('…');
  });
});
