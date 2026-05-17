import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db } from '@mygroomtime/db';
import { requireAuth } from '../../middleware/require-auth.js';
import { requirePaidPlan } from '../../middleware/require-paid-plan.js';
import { findActiveAppointment } from './find.js';
import { serializeAppointment } from './serialize.js';

type Params = { id: string };

export default async function getAppointmentRoute(app: FastifyInstance): Promise<void> {
  app.get(
    '/appointments/:id',
    { preHandler: [requireAuth, requirePaidPlan] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { id } = request.params as Params;
      const scoped = db.forTenant(auth.tenant.id);
      const row = await findActiveAppointment(scoped, id);
      if (!row) {
        reply
          .code(404)
          .send({ error: 'appointment_not_found', message: 'Appointment not found.' });
        return;
      }
      reply.send({ appointment: serializeAppointment(row, row.pet, row.client) });
    },
  );
}
