import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db, BookingRequestStatus, PlanTier } from '@mygroomtime/db';
import {
  PublicBookingSubmitRequestSchema,
  type PublicBookingSubmitResponse,
} from '@mygroomtime/shared';
import { resolvePublicTenant } from '../../middleware/resolve-public-tenant.js';
import { canPlaceAppointment } from '../../services/conflict.js';
import { geocodePublicAddress } from './geocode-customer.js';
import { publicRateLimitConfig } from './rate-limit.js';

type SubmitParams = { slug: string };

function fullName(firstName: string, lastName: string): string {
  return `${firstName.trim()} ${lastName.trim()}`.trim();
}

export default async function publicBookingSubmitRoute(app: FastifyInstance): Promise<void> {
  app.post<{ Params: SubmitParams }>(
    '/public/:slug/bookings',
    {
      config: { rateLimit: publicRateLimitConfig() },
      preHandler: [resolvePublicTenant],
    },
    async (request: FastifyRequest<{ Params: SubmitParams }>, reply: FastifyReply) => {
      const tenant = request.publicTenant!;
      const parsed = PublicBookingSubmitRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400).send({
          error: 'invalid_request',
          message: parsed.error.issues[0]?.message ?? 'Invalid booking submission.',
        });
        return;
      }

      const tenantRow = await db.global.tenant.findUnique({
        where: { id: tenant.id },
        select: {
          stripeConnectAccountId: true,
          stripeConnectChargesEnabled: true,
          plan: true,
        },
      });
      if (
        !tenantRow ||
        !tenantRow.stripeConnectAccountId ||
        !tenantRow.stripeConnectChargesEnabled ||
        (tenantRow.plan !== PlanTier.pro && tenantRow.plan !== PlanTier.business)
      ) {
        reply.code(409).send({
          error: 'payments_not_ready',
          message: 'This groomer is finishing payment setup — contact them directly.',
        });
        return;
      }

      const scoped = db.forTenant(tenant.id);
      const service = await scoped.service.findFirst({
        where: { id: parsed.data.serviceId, active: true, deletedAt: null },
        select: {
          id: true,
          name: true,
          color: true,
          durationMin: true,
          basePriceCents: true,
          depositCents: true,
        },
      });
      if (!service) {
        reply.code(404).send({
          error: 'service_not_found',
          message: 'That service is no longer available.',
        });
        return;
      }
      if (service.depositCents <= 0) {
        reply.code(409).send({
          error: 'no_deposit',
          message: 'This service requires direct booking — contact the groomer.',
        });
        return;
      }

      const start = new Date(parsed.data.start);
      if (Number.isNaN(start.getTime())) {
        reply.code(400).send({ error: 'invalid_start', message: 'Pick a valid start time.' });
        return;
      }

      const geocode = await geocodePublicAddress(
        app.adapters.geocode,
        {
          street: parsed.data.customer.street,
          city: parsed.data.customer.city,
          state: parsed.data.customer.state,
          zip: parsed.data.customer.zip,
        },
        reply,
      );
      if (!geocode.ok) return;

      const vehicle = await scoped.vehicle.findFirst({ orderBy: { createdAt: 'asc' } });
      const conflict = await canPlaceAppointment({
        scoped,
        vehicleId: vehicle?.id ?? null,
        appointmentId: null,
        start,
        durationMin: service.durationMin,
        gmaps: app.adapters.gmaps,
        defaultBufferMin: tenant.defaultBufferMinutes,
        proposedCoords: { lat: geocode.lat, lng: geocode.lng },
        now: new Date(),
      });
      if (!conflict.ok) {
        reply.code(409).send({
          error: 'slot_unavailable',
          reason: conflict.reason,
          message:
            conflict.reason === 'overlap'
              ? 'That time was just taken. Please pick another.'
              : conflict.reason === 'buffer'
                ? "There isn't enough drive time around that slot. Please pick another."
                : 'That time has passed. Please pick another.',
          detail: conflict.detail,
        });
        return;
      }

      // why: a customer who double-taps Submit (or whose form retries on a flaky
      // connection) should land on the same booking request, not two. Match by
      // {service, start, phone} within an unexpired pending_payment window.
      const existing = await scoped.bookingPageRequest.findFirst({
        where: {
          serviceId: service.id,
          requestedStart: start,
          ownerPhone: parsed.data.customer.phone,
          status: BookingRequestStatus.pending_payment,
          expiresAt: { gt: new Date() },
        },
      });
      if (existing && existing.depositPaymentIntentId) {
        const reusedPi = await app.adapters.stripe.createPaymentIntent({
          amountCents: service.depositCents,
          currency: 'usd',
          connectedAccountId: tenantRow.stripeConnectAccountId,
          metadata: { tenantId: tenant.id, bookingRequestId: existing.id },
          idempotencyKey: existing.id,
        });
        reply.send({
          bookingRequestId: existing.id,
          paymentIntentId: reusedPi.id,
          clientSecret: reusedPi.clientSecret,
          depositCents: service.depositCents,
          twinMode: app.adapters.stripe.mode === 'twin',
        });
        return;
      }

      const expiresAt = new Date(Date.now() + 30 * 60_000);
      const bookingRequest = await scoped.bookingPageRequest.create({
        data: {
          serviceId: service.id,
          petName: parsed.data.pet.name,
          petBreed: parsed.data.pet.breed,
          petWeightLb: parsed.data.pet.weightLb ?? null,
          petCoatType: parsed.data.pet.coatType,
          petTemperamentNotes: parsed.data.pet.temperamentNotes ?? '',
          petVaccinationExpiry: parsed.data.pet.vaccinationExpiry
            ? new Date(parsed.data.pet.vaccinationExpiry)
            : null,
          ownerName: fullName(parsed.data.customer.firstName, parsed.data.customer.lastName),
          ownerPhone: parsed.data.customer.phone,
          ownerEmail: parsed.data.customer.email ?? null,
          addressStreet: parsed.data.customer.street,
          addressCity: parsed.data.customer.city,
          addressState: parsed.data.customer.state,
          addressZip: parsed.data.customer.zip,
          addressLat: geocode.lat,
          addressLng: geocode.lng,
          requestedStart: start,
          durationMin: service.durationMin,
          depositCents: service.depositCents,
          status: BookingRequestStatus.pending_payment,
          expiresAt,
        },
      });

      const pi = await app.adapters.stripe.createPaymentIntent({
        amountCents: service.depositCents,
        currency: 'usd',
        connectedAccountId: tenantRow.stripeConnectAccountId,
        metadata: {
          tenantId: tenant.id,
          bookingRequestId: bookingRequest.id,
        },
        idempotencyKey: bookingRequest.id,
      });

      await scoped.bookingPageRequest.update({
        where: { id: bookingRequest.id },
        data: { depositPaymentIntentId: pi.id },
      });

      const body: PublicBookingSubmitResponse = {
        bookingRequestId: bookingRequest.id,
        paymentIntentId: pi.id,
        clientSecret: pi.clientSecret,
        depositCents: service.depositCents,
        twinMode: app.adapters.stripe.mode === 'twin',
      };
      reply.send(body);
    },
  );
}
