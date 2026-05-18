import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp as createGeocodeTwinApp } from '@mygroomtime/twin-geocode';
import { createApp as createGmapsTwinApp } from '@mygroomtime/twin-google-maps';
import { db, PlanTier, AppointmentStatus, CoatType } from '@mygroomtime/db';
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
} from '../appointments/test-helpers.js';

const SLUG_PREFIX = 'dashboard-route-test-';

async function seedClientPetService(
  tenantId: string,
): Promise<{ clientId: string; petId: string; serviceId: string }> {
  const scoped = db.forTenant(tenantId);
  const client = await scoped.client.create({
    data: {
      name: 'Sample Owner',
      phone: '+19725550199',
      addressStreet: '1234 Oak St',
      addressCity: 'Plano',
      addressState: 'TX',
      addressZip: '75024',
    },
  });
  const pet = await scoped.pet.create({
    data: {
      clientId: client.id,
      name: 'Rex',
      breed: 'Labrador',
      coatType: CoatType.short,
    },
  });
  const service = await scoped.service.create({
    data: {
      name: 'Full Groom',
      durationMin: 60,
      basePriceCents: 8500,
      depositCents: 2000,
      color: '#2563eb',
      active: true,
    },
  });
  return { clientId: client.id, petId: pet.id, serviceId: service.id };
}

describe('GET /dashboard routes', () => {
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
    tenant = await signup(app, SLUG_PREFIX, `dr-${ts}`, `dr-${ts}`);
    await db.global.tenant.update({
      where: { id: tenant.tenantId },
      data: { plan: PlanTier.pro },
    });
  });

  it('GET /dashboard 401 without cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/dashboard' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /dashboard returns the summary payload + Cache-Control', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/dashboard',
      headers: { cookie: tenant.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('private, max-age=30');
    const body = res.json() as {
      revenue: { dayCents: number };
      noShow: { rate: number };
      duration: { avgMin: number | null };
      topClients: { rows: unknown[] };
      gaps: { rows: unknown[]; gated: boolean };
    };
    expect(body.revenue.dayCents).toBe(0);
    expect(body.noShow.rate).toBe(0);
    expect(body.duration.avgMin).toBeNull();
    expect(body.topClients.rows).toEqual([]);
    expect(body.gaps.gated).toBe(false);
  });

  it('GET /dashboard on starter tenant: gaps gated, other widgets normal', async () => {
    await db.global.tenant.update({
      where: { id: tenant.tenantId },
      data: { plan: PlanTier.starter },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/dashboard',
      headers: { cookie: tenant.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      gaps: { gated: boolean; gatedReason: string };
    };
    expect(body.gaps.gated).toBe(true);
    expect(body.gaps.gatedReason).toBe('recurring_requires_pro');
  });

  it('GET /dashboard/revenue?period=week returns buckets', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/dashboard/revenue?period=week',
      headers: { cookie: tenant.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { period: string; buckets: unknown[] };
    expect(body.period).toBe('week');
    expect(Array.isArray(body.buckets)).toBe(true);
  });

  it('GET /dashboard/revenue?period=bogus → 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/dashboard/revenue?period=bogus',
      headers: { cookie: tenant.cookie },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /dashboard/no-shows paginates', async () => {
    const { clientId, petId, serviceId } = await seedClientPetService(tenant.tenantId);
    const scoped = db.forTenant(tenant.tenantId);
    const now = new Date();
    for (let i = 0; i < 5; i++) {
      const at = new Date(now.getTime() - (i + 1) * 24 * 60 * 60_000);
      await scoped.appointment.create({
        data: {
          clientId,
          petId,
          serviceId,
          status: AppointmentStatus.no_show,
          scheduledStart: at,
          durationMin: 60,
          serviceNameSnapshot: 'Full Groom',
          servicePriceCentsSnapshot: 8500,
          serviceDepositCentsSnapshot: 2000,
          serviceColorSnapshot: '#2563eb',
          serviceDurationMinSnapshot: 60,
          noShowAt: at,
        },
      });
    }
    const res = await app.inject({
      method: 'GET',
      url: '/dashboard/no-shows?pageSize=2',
      headers: { cookie: tenant.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      rows: { appointmentId: string }[];
      pagination: { total: number; page: number; pageSize: number };
    };
    expect(body.rows).toHaveLength(2);
    expect(body.pagination.total).toBe(5);
    expect(body.pagination.pageSize).toBe(2);
  });

  it('GET /dashboard/top-clients returns ranked list', async () => {
    const { clientId, petId, serviceId } = await seedClientPetService(tenant.tenantId);
    const scoped = db.forTenant(tenant.tenantId);
    const now = new Date();
    for (let i = 0; i < 3; i++) {
      const at = new Date(now.getTime() - (i + 1) * 24 * 60 * 60_000);
      await scoped.appointment.create({
        data: {
          clientId,
          petId,
          serviceId,
          status: AppointmentStatus.completed,
          scheduledStart: at,
          durationMin: 60,
          serviceNameSnapshot: 'Full Groom',
          servicePriceCentsSnapshot: 8500,
          serviceDepositCentsSnapshot: 2000,
          serviceColorSnapshot: '#2563eb',
          serviceDurationMinSnapshot: 60,
          completedAt: at,
          finalAmountCents: 10_000,
        },
      });
    }
    const res = await app.inject({
      method: 'GET',
      url: '/dashboard/top-clients',
      headers: { cookie: tenant.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      rows: { clientId: string; totalCents: number }[];
    };
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]?.totalCents).toBe(30_000);
  });

  it('GET /dashboard/gaps-to-fill on starter: gated with empty rows', async () => {
    await db.global.tenant.update({
      where: { id: tenant.tenantId },
      data: { plan: PlanTier.starter },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/dashboard/gaps-to-fill',
      headers: { cookie: tenant.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { gated: boolean; rows: unknown[] };
    expect(body.gated).toBe(true);
    expect(body.rows).toEqual([]);
  });

  it('GET /dashboard/gaps-to-fill on pro: returns ungated list (empty for fresh tenant)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/dashboard/gaps-to-fill',
      headers: { cookie: tenant.cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { gated: boolean; rows: unknown[] };
    expect(body.gated).toBe(false);
    expect(body.rows).toEqual([]);
  });
});
