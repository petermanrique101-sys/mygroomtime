import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  RescheduleVerifyRequestSchema,
  type RescheduleVerifyResponse,
} from '@mygroomtime/shared';
import { verifyRescheduleToken } from '../../services/reschedule-tokens.js';
import { publicRateLimitConfig } from './rate-limit.js';
import { loadAppointmentWithRelations, loadTenant } from './reschedule-load.js';

export default async function publicRescheduleVerifyRoute(
  app: FastifyInstance,
): Promise<void> {
  app.post(
    '/public/reschedule/verify',
    { config: { rateLimit: publicRateLimitConfig() } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = RescheduleVerifyRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400).send({
          error: 'invalid_request',
          message: parsed.error.issues[0]?.message ?? 'Invalid request.',
        });
        return;
      }

      const verify = await verifyRescheduleToken(
        parsed.data.token,
        app.appEnv.rescheduleTokenSecret,
      );
      if (!verify.ok) {
        reply.code(verify.reason === 'expired' ? 410 : 400).send({
          error: verify.reason === 'expired' ? 'expired' : 'invalid_token',
          message:
            verify.reason === 'expired'
              ? 'This reschedule link has expired.'
              : 'This reschedule link is not valid.',
        });
        return;
      }

      const tenant = await loadTenant(verify.claims.tenantId);
      if (!tenant) {
        reply.code(404).send({ error: 'not_found', message: 'Tenant not found.' });
        return;
      }

      const appt = await loadAppointmentWithRelations(
        tenant.id,
        verify.claims.appointmentId,
      );
      if (!appt) {
        reply
          .code(404)
          .send({ error: 'not_found', message: 'Original appointment not found.' });
        return;
      }

      const body: RescheduleVerifyResponse = {
        tenantSlug: tenant.slug,
        tenantName: tenant.businessName,
        service: {
          id: appt.serviceId,
          name: appt.serviceNameSnapshot,
          durationMin: appt.serviceDurationMinSnapshot,
          color: appt.serviceColorSnapshot,
        },
        source: {
          appointmentId: appt.id,
          start: appt.scheduledStart.toISOString(),
          status: appt.status,
        },
      };
      reply.send(body);
    },
  );
}
