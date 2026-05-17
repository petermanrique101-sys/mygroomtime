import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db } from '@mygroomtime/db';
import {
  PublicAvailabilityQuerySchema,
  type PublicAvailabilityResponse,
} from '@mygroomtime/shared';
import { resolvePublicTenant } from '../../middleware/resolve-public-tenant.js';
import { computeAvailableSlots } from '../../services/availability.js';
import { publicRateLimitConfig } from './rate-limit.js';

function startOfDayLocal(isoDate: string): Date {
  const [y, m, d] = isoDate.split('-').map((n) => parseInt(n, 10));
  const date = new Date();
  date.setFullYear(y!, (m ?? 1) - 1, d ?? 1);
  date.setHours(0, 0, 0, 0);
  return date;
}

export default async function publicAvailabilityRoute(app: FastifyInstance): Promise<void> {
  app.get(
    '/public/:slug/availability',
    {
      config: { rateLimit: publicRateLimitConfig() },
      preHandler: [resolvePublicTenant],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenant = request.publicTenant!;
      const parsed = PublicAvailabilityQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        reply.code(400).send({
          error: 'invalid_request',
          message: parsed.error.issues[0]?.message ?? 'Invalid availability query.',
        });
        return;
      }

      const scoped = db.forTenant(tenant.id);
      const service = await scoped.service.findFirst({
        where: { id: parsed.data.serviceId, active: true, deletedAt: null },
        select: { id: true, durationMin: true },
      });
      if (!service) {
        reply.code(404).send({
          error: 'service_not_found',
          message: 'Service not found.',
        });
        return;
      }

      // why: chunk 11 doesn't know the customer's actual address yet (collected at booking
      // submission in chunk 12). Use the tenant's depot coordinates as a stand-in so the
      // gmaps buffer math has a concrete origin/destination. Real address swap-in happens
      // when canPlaceAppointment runs again at submission time.
      const depotCoords =
        tenant.depotLat !== null && tenant.depotLng !== null
          ? { lat: tenant.depotLat, lng: tenant.depotLng }
          : null;

      const vehicle = await scoped.vehicle.findFirst({ orderBy: { createdAt: 'asc' } });

      const date = startOfDayLocal(parsed.data.date);
      const slots = await computeAvailableSlots({
        scoped,
        service,
        date,
        now: new Date(),
        vehicleId: vehicle?.id ?? null,
        proposedCoords: depotCoords,
        gmaps: app.adapters.gmaps,
        defaultBufferMin: tenant.defaultBufferMinutes,
      });

      const body: PublicAvailabilityResponse = {
        serviceId: service.id,
        date: parsed.data.date,
        slots,
      };
      reply.header('Cache-Control', 'private, max-age=60');
      reply.send(body);
    },
  );
}
