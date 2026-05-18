import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp as createGeocodeTwinApp } from '@mygroomtime/twin-geocode';
import { db, PlanTier, AppointmentStatus } from '@mygroomtime/db';
import { createApp } from '../../app.js';
import { createMemorySessionStore } from '../../adapters/session/index.js';
import { createStdoutEmailAdapter } from '../../adapters/email/index.js';
import { createGeocodeAdapter } from '../../adapters/geocode/index.js';
import { makeTestEnv } from '../../test-utils/env.js';
import {
  cleanupTestTenants,
  createClientAndPet,
  createServiceFor,
  signup,
  type TestTenant,
} from '../appointments/test-helpers.js';

const SLUG_PREFIX = 'public-test-';

async function setTenantPlan(tenantId: string, plan: PlanTier): Promise<void> {
  // why: chunk 12 added Connect-readiness to the public-tenant resolver. Existing
  // chunk-11 tests assume a Pro tenant renders as not-read-only, so flip the
  // Connect flag along with the plan to match that expectation.
  const isPaidPro = plan === PlanTier.pro || plan === PlanTier.business;
  await db.global.tenant.update({
    where: { id: tenantId },
    data: {
      plan,
      ...(isPaidPro
        ? {
            stripeConnectAccountId: `acct_test_${tenantId.slice(-6)}`,
            stripeConnectChargesEnabled: true,
            stripeConnectPayoutsEnabled: true,
          }
        : {}),
    },
  });
}

async function fetchTenantSlug(tenantId: string): Promise<string> {
  const t = await db.global.tenant.findUnique({
    where: { id: tenantId },
    select: { slug: true },
  });
  if (!t) throw new Error('tenant not found');
  return t.slug;
}

