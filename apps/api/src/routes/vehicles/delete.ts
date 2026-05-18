import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db, AppointmentStatus } from '@mygroomtime/db';
import { requireAuth } from '../../middleware/require-auth.js';
import { requirePaidPlan } from '../../middleware/require-paid-plan.js';
import { requireBusinessTier } from '../../middleware/require-business-tier.js';

type Params = { id: string };

const FUTURE_BLOCKING_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.scheduled,
  AppointmentStatus.on_the_way,
  AppointmentStatus.started,
];

export default async function deleteVehicleRoute(app: FastifyInstance): Promise<void> {
  app.delete(
    '/vehicles/:id',
    { preHandler: [requireAuth, requirePaidPlan, requireBusinessTier] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { id } = request.params as Params;
      const scoped = db.forTenant(auth.tenant.id);

      const existing = await scoped.vehicle.findFirst({ where: { id, deletedAt: null } });
      if (!existing) {
        reply.code(404).send({ error: 'vehicle_not_found', message: 'Vehicle not found.' });
        return;
      }

      // why: block delete if future scheduled work is bound to this vehicle. Owner has to
      // reassign or cancel first. We count only future, non-terminal appointments.
      const futureCount = await scoped.appointment.count({
        where: {
          vehicleId: id,
          status: { in: FUTURE_BLOCKING_STATUSES },
          scheduledStart: { gte: new Date() },
        },
      });
      if (futureCount > 0) {
        reply.code(409).send({
          error: 'vehicle_delete_blocked',
          reason: 'future_appointments',
          message: `This vehicle has ${futureCount} upcoming appointment${
            futureCount === 1 ? '' : 's'
          }. Reassign or cancel them first.`,
          futureAppointmentCount: futureCount,
        });
        return;
      }

      // why: preserve the chunk-8 lazy-create invariant — at least one active vehicle must
      // exist at all times. Block delete if this would empty the active pool.
      const remainingActive = await scoped.vehicle.count({
        where: { active: true, deletedAt: null, id: { not: id } },
      });
      if (remainingActive === 0) {
        reply.code(409).send({
          error: 'vehicle_delete_blocked',
          reason: 'last_active_vehicle',
          message:
            'You cannot delete the last active vehicle. Create another one first.',
        });
        return;
      }

      await scoped.vehicle.update({
        where: { id },
        data: { deletedAt: new Date(), active: false },
      });
      reply.code(204).send();
    },
  );
}
