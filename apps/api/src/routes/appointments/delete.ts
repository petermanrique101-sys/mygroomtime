import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db, AppointmentStatus } from '@mygroomtime/db';
import { requireAuth } from '../../middleware/require-auth.js';
import { requirePaidPlan } from '../../middleware/require-paid-plan.js';
import { makeMutationDedupe } from '../../middleware/mutation-dedupe.js';
import { findActiveAppointment } from './find.js';
import { removeAppointmentReminders } from '../../services/reminder-schedule.js';

type Params = { id: string };

export default async function deleteAppointmentRoute(app: FastifyInstance): Promise<void> {
  app.delete(
    '/appointments/:id',
    {
      preHandler: [
        requireAuth,
        requirePaidPlan,
        makeMutationDedupe({ resourceType: 'appointment' }),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { id } = request.params as Params;
      const scoped = db.forTenant(auth.tenant.id);

      const existing = await findActiveAppointment(scoped, id);
      if (!existing) {
        reply
          .code(404)
          .send({ error: 'appointment_not_found', message: 'Appointment not found.' });
        return;
      }
      if (existing.status !== AppointmentStatus.canceled) {
        await scoped.appointment.update({
          where: { id: existing.id },
          data: {
            status: AppointmentStatus.canceled,
            canceledAt: new Date(),
          },
        });
      }
      if (app.reminderQueue) {
        await removeAppointmentReminders(app.reminderQueue, existing.id);
      }
      reply.code(204).send();
    },
  );
}
