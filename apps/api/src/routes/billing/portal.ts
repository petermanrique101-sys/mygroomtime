import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireAuth } from '../../middleware/require-auth.js';

export default async function billingPortalRoute(app: FastifyInstance): Promise<void> {
  app.get(
    '/billing/portal',
    { preHandler: [requireAuth] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      reply.code(501).send({
        error: 'not_implemented',
        message: 'Billing portal is not yet wired (chunk 13).',
      });
    },
  );
}
