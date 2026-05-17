import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db } from '@mygroomtime/db';
import type { ServiceMutationResponse } from '@mygroomtime/shared';
import { requireAuth } from '../../middleware/require-auth.js';
import { requirePaidPlan } from '../../middleware/require-paid-plan.js';
import { findAnyService } from './find.js';
import { serializeService } from './serialize.js';

type Params = { id: string };

export default async function deleteServiceRoute(app: FastifyInstance): Promise<void> {
  app.delete(
    '/services/:id',
    { preHandler: [requireAuth, requirePaidPlan] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { id } = request.params as Params;
      const scoped = db.forTenant(auth.tenant.id);

      const existing = await findAnyService(scoped, id);
      if (!existing) {
        reply.code(404).send({ error: 'service_not_found', message: 'Service not found.' });
        return;
      }
      if (existing.deletedAt === null) {
        await scoped.service.update({
          where: { id: existing.id },
          data: { deletedAt: new Date() },
        });
      }
      reply.code(204).send();
    },
  );

  app.post(
    '/services/:id/restore',
    { preHandler: [requireAuth, requirePaidPlan] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { id } = request.params as Params;
      const scoped = db.forTenant(auth.tenant.id);

      const existing = await findAnyService(scoped, id);
      if (!existing) {
        reply.code(404).send({ error: 'service_not_found', message: 'Service not found.' });
        return;
      }
      const restored = existing.deletedAt === null
        ? existing
        : await scoped.service.update({
            where: { id: existing.id },
            data: { deletedAt: null },
          });
      const body: ServiceMutationResponse = { service: serializeService(restored) };
      reply.send(body);
    },
  );
}
