import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { toAuthTenant, toAuthUser } from '../../auth/session.js';
import { requireAuth } from '../../middleware/require-auth.js';

export default async function meRoute(app: FastifyInstance): Promise<void> {
  app.get(
    '/me',
    { preHandler: requireAuth, config: { rateLimit: false } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // why: requireAuth guarantees request.auth is set; non-null asserted via local var.
      const auth = request.auth;
      if (!auth) {
        reply.code(401).send({ error: 'auth_required', message: 'Sign in to continue.' });
        return;
      }
      reply.send({ user: toAuthUser(auth.user), tenant: toAuthTenant(auth.tenant) });
    },
  );
}