function isoDateOnlyOffsetDays(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function nextNonSunday(daysAhead: number): { iso: string; date: Date } {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  while (d.getDay() === 0) d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return { iso: `${y}-${m}-${day}`, date: d };
}

describe('public booking routes', () => {
  let app: FastifyInstance;
  let geocodeTwin: FastifyInstance;
  let tenantA: TestTenant;
  let tenantB: TestTenant;

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
    tenantA = await signup(app, SLUG_PREFIX, `pubA-${ts}`, `pubA-${ts}`);
    tenantB = await signup(app, SLUG_PREFIX, `pubB-${ts}`, `pubB-${ts}`);
  });

  it('GET /public/:slug returns 200 with services for a Pro tenant', async () => {
    await setTenantPlan(tenantA.tenantId, PlanTier.pro);
    await createServiceFor(app, tenantA);
    const slug = await fetchTenantSlug(tenantA.tenantId);

    const res = await app.inject({ method: 'GET', url: `/public/${slug}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      slug: string;
      businessName: string;
      readOnly: boolean;
      services: { name: string }[];
      currentTime: string;
    };
    expect(body.slug).toBe(slug);
    expect(body.readOnly).toBe(false);
    expect(body.services.length).toBeGreaterThan(0);
    expect(typeof body.currentTime).toBe('string');
  });

  it('404 for canceled tenant', async () => {
    await setTenantPlan(tenantA.tenantId, PlanTier.canceled);
    const slug = await fetchTenantSlug(tenantA.tenantId);
    const res = await app.inject({ method: 'GET', url: `/public/${slug}` });
    expect(res.statusCode).toBe(404);
  });

  it('404 for unpaid tenant', async () => {
    await setTenantPlan(tenantA.tenantId, PlanTier.unpaid);
    const slug = await fetchTenantSlug(tenantA.tenantId);
    const res = await app.inject({ method: 'GET', url: `/public/${slug}` });
    expect(res.statusCode).toBe(404);
  });

  it('404 for starter tier — booking page is Pro+ only', async () => {
    await setTenantPlan(tenantA.tenantId, PlanTier.starter);
    const slug = await fetchTenantSlug(tenantA.tenantId);
    const res = await app.inject({ method: 'GET', url: `/public/${slug}` });
    expect(res.statusCode).toBe(404);
  });

  it('past_due renders with readOnly=true', async () => {
    // why: signup helper bumps to starter, so create the service first while writes are
    // allowed, THEN flip to past_due — that mirrors a real tenant whose card just failed.
    await createServiceFor(app, tenantA);
    await setTenantPlan(tenantA.tenantId, PlanTier.past_due);
    const slug = await fetchTenantSlug(tenantA.tenantId);
    const res = await app.inject({ method: 'GET', url: `/public/${slug}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { readOnly: boolean };
    expect(body.readOnly).toBe(true);
  });

  it('404 for unknown slug', async () => {
    const res = await app.inject({ method: 'GET', url: '/public/does-not-exist' });
    expect(res.statusCode).toBe(404);
  });

  it('availability returns slots for a free non-Sunday day far enough out', async () => {
    await setTenantPlan(tenantA.tenantId, PlanTier.pro);
    const service = await createServiceFor(app, tenantA);
    const slug = await fetchTenantSlug(tenantA.tenantId);
    const { iso } = nextNonSunday(2);

    const res = await app.inject({
      method: 'GET',
      url: `/public/${slug}/availability?serviceId=${service.id}&date=${iso}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { slots: { start: string; durationMin: number }[] };
    expect(body.slots.length).toBeGreaterThan(0);
    expect(body.slots[0]!.durationMin).toBe(service.durationMin);
  });

  it('Sunday returns no slots (closed)', async () => {
    await setTenantPlan(tenantA.tenantId, PlanTier.pro);
    const service = await createServiceFor(app, tenantA);
    const slug = await fetchTenantSlug(tenantA.tenantId);

    const d = new Date();
    d.setDate(d.getDate() + 7);
    while (d.getDay() !== 0) d.setDate(d.getDate() + 1);
    const y = d.getFullYear();
    const m = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    const iso = `${y}-${m}-${day}`;

    const res = await app.inject({
      method: 'GET',
      url: `/public/${slug}/availability?serviceId=${service.id}&date=${iso}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { slots: unknown[] };
    expect(body.slots.length).toBe(0);
  });

  it('Lead-time filter: today returns empty (24h lead time)', async () => {
    await setTenantPlan(tenantA.tenantId, PlanTier.pro);
    const service = await createServiceFor(app, tenantA);
    const slug = await fetchTenantSlug(tenantA.tenantId);
    const today = isoDateOnlyOffsetDays(0);

    const res = await app.inject({
      method: 'GET',
      url: `/public/${slug}/availability?serviceId=${service.id}&date=${today}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { slots: unknown[] };
    expect(body.slots.length).toBe(0);
  });

  it('availability excludes slots that overlap an existing appointment', async () => {
    await setTenantPlan(tenantA.tenantId, PlanTier.pro);
    const service = await createServiceFor(app, tenantA);
    const slug = await fetchTenantSlug(tenantA.tenantId);
    const { iso, date } = nextNonSunday(2);
    const { petId, clientId } = await createClientAndPet(app, tenantA);

    const tenScoped = db.forTenant(tenantA.tenantId);
    const vehicle = await tenScoped.vehicle.create({ data: { name: 'Van 1' } });
    const tenAm = new Date(date);
    tenAm.setHours(10, 0, 0, 0);
    await tenScoped.appointment.create({
      data: {
        clientId,
        petId,
        serviceId: service.id,
        vehicleId: vehicle.id,
        status: AppointmentStatus.scheduled,
        scheduledStart: tenAm,
        durationMin: service.durationMin,
        serviceNameSnapshot: service.name,
        servicePriceCentsSnapshot: service.basePriceCents,
        serviceDepositCentsSnapshot: service.depositCents,
        serviceColorSnapshot: service.color,
        serviceDurationMinSnapshot: service.durationMin,
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/public/${slug}/availability?serviceId=${service.id}&date=${iso}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { slots: { start: string }[] };
    const tenAmIso = tenAm.toISOString();
    expect(body.slots.find((s) => s.start === tenAmIso)).toBeUndefined();
  });

  it('availability is tenant-scoped — A does not see B appointments', async () => {
    await setTenantPlan(tenantA.tenantId, PlanTier.pro);
    await setTenantPlan(tenantB.tenantId, PlanTier.pro);
    const serviceA = await createServiceFor(app, tenantA);
    const serviceB = await createServiceFor(app, tenantB);
    const slugA = await fetchTenantSlug(tenantA.tenantId);
    const { iso, date } = nextNonSunday(2);

    const { petId: bPet, clientId: bClient } = await createClientAndPet(app, tenantB);
    const bScoped = db.forTenant(tenantB.tenantId);
    const bVehicle = await bScoped.vehicle.create({ data: { name: 'Van B' } });
    const slotTime = new Date(date);
    slotTime.setHours(10, 0, 0, 0);
    await bScoped.appointment.create({
      data: {
        clientId: bClient,
        petId: bPet,
        serviceId: serviceB.id,
        vehicleId: bVehicle.id,
        status: AppointmentStatus.scheduled,
        scheduledStart: slotTime,
        durationMin: serviceB.durationMin,
        serviceNameSnapshot: serviceB.name,
        servicePriceCentsSnapshot: serviceB.basePriceCents,
        serviceDepositCentsSnapshot: serviceB.depositCents,
        serviceColorSnapshot: serviceB.color,
        serviceDurationMinSnapshot: serviceB.durationMin,
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/public/${slugA}/availability?serviceId=${serviceA.id}&date=${iso}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { slots: { start: string }[] };
    expect(body.slots.find((s) => s.start === slotTime.toISOString())).toBeDefined();
  });

  it('availability 404s when service does not exist for the tenant', async () => {
    await setTenantPlan(tenantA.tenantId, PlanTier.pro);
    const slug = await fetchTenantSlug(tenantA.tenantId);
    const { iso } = nextNonSunday(2);
    const res = await app.inject({
      method: 'GET',
      url: `/public/${slug}/availability?serviceId=does-not-exist&date=${iso}`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('availability 400s on invalid date format', async () => {
    await setTenantPlan(tenantA.tenantId, PlanTier.pro);
    const service = await createServiceFor(app, tenantA);
    const slug = await fetchTenantSlug(tenantA.tenantId);
    const res = await app.inject({
      method: 'GET',
      url: `/public/${slug}/availability?serviceId=${service.id}&date=not-a-date`,
    });
    expect(res.statusCode).toBe(400);
  });
});
