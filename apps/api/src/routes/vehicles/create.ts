import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db } from '@mygroomtime/db';
import {
  VehicleCreateRequestSchema,
  type VehicleMutationResponse,
} from '@mygroomtime/shared';
import { requireAuth } from '../../middleware/require-auth.js';
import { requirePaidPlan } from '../../middleware/require-paid-plan.js';
import { requireBusinessTier } from '../../middleware/require-business-tier.js';
import { serializeVehicle, type VehicleWithGroomer } from './serialize.js';

export default async function createVehicleRoute(app: FastifyInstance): Promise<void> {
  app.post(
    '/vehicles',
    { preHandler: [requireAuth, requirePaidPlan, requireBusinessTier] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const parsed = VehicleCreateRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400).send({
          error: 'invalid_request',
          message: parsed.error.issues[0]?.message ?? 'Invalid vehicle.',
        });
        return;
      }
      const input = parsed.data;
      const scoped = db.forTenant(auth.tenant.id);

      // why: validate assigned groomer belongs to the same tenant — without this an owner
      // could pass any userId and silently leak cross-tenant binding.
      if (input.assignedGroomerId) {
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

      const created = (await scoped.vehicle.create({
        data: {
          name: input.name,
          assignedGroomerId: input.assignedGroomerId ?? null,
        },
      })) as { id: string };

      const hydrated = (await scoped.vehicle.findFirst({
        where: { id: created.id },
        include: {
          assignedGroomer: { select: { id: true, name: true, email: true } },
        },
      })) as unknown as VehicleWithGroomer | null;
      if (!hydrated) {
        reply.code(500).send({ error: 'internal', message: 'Could not load created vehicle.' });
        return;
      }

      const body: VehicleMutationResponse = { vehicle: serializeVehicle(hydrated) };
      reply.code(201).send(body);
    },
  );
}
