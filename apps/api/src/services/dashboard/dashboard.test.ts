import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp as createGeocodeTwinApp } from '@mygroomtime/twin-geocode';
import { createApp as createGmapsTwinApp } from '@mygroomtime/twin-google-maps';
import {
  db,
  PlanTier,
  AppointmentStatus,
  CoatType,
  type Appointment,
} from '@mygroomtime/db';
import { createApp } from '../../app.js';
import { createMemorySessionStore } from '../../adapters/session/index.js';
import { createStdoutEmailAdapter } from '../../adapters/email/index.js';
import { createGeocodeAdapter } from '../../adapters/geocode/index.js';
import { createGmapsAdapter } from '../../adapters/gmaps/index.js';
import { makeTestEnv } from '../../test-utils/env.js';
import {
  cleanupTestTenants,
  signup,
  type TestTenant,
} from '../../routes/appointments/test-helpers.js';
import { getRevenue, getRevenueBuckets } from './revenue.js';
import { getNoShowRate, listNoShows } from './no-show-rate.js';
import { getTopClients } from './top-clients.js';
import { getGapsToFill } from './gaps-to-fill.js';
import { getAvgDuration } from './duration.js';
import { getDashboardSummary } from './index.js';

const SLUG_PREFIX = 'dashboard-test-';

type SeedAppointmentInput = {
  tenantId: string;
  clientId: string;
  petId: string;
  serviceId: string;
  status: AppointmentStatus;
  scheduledStart: Date;
  finalAmountCents?: number | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  noShowAt?: Date | null;
  recurringSeriesId?: string | null;
};

async function seedAppointment(input: SeedAppointmentInput): Promise<Appointment> {
  const scoped = db.forTenant(input.tenantId);
  return (await scoped.appointment.create({
    data: {
      clientId: input.clientId,
      petId: input.petId,
      serviceId: input.serviceId,
      status: input.status,
      scheduledStart: input.scheduledStart,
      durationMin: 60,
      serviceNameSnapshot: 'Full Groom',
      servicePriceCentsSnapshot: 8500,
      serviceDepositCentsSnapshot: 2000,
      serviceColorSnapshot: '#2563eb',
      serviceDurationMinSnapshot: 60,
      tipCents: 0,
      finalAmountCents: input.finalAmountCents ?? null,
      startedAt: input.startedAt ?? null,
      completedAt: input.completedAt ?? null,
      noShowAt: input.noShowAt ?? null,
      recurringSeriesId: input.recurringSeriesId ?? null,
    },
  })) as Appointment;
}

async function seedTenantWithClients(
  tenant: TestTenant,
  clientCount: number,
): Promise<{
  clientIds: string[];
  petIds: string[];
  serviceId: string;
}> {
  const scoped = db.forTenant(tenant.tenantId);
  const clientIds: string[] = [];
  const petIds: string[] = [];
  for (let i = 0; i < clientCount; i++) {
    const c = await scoped.client.create({
      data: {
        name: `Client ${i}`,
        phone: `+1972555${String(1000 + i).padStart(4, '0')}`,
        addressStreet: `${100 + i} Oak St`,
        addressCity: 'Plano',
        addressState: 'TX',
        addressZip: '75024',
      },
    });
    const p = await scoped.pet.create({
      data: {
        clientId: c.id,
        name: `Pet ${i}`,
        breed: 'Mix',
        coatType: CoatType.short,
      },
    });
    clientIds.push(c.id);
    petIds.push(p.id);
  }
  const svc = await scoped.service.create({
    data: {
      name: 'Full Groom',
      durationMin: 60,
      basePriceCents: 8500,
      depositCents: 2000,
      color: '#2563eb',
      active: true,
    },
  });
  return { clientIds, petIds, serviceId: svc.id };
}

function daysAgo(now: Date, days: number): Date {
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  return d;
}

