import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db } from '@mygroomtime/db';
import type { VehicleListResponse } from '@mygroomtime/shared';
import { requireAuth } from '../../middleware/require-auth.js';
import { requirePaidPlan } from '../../middleware/require-paid-plan.js';
import { serializeVehicle, type VehicleWithGroomer } from './serialize.js';

// why: GET /vehicles is NOT business-gated — Starter/Pro tenants need to read their single
// vehicle for the dispatch view's gating and for appointment creation. Mutations DO require
// business tier, gated per-route.
type Query = { includeDeleted?: string };

export default async function listVehiclesRoute(app: FastifyInstance): Promise<void> {
  app.get(
    '/vehicles',
    { preHandler: [requireAuth, requirePaidPlan] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const q = request.query as Query;
      const includeDeleted = q.includeDeleted === '1' || q.includeDeleted === 'true';
      const scoped = db.forTenant(auth.tenant.id);

      const where = includeDeleted ? {} : { deletedAt: null };
      const rows = (await scoped.vehicle.findMany({
        where,
        orderBy: [{ active: 'desc' }, { createdAt: 'asc' }],
        include: {
          assignedGroomer: { select: { id: true, name: true, email: true } },
        },
      })) as unknown as VehicleWithGroomer[];

      const body: VehicleListResponse = {
        vehicles: rows.map(serializeVehicle),
      };
      reply.send(body);
    },
  );
}
