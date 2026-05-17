import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db } from '@mygroomtime/db';
import { requireAuth } from '../../middleware/require-auth.js';
import { requirePaidPlan } from '../../middleware/require-paid-plan.js';
import { findActiveClient, findActivePets } from './find.js';
import { serializeClientWithPets } from './serialize.js';

type Params = { id: string };

export default async function getClientRoute(app: FastifyInstance): Promise<void> {
  app.get(
    '/clients/:id',
    { preHandler: [requireAuth, requirePaidPlan] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { id } = request.params as Params;
      const scoped = db.forTenant(auth.tenant.id);

      const client = await findActiveClient(scoped, id);
      if (!client) {
        reply.code(404).send({ error: 'client_not_found', message: 'Client not found.' });
        return;
      }
      const pets = await findActivePets(scoped, client.id);
      reply.send({ client: serializeClientWithPets(client, pets) });
    },
  );
}
