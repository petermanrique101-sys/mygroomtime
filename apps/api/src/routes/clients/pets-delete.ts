import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db } from '@mygroomtime/db';
import { requireAuth } from '../../middleware/require-auth.js';
import { requirePaidPlan } from '../../middleware/require-paid-plan.js';
import { findActiveClient, findActivePet } from './find.js';

type Params = { id: string; petId: string };

export default async function deletePetRoute(app: FastifyInstance): Promise<void> {
  app.delete(
    '/clients/:id/pets/:petId',
    { preHandler: [requireAuth, requirePaidPlan] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { id: clientId, petId } = request.params as Params;
      const scoped = db.forTenant(auth.tenant.id);

      const client = await findActiveClient(scoped, clientId);
      if (!client) {
        reply.code(404).send({ error: 'client_not_found', message: 'Client not found.' });
        return;
      }
      const existing = await findActivePet(scoped, client.id, petId);
      if (!existing) {
        reply.code(404).send({ error: 'pet_not_found', message: 'Pet not found.' });
        return;
      }
      await scoped.pet.update({
        where: { id: existing.id },
        data: { deletedAt: new Date() },
      });
      reply.code(204).send();
    },
  );
}
