import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { db, PlanTier } from '@mygroomtime/db';
import { createApp } from '../../app.js';
import { createMemorySessionStore } from '../../adapters/session/index.js';
import { createStdoutEmailAdapter } from '../../adapters/email/index.js';
import { makeTestEnv } from '../../test-utils/env.js';
import {
  cleanupTestTenants,
  signup,
  type TestTenant,
} from '../appointments/test-helpers.js';
import { makeTestReminderInfra } from '../../queue/test-helpers.js';
import {
  enqueueAppointmentReminders,
} from '../../services/reminder-schedule.js';
import type { SettingsSmsStatus } from '@mygroomtime/shared';

const SLUG_PREFIX = 'settings-sms-test-';

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

async function freshTenant(plan: PlanTier): Promise<TestTenant> {
  const ts = Date.now() + Math.floor(Math.random() * 100000);
  const tenant = await signup(app, SLUG_PREFIX, `ss-${ts}`, `ss-${ts}`);
  await db.global.tenant.update({
    where: { id: tenant.tenantId },
    data: { plan },
  });
  return tenant;
}

describe('GET /settings/sms', () => {
  it('returns remindersEnabled=false and tierAllowsReminders=true for a Pro tenant', async () => {
    const tenant = await freshTenant(PlanTier.pro);
    const res = await app.inject({
      method: 'GET',
      url: '/settings/sms',
      headers: { cookie: tenant.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as SettingsSmsStatus;
    expect(body.remindersEnabled).toBe(false);
    expect(body.tierAllowsReminders).toBe(true);
  });

  it('returns tierAllowsReminders=false for a Starter tenant', async () => {
    const tenant = await freshTenant(PlanTier.starter);
    const res = await app.inject({
      method: 'GET',
      url: '/settings/sms',
      headers: { cookie: tenant.cookie },
    });
    const body = res.json() as SettingsSmsStatus;
    expect(body.tierAllowsReminders).toBe(false);
  });
});

describe('POST /settings/sms', () => {
  it('Pro tenant can toggle reminders on', async () => {
    const tenant = await freshTenant(PlanTier.pro);
    const res = await app.inject({
      method: 'POST',
      url: '/settings/sms',
      headers: { cookie: tenant.cookie },
      payload: { remindersEnabled: true },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as SettingsSmsStatus;
    expect(body.remindersEnabled).toBe(true);

    const fresh = await db.global.tenant.findUnique({
      where: { id: tenant.tenantId },
      select: { smsRemindersEnabled: true },
    });
    expect(fresh?.smsRemindersEnabled).toBe(true);
  });

  it('Starter tenant gets 403 when enabling', async () => {
    const tenant = await freshTenant(PlanTier.starter);
    const res = await app.inject({
      method: 'POST',
      url: '/settings/sms',
      headers: { cookie: tenant.cookie },
      payload: { remindersEnabled: true },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json() as { reason: string };
    expect(body.reason).toBe('tier_gated');
  });

  it('Toggle OFF does not walk existing scheduled jobs', async () => {
    const tenant = await freshTenant(PlanTier.pro);
    await db.global.tenant.update({
      where: { id: tenant.tenantId },
      data: { smsRemindersEnabled: true },
    });
    const infra = await makeTestReminderInfra();
    try {
      const start = new Date(Date.now() + 72 * 60 * 60 * 1000);
      await enqueueAppointmentReminders(
        infra.queue,
        { id: 'appt-stays', scheduledStart: start, durationMin: 90 },
        tenant.tenantId,
        true,
      );
      const before = await infra.queue.getJobCounts('delayed', 'wait');

      const res = await app.inject({
        method: 'POST',
        url: '/settings/sms',
        headers: { cookie: tenant.cookie },
        payload: { remindersEnabled: false },
      });
      expect(res.statusCode).toBe(200);

      const after = await infra.queue.getJobCounts('delayed', 'wait');
      expect((after.delayed ?? 0) + (after.wait ?? 0)).toBe(
        (before.delayed ?? 0) + (before.wait ?? 0),
      );
    } finally {
      await infra.close();
    }
  });
});
