import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { db, PlanTier, BookingRequestStatus, AppointmentStatus } from '@mygroomtime/db';
import {
  cleanupTestTenants,
  createServiceFor,
  signup,
  type TestTenant,
} from '../appointments/test-helpers.js';
import {
  createSubmitTestHarness,
  customer,
  fetchTenantSlug,
  nextNonSunday,
  pet,
  promoteWithConnect,
  type SubmitTestHarness,
} from './submit.test-utils.js';

const SLUG_PREFIX = 'submit-test-';

describe('public booking submit', () => {
  let harness: SubmitTestHarness;
  let tenant: TestTenant;

  beforeAll(async () => {
    harness = await createSubmitTestHarness();
  });

  afterAll(async () => {
    await cleanupTestTenants(SLUG_PREFIX);
    await harness.close();
  });

  beforeEach(async () => {
    await cleanupTestTenants(SLUG_PREFIX);
    await db.global.webhookEvent.deleteMany({
      where: { eventId: { startsWith: 'evt_submit_test_' } },
    });
    const ts = Date.now();
    tenant = await signup(harness.app, SLUG_PREFIX, `sub-${ts}`, `sub-${ts}`);
  });

  async function submit(
    body: Record<string, unknown>,
  ): Promise<Awaited<ReturnType<typeof harness.app.inject>>> {
    const slug = await fetchTenantSlug(tenant.tenantId);
    return harness.app.inject({
      method: 'POST',
      url: `/public/${slug}/bookings`,
      payload: body,
    });
  }

  it('happy path: 200, BookingPageRequest pending_payment, payment intent created', async () => {
    await promoteWithConnect(tenant.tenantId);
    const service = await createServiceFor(harness.app, tenant);
    const start = nextNonSunday(2);

    const res = await submit({
      serviceId: service.id,
      start: start.toISOString(),
      customer: customer(),
      pet: pet(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      bookingRequestId: string;
      paymentIntentId: string;
      clientSecret: string;
      depositCents: number;
      twinMode: boolean;
    };
    expect(body.bookingRequestId).toMatch(/^[a-z0-9]+$/i);
    expect(body.paymentIntentId).toMatch(/^pi_TWIN_/);
    expect(body.depositCents).toBe(service.depositCents);
    expect(body.twinMode).toBe(true);

    const row = await db.forTenant(tenant.tenantId).bookingPageRequest.findFirst({
      where: { id: body.bookingRequestId },
    });
    expect(row?.status).toBe(BookingRequestStatus.pending_payment);
    expect(row?.depositPaymentIntentId).toBe(body.paymentIntentId);
    expect(row?.addressLat).not.toBeNull();
  });

  it('409 payments_not_ready when Connect chargesEnabled=false', async () => {
    await db.global.tenant.update({
      where: { id: tenant.tenantId },
      data: {
        plan: PlanTier.pro,
        stripeConnectAccountId: 'acct_xxx',
        stripeConnectChargesEnabled: false,
      },
    });
    const service = await createServiceFor(harness.app, tenant);
    const start = nextNonSunday(2);

    const res = await submit({
      serviceId: service.id,
      start: start.toISOString(),
      customer: customer(),
      pet: pet(),
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe('payments_not_ready');
    const rows = await db.forTenant(tenant.tenantId).bookingPageRequest.findMany({});
    expect(rows.length).toBe(0);
  });

  it('409 no_deposit when service deposit is $0', async () => {
    await promoteWithConnect(tenant.tenantId);
    const service = await createServiceFor(harness.app, tenant, {
      name: 'Nail Trim',
      durationMin: 30,
      basePriceCents: 2000,
      depositCents: 0,
      color: '#6b7280',
      active: true,
    });
    const res = await submit({
      serviceId: service.id,
      start: nextNonSunday(2).toISOString(),
      customer: customer(),
      pet: pet(),
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe('no_deposit');
  });

  it('400 on bad address (ZERO_RESULTS) — no BookingPageRequest created', async () => {
    await promoteWithConnect(tenant.tenantId);
    const service = await createServiceFor(harness.app, tenant);

    const res = await submit({
      serviceId: service.id,
      start: nextNonSunday(2).toISOString(),
      customer: customer({ zip: '99999' }),
      pet: pet(),
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('address_unverified');
    const rows = await db.forTenant(tenant.tenantId).bookingPageRequest.findMany({});
    expect(rows.length).toBe(0);
  });

  it('409 slot_unavailable when the slot was just taken (overlap)', async () => {
    await promoteWithConnect(tenant.tenantId);
    const service = await createServiceFor(harness.app, tenant);
    const start = nextNonSunday(2);

    const scoped = db.forTenant(tenant.tenantId);
    const vehicle = await scoped.vehicle.create({ data: { name: 'Van 1' } });
    const client = await scoped.client.create({
      data: {
        name: 'Other Owner',
        phone: '+19725550100',
        addressStreet: '5 Pine',
        addressCity: 'Plano',
        addressState: 'TX',
        addressZip: '75024',
      },
    });
    const petRow = await scoped.pet.create({
      data: { clientId: client.id, name: 'Rex', breed: 'Lab', coatType: 'short' },
    });
    await scoped.appointment.create({
      data: {
        clientId: client.id,
        petId: petRow.id,
        serviceId: service.id,
        vehicleId: vehicle.id,
        status: AppointmentStatus.scheduled,
        scheduledStart: start,
        durationMin: service.durationMin,
        serviceNameSnapshot: service.name,
        servicePriceCentsSnapshot: service.basePriceCents,
        serviceDepositCentsSnapshot: service.depositCents,
        serviceColorSnapshot: service.color,
        serviceDurationMinSnapshot: service.durationMin,
      },
    });

    const res = await submit({
      serviceId: service.id,
      start: start.toISOString(),
      customer: customer(),
      pet: pet(),
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe('slot_unavailable');
    const rows = await scoped.bookingPageRequest.findMany({});
    expect(rows.length).toBe(0);
  });

  it('idempotency: same submit twice yields one BookingPageRequest', async () => {
    await promoteWithConnect(tenant.tenantId);
    const service = await createServiceFor(harness.app, tenant);
    const start = nextNonSunday(2);
    const body = {
      serviceId: service.id,
      start: start.toISOString(),
      customer: customer(),
      pet: pet(),
    };

    const first = await submit(body);
    expect(first.statusCode).toBe(200);
    const firstBody = first.json() as {
      bookingRequestId: string;
      paymentIntentId: string;
    };

    const second = await submit(body);
    expect(second.statusCode).toBe(200);
    const secondBody = second.json() as {
      bookingRequestId: string;
      paymentIntentId: string;
    };
    expect(secondBody.bookingRequestId).toBe(firstBody.bookingRequestId);
    expect(secondBody.paymentIntentId).toBe(firstBody.paymentIntentId);

    const rows = await db.forTenant(tenant.tenantId).bookingPageRequest.findMany({});
    expect(rows.length).toBe(1);
  });
});
