import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireAuth } from '../middleware/require-auth.js';
import { requireRole } from '../middleware/require-role.js';

export default async function probeRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/probe/owner-only',
    { preHandler: [requireAuth, requireRole('owner')] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      reply.send({ ok: true, scope: 'owner' });
    },
  );

  app.get('/probe/adapters', async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.send({
      stripeMode: app.adapters.stripe.mode,
      twilioMode: app.adapters.twilio.mode,
      gcalMode: app.adapters.gcal.mode,
      gmapsMode: app.adapters.gmaps.mode,
      geocodeMode: app.adapters.geocode.mode,
    });
  });
}
