import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db } from '@mygroomtime/db';
import { requireAuth } from '../../middleware/require-auth.js';
import { requirePaidPlan } from '../../middleware/require-paid-plan.js';
import { makeMutationDedupe } from '../../middleware/mutation-dedupe.js';
import { findActiveClient } from './find.js';

type Params = { id: string };

export default async function deleteClientRoute(app: FastifyInstance): Promise<void> {
  app.delete(
    '/clients/:id',
    {
      preHandler: [
        requireAuth,
        requirePaidPlan,
        makeMutationDedupe({ resourceType: 'client' }),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { id } = request.params as Params;
      const scoped = db.forTenant(auth.tenant.id);

      const existing = await findActiveClient(scoped, id);
      if (!existing) {
        reply.code(404).send({ error: 'client_not_found', message: 'Client not found.' });
        return;
      }
      const now = new Date();
      await scoped.client.update({
        where: { id: existing.id },
        data: { deletedAt: now },
      });
      await scoped.pet.updateMany({
        where: { clientId: existing.id, deletedAt: null },
        data: { deletedAt: now },
      });
      reply.code(204).send();
    },
  );
}
