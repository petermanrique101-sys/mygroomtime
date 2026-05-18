import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { signPayload } from '@mygroomtime/twin-stripe';
import { db, PlanTier, BookingRequestStatus, AppointmentStatus } from '@mygroomtime/db';
import {
  cleanupTestTenants,
  createServiceFor,
  signup,
  type TestTenant,
} from '../../../appointments/test-helpers.js';
import {
  createSubmitTestHarness,
  customer,
  fetchTenantSlug,
  nextNonSunday,
  pet,
  WEBHOOK_SECRET,
  type SubmitTestHarness,
} from '../../../public/submit.test-utils.js';

const SLUG_PREFIX = 'webhook-promote-';

describe('public booking webhook → appointment promotion', () => {
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
      where: { eventId: { startsWith: 'evt_promote_' } },
    });
    const ts = Date.now();
    tenant = await signup(harness.app, SLUG_PREFIX, `wp-${ts}`, `wp-${ts}`);
  });

  async function signedPost(
    payload: string,
  ): Promise<Awaited<ReturnType<typeof harness.app.inject>>> {
    const ts = Math.floor(Date.now() / 1000);
    const sig = signPayload(WEBHOOK_SECRET, ts, payload);
    return harness.app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'content-type': 'application/json', 'stripe-signature': sig },
      payload,
    });
  }

  async function setupAndSubmit(): Promise<{
    bookingRequestId: string;
    paymentIntentId: string;
    serviceId: string;
  }> {
    await db.global.tenant.update({
      where: { id: tenant.tenantId },
      data: {
        plan: PlanTier.pro,
        stripeConnectAccountId: 'acct_TWIN_promote',
        stripeConnectChargesEnabled: true,
      },
    });
    const service = await createServiceFor(harness.app, tenant);
    const slug = await fetchTenantSlug(tenant.tenantId);
    const start = nextNonSunday(3);
    const res = await harness.app.inject({
      method: 'POST',
      url: `/public/${slug}/bookings`,
      payload: {
        serviceId: service.id,
        start: start.toISOString(),
        customer: customer(),
        pet: pet(),
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { bookingRequestId: string; paymentIntentId: string };
    return { ...body, serviceId: service.id };
  }

  function payloadFor(eventId: string, bookingId: string, paymentIntentId: string): string {
    return JSON.stringify({
      id: eventId,
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: paymentIntentId,
          amount: 2000,
          currency: 'usd',
          status: 'succeeded',
          on_behalf_of: 'acct_TWIN_promote',
          metadata: { tenantId: tenant.tenantId, bookingRequestId: bookingId },
        },
      },
    });
  }

  it('payment_intent.succeeded promotes BookingPageRequest to Appointment', async () => {
    const { bookingRequestId, paymentIntentId } = await setupAndSubmit();
    const res = await signedPost(payloadFor('evt_promote_1', bookingRequestId, paymentIntentId));
    expect(res.statusCode).toBe(200);

    const row = await db.forTenant(tenant.tenantId).bookingPageRequest.findFirst({
      where: { id: bookingRequestId },
    });
    expect(row?.status).toBe(BookingRequestStatus.promoted);
    expect(row?.promotedAppointmentId).not.toBeNull();

    const appt = await db.forTenant(tenant.tenantId).appointment.findFirst({
      where: { id: row!.promotedAppointmentId! },
    });
    expect(appt?.status).toBe(AppointmentStatus.scheduled);
    expect(appt?.depositChargeId).toBe(paymentIntentId);
    expect(appt?.serviceNameSnapshot).toBeTruthy();
  });

  it('replay: payment_intent.succeeded twice creates exactly one Appointment', async () => {
    const { bookingRequestId, paymentIntentId } = await setupAndSubmit();
    const payload = payloadFor('evt_promote_replay', bookingRequestId, paymentIntentId);
    const first = await signedPost(payload);
    expect(first.statusCode).toBe(200);
    const second = await signedPost(payload);
    expect(second.statusCode).toBe(200);
    expect((second.json() as { deduped?: boolean }).deduped).toBe(true);

    const appts = await db.forTenant(tenant.tenantId).appointment.findMany({});
    expect(appts.length).toBe(1);
  });

  it('match-or-create: existing client by phone is reused', async () => {
    await db.global.tenant.update({
      where: { id: tenant.tenantId },
      data: {
        plan: PlanTier.pro,
        stripeConnectAccountId: 'acct_TWIN_promote',
        stripeConnectChargesEnabled: true,
      },
    });
    const scoped = db.forTenant(tenant.tenantId);
    const existing = await scoped.client.create({
      data: {
        name: 'Carlos Reyes',
        phone: '+19725550199',
        addressStreet: '1234 Oak St',
        addressCity: 'Plano',
        addressState: 'TX',
        addressZip: '75024',
      },
    });
    const { bookingRequestId, paymentIntentId } = await setupAndSubmit();
    const res = await signedPost(
      payloadFor('evt_promote_match', bookingRequestId, paymentIntentId),
    );
    expect(res.statusCode).toBe(200);

    const appt = await scoped.appointment.findFirst({});
    expect(appt?.clientId).toBe(existing.id);
    const clients = await scoped.client.findMany({});
    expect(clients.length).toBe(1);
  });

  it('match-or-create: unknown phone creates a new client', async () => {
    const { bookingRequestId, paymentIntentId } = await setupAndSubmit();
    const res = await signedPost(
      payloadFor('evt_promote_new', bookingRequestId, paymentIntentId),
    );
    expect(res.statusCode).toBe(200);

    const clients = await db.forTenant(tenant.tenantId).client.findMany({});
    expect(clients.length).toBe(1);
    expect(clients[0]?.name).toContain('Carlos');
  });

  it('booking status endpoint reflects promoted state', async () => {
    const { bookingRequestId, paymentIntentId } = await setupAndSubmit();
    await signedPost(payloadFor('evt_promote_status', bookingRequestId, paymentIntentId));
    const slug = await fetchTenantSlug(tenant.tenantId);
    const res = await harness.app.inject({
      method: 'GET',
      url: `/public/${slug}/bookings/${bookingRequestId}/status`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; appointmentId: string | null };
    expect(body.status).toBe('promoted');
    expect(body.appointmentId).not.toBeNull();
  });

  it('expiry: pending_payment past TTL flips to expired on status poll', async () => {
    const { bookingRequestId } = await setupAndSubmit();
    const scoped = db.forTenant(tenant.tenantId);
    await scoped.bookingPageRequest.update({
      where: { id: bookingRequestId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    const slug = await fetchTenantSlug(tenant.tenantId);
    const res = await harness.app.inject({
      method: 'GET',
      url: `/public/${slug}/bookings/${bookingRequestId}/status`,
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { status: string }).status).toBe('expired');
  });
});
