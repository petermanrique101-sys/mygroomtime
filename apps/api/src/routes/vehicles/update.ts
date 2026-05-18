import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db } from '@mygroomtime/db';
import {
  VehicleUpdateRequestSchema,
  type VehicleMutationResponse,
} from '@mygroomtime/shared';
import { requireAuth } from '../../middleware/require-auth.js';
import { requirePaidPlan } from '../../middleware/require-paid-plan.js';
import { requireBusinessTier } from '../../middleware/require-business-tier.js';
import { serializeVehicle, type VehicleWithGroomer } from './serialize.js';

type Params = { id: string };

export default async function updateVehicleRoute(app: FastifyInstance): Promise<void> {
  app.patch(
    '/vehicles/:id',
    { preHandler: [requireAuth, requirePaidPlan, requireBusinessTier] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { id } = request.params as Params;
      const parsed = VehicleUpdateRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400).send({
          error: 'invalid_request',
          message: parsed.error.issues[0]?.message ?? 'Invalid update.',
        });
        return;
      }
      const input = parsed.data;
      const scoped = db.forTenant(auth.tenant.id);

      const existing = await scoped.vehicle.findFirst({ where: { id, deletedAt: null } });
      if (!existing) {
        reply.code(404).send({ error: 'vehicle_not_found', message: 'Vehicle not found.' });
        return;
      }

      if (input.assignedGroomerId !== undefined && input.assignedGroomerId !== null) {
        const groomer = await scoped.user.findFirst({
          where: { id: input.assignedGroomerId },
          select: { id: true },
        });
        if (!groomer) {
          reply.code(404).send({
            error: 'groomer_not_found',
            message: 'Assigned groomer not found for this account.',
          });
          return;
        }
      }

      // why: deactivating the last-active vehicle would orphan the lazy-create invariant
      // from chunk 8. Block it here at the service boundary; soft-delete uses the same
      // check in delete.ts.
      if (input.active === false && existing.active) {
        const remaining = await scoped.vehicle.count({
          where: { active: true, deletedAt: null, id: { not: id } },
        });
        if (remaining === 0) {
          reply.code(409).send({
            error: 'vehicle_delete_blocked',
            reason: 'last_active_vehicle',
            message:
              'You cannot deactivate the last active vehicle. Create another one first.',
          });
          return;
        }
      }

      const data: Record<string, unknown> = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.assignedGroomerId !== undefined) {
        data.assignedGroomerId = input.assignedGroomerId;
      }
      if (input.active !== undefined) data.active = input.active;

      await scoped.vehicle.update({ where: { id }, data });

      const hydrated = (await scoped.vehicle.findFirst({
        where: { id },
        include: {
          assignedGroomer: { select: { id: true, name: true, email: true } },
        },
      })) as unknown as VehicleWithGroomer | null;
      if (!hydrated) {
        reply.code(500).send({ error: 'internal', message: 'Could not load vehicle.' });
        return;
      }

      const body: VehicleMutationResponse = { vehicle: serializeVehicle(hydrated) };
      reply.send(body);
    },
  );
}
