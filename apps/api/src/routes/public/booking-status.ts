import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db, BookingRequestStatus } from '@mygroomtime/db';
import type { PublicBookingStatusResponse, PublicBookingStatus } from '@mygroomtime/shared';
import { resolvePublicTenant } from '../../middleware/resolve-public-tenant.js';
import { publicRateLimitConfig } from './rate-limit.js';

type StatusParams = { slug: string; requestId: string };

function mapStatus(s: BookingRequestStatus): PublicBookingStatus {
  switch (s) {
    case BookingRequestStatus.pending_payment:
      return 'pending_payment';
    case BookingRequestStatus.succeeded:
      return 'succeeded';
    case BookingRequestStatus.failed:
      return 'failed';
    case BookingRequestStatus.expired:
      return 'expired';
    case BookingRequestStatus.promoted:
      return 'promoted';
  }
}

export default async function publicBookingStatusRoute(app: FastifyInstance): Promise<void> {
  app.get<{ Params: StatusParams }>(
    '/public/:slug/bookings/:requestId/status',
    {
      config: { rateLimit: publicRateLimitConfig() },
      preHandler: [resolvePublicTenant],
    },
    async (request: FastifyRequest<{ Params: StatusParams }>, reply: FastifyReply) => {
      const tenant = request.publicTenant!;
      const scoped = db.forTenant(tenant.id);
      const row = await scoped.bookingPageRequest.findFirst({
        where: { id: request.params.requestId },
      });
      if (!row) {
        reply.code(404).send({ error: 'not_found', message: 'Booking not found.' });
        return;
      }

      // why: lazy expiry. A pending_payment row past its TTL is treated as expired
      // on read — no scheduled job needed in v1 (chunk 17+ adds BullMQ). The poll
      // endpoint is already heavily exercised, so we get the sweep for free.
      let effectiveStatus = row.status;
      if (
        row.status === BookingRequestStatus.pending_payment &&
        row.expiresAt.getTime() <= Date.now()
      ) {
        await scoped.bookingPageRequest.update({
          where: { id: row.id },
          data: { status: BookingRequestStatus.expired },
        });
        effectiveStatus = BookingRequestStatus.expired;
      }

      const service = await scoped.service.findFirst({
        where: { id: row.serviceId },
        select: { name: true, durationMin: true, color: true },
      });

      const addressLine = `${row.addressStreet}, ${row.addressCity}, ${row.addressState} ${row.addressZip}`;

      const body: PublicBookingStatusResponse = {
        status: mapStatus(effectiveStatus),
        appointmentId: row.promotedAppointmentId,
        service: {
          name: service?.name ?? 'Service',
          durationMin: service?.durationMin ?? row.durationMin,
          color: service?.color ?? '#6b7280',
        },
        start: row.requestedStart.toISOString(),
        addressLine,
      };
      reply.send(body);
    },
  );

  // why: in twin mode the customer has no real card to confirm with; this seam lets
  // the web complete the PI through the platform so the twin fires payment_intent.succeeded.
  // Mounted regardless of mode — the live adapter throws if reached in production.
  app.post<{ Params: StatusParams }>(
    '/public/:slug/bookings/:requestId/twin-confirm',
    {
      config: { rateLimit: publicRateLimitConfig() },
      preHandler: [resolvePublicTenant],
    },
    async (request: FastifyRequest<{ Params: StatusParams }>, reply: FastifyReply) => {
      if (app.adapters.stripe.mode !== 'twin') {
        reply.code(404).send({ error: 'not_found', message: 'Not available.' });
        return;
      }
      const tenant = request.publicTenant!;
      const scoped = db.forTenant(tenant.id);
      const row = await scoped.bookingPageRequest.findFirst({
        where: { id: request.params.requestId },
        select: { depositPaymentIntentId: true, status: true },
      });
      if (!row || !row.depositPaymentIntentId) {
        reply.code(404).send({ error: 'not_found', message: 'Booking not found.' });
        return;
      }
      const result = await app.adapters.stripe.confirmTwinPaymentIntent({
        paymentIntentId: row.depositPaymentIntentId,
      });
      reply.send({ status: result.status });
    },
  );
}
