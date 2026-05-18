import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp as createGeocodeTwinApp } from '@mygroomtime/twin-geocode';
import { db, AppointmentStatus, PlanTier } from '@mygroomtime/db';
import { createApp } from '../../app.js';
import { createMemorySessionStore } from '../../adapters/session/index.js';
import { createStdoutEmailAdapter } from '../../adapters/email/index.js';
import { createGeocodeAdapter } from '../../adapters/geocode/index.js';
import { makeTestEnv } from '../../test-utils/env.js';
import {
  cleanupTestTenants,
  createClientAndPet,
  createServiceFor,
  nextWeekdayAt,
  signup,
  type TestTenant,
} from '../appointments/test-helpers.js';

const SLUG_PREFIX = 'payroll-test-';

describe('payroll routes', () => {
  let app: FastifyInstance;
  let geocodeTwin: FastifyInstance;
  let business: TestTenant;
  let starter: TestTenant;

  beforeAll(async () => {
    geocodeTwin = createGeocodeTwinApp({ logger: false });
    await geocodeTwin.listen({ port: 0, host: '127.0.0.1' });
    const port = (geocodeTwin.server.address() as { port: number }).port;
    const geocodeTwinUrl = `http://127.0.0.1:${port}`;
    const env = makeTestEnv();
    app = await createApp({
      logger: false,
      env,
      sessionStore: createMemorySessionStore(),
      emailAdapter: createStdoutEmailAdapter(),
      adapters: {
        geocode: createGeocodeAdapter({ mode: 'twin', apiKey: '', twinUrl: geocodeTwinUrl }),
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
    business = await signup(app, SLUG_PREFIX, `pyB-${ts}`, `pyB-${ts}`);
    starter = await signup(app, SLUG_PREFIX, `pyS-${ts}`, `pyS-${ts}`);
    await db.global.tenant.update({
      where: { id: business.tenantId },
      data: { plan: PlanTier.business },
    });
  });

  it('starter tenant on /payroll/splits → 403 business_tier_required', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/payroll/splits?periodStart=2026-05-18T00:00:00.000Z&periodEnd=2026-06-01T00:00:00.000Z',
      headers: { cookie: starter.cookie },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json() as { error: string; reason: string };
    expect(body.error).toBe('plan_required');
    expect(body.reason).toBe('business_tier_required');
  });

  it('business tenant: splits aggregate completed appointments in the window', async () => {
    const { petId } = await createClientAndPet(app, business);
    const service = await createServiceFor(app, business, {
      name: 'Bath',
      durationMin: 60,
      basePriceCents: 5000,
      depositCents: 0,
      color: '#2563eb',
      active: true,
    });

    // why: create 2 completed appointments in this period. We use raw db writes to set
    // `status=completed`, `completedAt`, `finalAmountCents`, and `tipCents` — the public
    // routes go through the lifecycle state machine, which is more state than this test
    // needs. The payroll query reads exactly those fields.
    const owner = await db.forTenant(business.tenantId).user.findFirst({ where: {} });
    const vehicle = await db.forTenant(business.tenantId).vehicle.findFirst({ where: {} });
    if (!vehicle) {
      // lazy-create via an appointment create
      await app.inject({
        method: 'POST',
        url: '/appointments',
        headers: { cookie: business.cookie },
        payload: { petId, serviceId: service.id, start: nextWeekdayAt(10) },
      });
    }
    const v = await db.forTenant(business.tenantId).vehicle.findFirst({ where: {} });
    expect(v).not.toBeNull();

    const completedAt1 = new Date(Date.UTC(2026, 4, 19, 12, 0));
    const completedAt2 = new Date(Date.UTC(2026, 4, 21, 12, 0));
    const client = await db.forTenant(business.tenantId).client.findFirst({ where: {} });
    await db.forTenant(business.tenantId).appointment.create({
      data: {
        clientId: client!.id,
        petId,
        serviceId: service.id,
        vehicleId: v!.id,
        groomerId: owner!.id,
        status: AppointmentStatus.completed,
        scheduledStart: completedAt1,
        durationMin: 60,
        completedAt: completedAt1,
        tipCents: 1000,
        finalAmountCents: 6000,
        serviceNameSnapshot: 'Bath',
        servicePriceCentsSnapshot: 5000,
        serviceDepositCentsSnapshot: 0,
        serviceColorSnapshot: '#2563eb',
        serviceDurationMinSnapshot: 60,
      },
    });
    await db.forTenant(business.tenantId).appointment.create({
      data: {
        clientId: client!.id,
        petId,
        serviceId: service.id,
        vehicleId: v!.id,
        groomerId: owner!.id,
        status: AppointmentStatus.completed,
        scheduledStart: completedAt2,
        durationMin: 60,
        completedAt: completedAt2,
        tipCents: 500,
        finalAmountCents: 5500,
        serviceNameSnapshot: 'Bath',
        servicePriceCentsSnapshot: 5000,
        serviceDepositCentsSnapshot: 0,
        serviceColorSnapshot: '#2563eb',
        serviceDurationMinSnapshot: 60,
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/payroll/splits?periodStart=2026-05-18T00:00:00.000Z&periodEnd=2026-06-01T00:00:00.000Z',
      headers: { cookie: business.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      rows: Array<{
        appointmentsCompleted: number;
        revenueCents: number;
        tipsCents: number;
        totalCents: number;
      }>;
      totals: { appointmentsCompleted: number; revenueCents: number; tipsCents: number; totalCents: number };
    };
    expect(body.totals.appointmentsCompleted).toBe(2);
    // tips = 1000 + 500 = 1500; total = 6000 + 5500 = 11500; revenue = total - tips
    expect(body.totals.tipsCents).toBe(1500);
    expect(body.totals.totalCents).toBe(11500);
    expect(body.totals.revenueCents).toBe(10000);
  });

  it('business tenant: CSV export sets content-type + BOM + filename', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/payroll/splits.csv?periodStart=2026-05-18T00:00:00.000Z&periodEnd=2026-06-01T00:00:00.000Z',
      headers: { cookie: business.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('payroll-');
    expect(res.headers['content-disposition']).toContain('.csv');
    const body = res.body;
    expect(body.charCodeAt(0)).toBe(0xfeff);
    expect(body).toContain('period_start,period_end,groomer_email');
  });

  it('GET /payroll/periods returns weekly boundaries when tenant is weekly', async () => {
    await db.global.tenant.update({
      where: { id: business.tenantId },
      data: { payrollPeriodKind: 'weekly' },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/payroll/periods?from=2026-05-18T00:00:00.000Z&to=2026-06-01T00:00:00.000Z',
      headers: { cookie: business.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      kind: string;
      periods: Array<{ periodStart: string; periodEnd: string }>;
    };
    expect(body.kind).toBe('weekly');
    expect(body.periods.length).toBeGreaterThanOrEqual(2);
    for (const p of body.periods) {
      expect(new Date(p.periodStart).getUTCDay()).toBe(1); // Monday
    }
  });
});
