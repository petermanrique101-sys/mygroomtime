import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db } from '@mygroomtime/db';
import { requireAuth } from '../../middleware/require-auth.js';
import { requirePaidPlan } from '../../middleware/require-paid-plan.js';
import { findActiveService } from './find.js';
import { serializeService } from './serialize.js';

type Params = { id: string };

export default async function getServiceRoute(app: FastifyInstance): Promise<void> {
  app.get(
    '/services/:id',
    { preHandler: [requireAuth, requirePaidPlan] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { id } = request.params as Params;
      const scoped = db.forTenant(auth.tenant.id);

      const service = await findActiveService(scoped, id);
      if (!service) {
        reply.code(404).send({ error: 'service_not_found', message: 'Service not found.' });
        return;
      }
      reply.send({ service: serializeService(service) });
    },
  );
}