describe('dashboard services', () => {
  let app: FastifyInstance;
  let geocodeTwin: FastifyInstance;
  let gmapsTwin: FastifyInstance;
  let tenant: TestTenant;

  beforeAll(async () => {
    geocodeTwin = createGeocodeTwinApp({ logger: false });
    await geocodeTwin.listen({ port: 0, host: '127.0.0.1' });
    const geocodePort = (geocodeTwin.server.address() as { port: number }).port;

    gmapsTwin = createGmapsTwinApp({ logger: false });
    await gmapsTwin.listen({ port: 0, host: '127.0.0.1' });
    const gmapsPort = (gmapsTwin.server.address() as { port: number }).port;

    app = await createApp({
      logger: false,
      env: makeTestEnv(),
      sessionStore: createMemorySessionStore(),
      emailAdapter: createStdoutEmailAdapter(),
      adapters: {
        geocode: createGeocodeAdapter({
          mode: 'twin',
          apiKey: '',
          twinUrl: `http://127.0.0.1:${geocodePort}`,
        }),
        gmaps: createGmapsAdapter({
          mode: 'twin',
          apiKey: '',
          twinUrl: `http://127.0.0.1:${gmapsPort}`,
        }),
      },
    });
  });

  afterAll(async () => {
    await cleanupTestTenants(SLUG_PREFIX);
    await app.close();
    await geocodeTwin.close();
    await gmapsTwin.close();
  });

  beforeEach(async () => {
    await cleanupTestTenants(SLUG_PREFIX);
    const ts = Date.now() + Math.floor(Math.random() * 1000);
    tenant = await signup(app, SLUG_PREFIX, `db-${ts}`, `db-${ts}`);
    await db.global.tenant.update({
      where: { id: tenant.tenantId },
      data: { plan: PlanTier.pro },
    });
  });

  describe('getRevenue', () => {
    it('sums finalAmountCents across day/week/month with hand-calculated fixtures', async () => {
      const now = new Date('2026-05-15T18:00:00.000Z');
      const { clientIds, petIds, serviceId } = await seedTenantWithClients(tenant, 2);
      // Today (within day, week, month) — 12000
      await seedAppointment({
        tenantId: tenant.tenantId,
        clientId: clientIds[0]!,
        petId: petIds[0]!,
        serviceId,
        status: AppointmentStatus.completed,
        scheduledStart: new Date('2026-05-15T10:00:00.000Z'),
        completedAt: new Date('2026-05-15T11:00:00.000Z'),
        finalAmountCents: 12_000,
      });
      // Earlier this week (in week + month, not in day) — 8000
      await seedAppointment({
        tenantId: tenant.tenantId,
        clientId: clientIds[0]!,
        petId: petIds[0]!,
        serviceId,
        status: AppointmentStatus.completed,
        scheduledStart: new Date('2026-05-12T10:00:00.000Z'),
        completedAt: new Date('2026-05-12T11:00:00.000Z'),
        finalAmountCents: 8_000,
      });
      // Earlier this month (in month, not week) — 5000
      await seedAppointment({
        tenantId: tenant.tenantId,
        clientId: clientIds[1]!,
        petId: petIds[1]!,
        serviceId,
        status: AppointmentStatus.completed,
        scheduledStart: new Date('2026-05-02T10:00:00.000Z'),
        completedAt: new Date('2026-05-02T11:00:00.000Z'),
        finalAmountCents: 5_000,
      });
      // Last month — not in any window — 99999
      await seedAppointment({
        tenantId: tenant.tenantId,
        clientId: clientIds[1]!,
        petId: petIds[1]!,
        serviceId,
        status: AppointmentStatus.completed,
        scheduledStart: new Date('2026-04-29T10:00:00.000Z'),
        completedAt: new Date('2026-04-29T11:00:00.000Z'),
        finalAmountCents: 99_999,
      });
      // Scheduled (not completed) — excluded entirely
      await seedAppointment({
        tenantId: tenant.tenantId,
        clientId: clientIds[0]!,
        petId: petIds[0]!,
        serviceId,
        status: AppointmentStatus.scheduled,
        scheduledStart: new Date('2026-05-20T10:00:00.000Z'),
      });

      const r = await getRevenue({ tenantId: tenant.tenantId, now });
      expect(r.dayCents).toBe(12_000);
      expect(r.weekCents).toBe(20_000);
      expect(r.monthCents).toBe(25_000);
    });

    it('empty tenant: returns zeros, no throw', async () => {
      const r = await getRevenue({ tenantId: tenant.tenantId });
      expect(r).toEqual({ dayCents: 0, weekCents: 0, monthCents: 0 });
    });

    it('falls back to servicePriceCentsSnapshot when finalAmountCents is null', async () => {
      const now = new Date('2026-05-15T18:00:00.000Z');
      const { clientIds, petIds, serviceId } = await seedTenantWithClients(tenant, 1);
      await seedAppointment({
        tenantId: tenant.tenantId,
        clientId: clientIds[0]!,
        petId: petIds[0]!,
        serviceId,
        status: AppointmentStatus.completed,
        scheduledStart: new Date('2026-05-15T10:00:00.000Z'),
        completedAt: new Date('2026-05-15T11:00:00.000Z'),
        finalAmountCents: null,
      });
      const r = await getRevenue({ tenantId: tenant.tenantId, now });
      expect(r.dayCents).toBe(8500);
    });
  });

  describe('getRevenueBuckets', () => {
    it('week period returns one bucket per day with zeros for empty days', async () => {
      const now = new Date('2026-05-15T18:00:00.000Z'); // Friday
      const { clientIds, petIds, serviceId } = await seedTenantWithClients(tenant, 1);
      await seedAppointment({
        tenantId: tenant.tenantId,
        clientId: clientIds[0]!,
        petId: petIds[0]!,
        serviceId,
        status: AppointmentStatus.completed,
        scheduledStart: new Date('2026-05-13T10:00:00.000Z'),
        completedAt: new Date('2026-05-13T11:00:00.000Z'),
        finalAmountCents: 7_000,
      });
      const buckets = await getRevenueBuckets({
        tenantId: tenant.tenantId,
        period: 'week',
        now,
      });
      // start-of-week Sun May 10 → Fri May 15 = 6 buckets
      expect(buckets.length).toBeGreaterThanOrEqual(5);
      const wed = buckets.find((b) => b.dateIso === '2026-05-13');
      expect(wed?.revenueCents).toBe(7_000);
      expect(wed?.appointmentCount).toBe(1);
    });
  });

  describe('getNoShowRate', () => {
    it('count(no_show) / count(completed+no_show) over completedAt OR noShowAt', async () => {
      const now = new Date('2026-05-15T18:00:00.000Z');
      const { clientIds, petIds, serviceId } = await seedTenantWithClients(tenant, 1);
      // 3 completed, 1 no_show in window → 1/4 = 0.25
      for (let i = 0; i < 3; i++) {
        await seedAppointment({
          tenantId: tenant.tenantId,
          clientId: clientIds[0]!,
          petId: petIds[0]!,
          serviceId,
          status: AppointmentStatus.completed,
          scheduledStart: daysAgo(now, i + 1),
          completedAt: daysAgo(now, i + 1),
        });
      }
      await seedAppointment({
        tenantId: tenant.tenantId,
        clientId: clientIds[0]!,
        petId: petIds[0]!,
        serviceId,
        status: AppointmentStatus.no_show,
        scheduledStart: daysAgo(now, 2),
        noShowAt: daysAgo(now, 2),
      });
      // Scheduled future appointment excluded
      await seedAppointment({
        tenantId: tenant.tenantId,
        clientId: clientIds[0]!,
        petId: petIds[0]!,
        serviceId,
        status: AppointmentStatus.scheduled,
        scheduledStart: daysAgo(now, -5),
      });
      const r = await getNoShowRate({ tenantId: tenant.tenantId, now, days: 30 });
      expect(r.sampleSize).toBe(4);
      expect(r.rate).toBe(0.25);
      expect(r.windowDays).toBe(30);
    });

    it('empty: rate 0, sampleSize 0', async () => {
      const r = await getNoShowRate({ tenantId: tenant.tenantId });
      expect(r).toEqual({ rate: 0, sampleSize: 0, windowDays: 30 });
    });

    it('listNoShows returns paginated rows with client + pet info', async () => {
      const now = new Date('2026-05-15T18:00:00.000Z');
      const { clientIds, petIds, serviceId } = await seedTenantWithClients(tenant, 1);
      for (let i = 0; i < 5; i++) {
        await seedAppointment({
          tenantId: tenant.tenantId,
          clientId: clientIds[0]!,
          petId: petIds[0]!,
          serviceId,
          status: AppointmentStatus.no_show,
          scheduledStart: daysAgo(now, i + 1),
          noShowAt: daysAgo(now, i + 1),
        });
      }
      const list = await listNoShows({
        tenantId: tenant.tenantId,
        now,
        page: 1,
        pageSize: 3,
      });
      expect(list.total).toBe(5);
      expect(list.rows).toHaveLength(3);
      expect(list.rows[0]?.clientName).toBe('Client 0');
      expect(list.rows[0]?.petName).toBe('Pet 0');
    });
  });

  describe('getTopClients', () => {
    it('ranks completed-revenue desc with isDeleted flag preserved', async () => {
      const now = new Date('2026-05-15T18:00:00.000Z');
      const { clientIds, petIds, serviceId } = await seedTenantWithClients(tenant, 3);
      // Client 0: 2 visits, $200 total
      // Client 1: 1 visit, $150 (also soft-deleted)
      // Client 2: 3 visits, $90 total (cheap)
      await seedAppointment({
        tenantId: tenant.tenantId,
        clientId: clientIds[0]!,
        petId: petIds[0]!,
        serviceId,
        status: AppointmentStatus.completed,
        scheduledStart: daysAgo(now, 5),
        completedAt: daysAgo(now, 5),
        finalAmountCents: 10_000,
      });
      await seedAppointment({
        tenantId: tenant.tenantId,
        clientId: clientIds[0]!,
        petId: petIds[0]!,
        serviceId,
        status: AppointmentStatus.completed,
        scheduledStart: daysAgo(now, 10),
        completedAt: daysAgo(now, 10),
        finalAmountCents: 10_000,
      });
      await seedAppointment({
        tenantId: tenant.tenantId,
        clientId: clientIds[1]!,
        petId: petIds[1]!,
        serviceId,
        status: AppointmentStatus.completed,
        scheduledStart: daysAgo(now, 7),
        completedAt: daysAgo(now, 7),
        finalAmountCents: 15_000,
      });
      for (let i = 0; i < 3; i++) {
        await seedAppointment({
          tenantId: tenant.tenantId,
          clientId: clientIds[2]!,
          petId: petIds[2]!,
          serviceId,
          status: AppointmentStatus.completed,
          scheduledStart: daysAgo(now, 12 + i),
          completedAt: daysAgo(now, 12 + i),
          finalAmountCents: 3_000,
        });
      }
      // Soft-delete client 1
      await db
        .forTenant(tenant.tenantId)
        .client.update({ where: { id: clientIds[1]! }, data: { deletedAt: new Date() } });

      const out = await getTopClients({ tenantId: tenant.tenantId, now, limit: 5 });
      expect(out.rows[0]?.clientId).toBe(clientIds[0]);
      expect(out.rows[0]?.totalCents).toBe(20_000);
      expect(out.rows[0]?.appointmentCount).toBe(2);
      expect(out.rows[1]?.clientId).toBe(clientIds[1]);
      expect(out.rows[1]?.totalCents).toBe(15_000);
      expect(out.rows[1]?.isDeleted).toBe(true);
      expect(out.rows[2]?.clientId).toBe(clientIds[2]);
      expect(out.rows[2]?.totalCents).toBe(9_000);
    });
  });

  describe('getGapsToFill', () => {
    it('surfaces series whose last completed > interval + 7d ago, skips series with no completed parent', async () => {
      const now = new Date('2026-05-15T18:00:00.000Z');
      const { clientIds, petIds, serviceId } = await seedTenantWithClients(tenant, 2);
      const scoped = db.forTenant(tenant.tenantId);

      const overdueSeries = await scoped.recurringSeries.create({
        data: {
          clientId: clientIds[0]!,
          petId: petIds[0]!,
          serviceId,
          intervalWeeks: 4,
          nextDueDate: new Date('2026-06-01T10:00:00.000Z'),
          active: true,
        },
      });
      // last completed 40 days ago — interval 4w=28d + 7 = 35d threshold. 40 > 35 → overdue
      await seedAppointment({
        tenantId: tenant.tenantId,
        clientId: clientIds[0]!,
        petId: petIds[0]!,
        serviceId,
        status: AppointmentStatus.completed,
        scheduledStart: daysAgo(now, 40),
        completedAt: daysAgo(now, 40),
        recurringSeriesId: overdueSeries.id,
      });
      // Second series: active but no completed parent → skip
      await scoped.recurringSeries.create({
        data: {
          clientId: clientIds[1]!,
          petId: petIds[1]!,
          serviceId,
          intervalWeeks: 4,
          nextDueDate: new Date('2026-06-15T10:00:00.000Z'),
          active: true,
        },
      });

      const rows = await getGapsToFill({ tenantId: tenant.tenantId, now });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.seriesId).toBe(overdueSeries.id);
      expect(rows[0]?.daysOverdue).toBeGreaterThan(7);
      expect(rows[0]?.intervalWeeks).toBe(4);
      expect(rows[0]?.clientName).toBe('Client 0');
      expect(rows[0]?.petName).toBe('Pet 0');
    });

    it('on-time series (within interval + 7d) does not appear', async () => {
      const now = new Date('2026-05-15T18:00:00.000Z');
      const { clientIds, petIds, serviceId } = await seedTenantWithClients(tenant, 1);
      const scoped = db.forTenant(tenant.tenantId);
      const series = await scoped.recurringSeries.create({
        data: {
          clientId: clientIds[0]!,
          petId: petIds[0]!,
          serviceId,
          intervalWeeks: 6,
          nextDueDate: new Date('2026-06-01T10:00:00.000Z'),
          active: true,
        },
      });
      // Last completed 30 days ago: interval 6w=42 + 7 = 49 threshold. 30 < 49 → not overdue.
      await seedAppointment({
        tenantId: tenant.tenantId,
        clientId: clientIds[0]!,
        petId: petIds[0]!,
        serviceId,
        status: AppointmentStatus.completed,
        scheduledStart: daysAgo(now, 30),
        completedAt: daysAgo(now, 30),
        recurringSeriesId: series.id,
      });
      const rows = await getGapsToFill({ tenantId: tenant.tenantId, now });
      expect(rows).toHaveLength(0);
    });
  });

  describe('getAvgDuration', () => {
    it('avg = mean(completedAt - startedAt) in minutes, rounded', async () => {
      const now = new Date('2026-05-15T18:00:00.000Z');
      const { clientIds, petIds, serviceId } = await seedTenantWithClients(tenant, 1);
      // 60min, 90min, 45min → avg 65min
      await seedAppointment({
        tenantId: tenant.tenantId,
        clientId: clientIds[0]!,
        petId: petIds[0]!,
        serviceId,
        status: AppointmentStatus.completed,
        scheduledStart: daysAgo(now, 5),
        startedAt: new Date(daysAgo(now, 5).getTime()),
        completedAt: new Date(daysAgo(now, 5).getTime() + 60 * 60_000),
      });
      await seedAppointment({
        tenantId: tenant.tenantId,
        clientId: clientIds[0]!,
        petId: petIds[0]!,
        serviceId,
        status: AppointmentStatus.completed,
        scheduledStart: daysAgo(now, 6),
        startedAt: new Date(daysAgo(now, 6).getTime()),
        completedAt: new Date(daysAgo(now, 6).getTime() + 90 * 60_000),
      });
      await seedAppointment({
        tenantId: tenant.tenantId,
        clientId: clientIds[0]!,
        petId: petIds[0]!,
        serviceId,
        status: AppointmentStatus.completed,
        scheduledStart: daysAgo(now, 7),
        startedAt: new Date(daysAgo(now, 7).getTime()),
        completedAt: new Date(daysAgo(now, 7).getTime() + 45 * 60_000),
      });
      const r = await getAvgDuration({ tenantId: tenant.tenantId, now });
      expect(r.avgMin).toBe(65);
      expect(r.sampleSize).toBe(3);
    });

    it('empty: avgMin null, sampleSize 0', async () => {
      const r = await getAvgDuration({ tenantId: tenant.tenantId });
      expect(r.avgMin).toBeNull();
      expect(r.sampleSize).toBe(0);
    });
  });

  describe('getDashboardSummary', () => {
    it('empty tenant returns zeros across the board, gaps not gated for pro', async () => {
      const out = await getDashboardSummary({
        tenantId: tenant.tenantId,
        plan: 'pro',
      });
      expect(out.revenue.dayCents).toBe(0);
      expect(out.noShow.sampleSize).toBe(0);
      expect(out.duration.avgMin).toBeNull();
      expect(out.topClients.rows).toEqual([]);
      expect(out.gaps.gated).toBe(false);
      expect(out.gaps.rows).toEqual([]);
    });

    it('starter plan: gaps come back gated with no rows', async () => {
      const out = await getDashboardSummary({
        tenantId: tenant.tenantId,
        plan: 'starter',
      });
      expect(out.gaps.gated).toBe(true);
      expect(out.gaps.gatedReason).toBe('recurring_requires_pro');
    });
  });

  describe('tenant isolation', () => {
    it('tenant A revenue does not leak into tenant B', async () => {
      const tsA = Date.now() + 1000;
      const tsB = Date.now() + 2000;
      const tA = await signup(app, SLUG_PREFIX, `iso-a-${tsA}`, `iso-a-${tsA}`);
      const tB = await signup(app, SLUG_PREFIX, `iso-b-${tsB}`, `iso-b-${tsB}`);
      await db.global.tenant.update({
        where: { id: tA.tenantId },
        data: { plan: PlanTier.pro },
      });
      await db.global.tenant.update({
        where: { id: tB.tenantId },
        data: { plan: PlanTier.pro },
      });
      const now = new Date('2026-05-15T18:00:00.000Z');
      const a = await seedTenantWithClients(tA, 1);
      await seedAppointment({
        tenantId: tA.tenantId,
        clientId: a.clientIds[0]!,
        petId: a.petIds[0]!,
        serviceId: a.serviceId,
        status: AppointmentStatus.completed,
        scheduledStart: new Date('2026-05-15T10:00:00.000Z'),
        completedAt: new Date('2026-05-15T11:00:00.000Z'),
        finalAmountCents: 50_000,
      });
      await seedTenantWithClients(tB, 0);

      const ra = await getRevenue({ tenantId: tA.tenantId, now });
      const rb = await getRevenue({ tenantId: tB.tenantId, now });
      expect(ra.dayCents).toBe(50_000);
      expect(rb.dayCents).toBe(0);
    });
  });

  describe('performance smoke', () => {
    it('getDashboardSummary returns in < 200ms with 1000 completed appointments', async () => {
      const { clientIds, petIds, serviceId } = await seedTenantWithClients(tenant, 20);
      const now = new Date();
      const rows: SeedAppointmentInput[] = [];
      for (let i = 0; i < 1000; i++) {
        const offsetDays = i % 80; // spread across ~3 months
        const at = daysAgo(now, offsetDays);
        rows.push({
          tenantId: tenant.tenantId,
          clientId: clientIds[i % clientIds.length]!,
          petId: petIds[i % petIds.length]!,
          serviceId,
          status: AppointmentStatus.completed,
          scheduledStart: at,
          completedAt: at,
          startedAt: new Date(at.getTime() - 60 * 60_000),
          finalAmountCents: 5_000 + (i % 7) * 1_000,
        });
      }
      // Bulk insert via createMany is way faster than 1000 round-trips.
      const scoped = db.forTenant(tenant.tenantId);
      await scoped.appointment.createMany({
        data: rows.map((r) => ({
          clientId: r.clientId,
          petId: r.petId,
          serviceId: r.serviceId,
          status: r.status,
          scheduledStart: r.scheduledStart,
          durationMin: 60,
          serviceNameSnapshot: 'Full Groom',
          servicePriceCentsSnapshot: 8500,
          serviceDepositCentsSnapshot: 2000,
          serviceColorSnapshot: '#2563eb',
          serviceDurationMinSnapshot: 60,
          tipCents: 0,
          finalAmountCents: r.finalAmountCents ?? null,
          startedAt: r.startedAt ?? null,
          completedAt: r.completedAt ?? null,
        })),
      });

      const t0 = Date.now();
      const out = await getDashboardSummary({
        tenantId: tenant.tenantId,
        plan: 'pro',
      });
      const elapsedMs = Date.now() - t0;
      // why: target is <500ms; 200ms gives 2.5x headroom against the public target.
      expect(elapsedMs).toBeLessThan(200);
      expect(out.revenue.monthCents).toBeGreaterThan(0);
    });
  });
});
