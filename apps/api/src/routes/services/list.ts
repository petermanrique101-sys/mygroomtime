import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db } from '@mygroomtime/db';
import type { ServiceListResponse } from '@mygroomtime/shared';
import { requireAuth } from '../../middleware/require-auth.js';
import { requirePaidPlan } from '../../middleware/require-paid-plan.js';
import { serializeService } from './serialize.js';

type Query = { includeDeleted?: string };

function parseIncludeDeleted(raw: string | undefined): boolean {
  return raw === 'true' || raw === '1';
}

export default async function listServicesRoute(app: FastifyInstance): Promise<void> {
  app.get(
    '/services',
    { preHandler: [requireAuth, requirePaidPlan] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const q = request.query as Query;
      const includeDeleted = parseIncludeDeleted(q.includeDeleted);
      const scoped = db.forTenant(auth.tenant.id);

      const where = includeDeleted ? {} : { deletedAt: null };
      const rows = await scoped.service.findMany({
        where,
        orderBy: [{ active: 'desc' }, { name: 'asc' }],
      });

      const body: ServiceListResponse = { services: rows.map(serializeService) };
      reply.send(body);
    },
  );
}
