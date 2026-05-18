import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db } from '@mygroomtime/db';
import { requireAuth } from '../../middleware/require-auth.js';

export default async function billingPortalRoute(app: FastifyInstance): Promise<void> {
  // why: kept on /billing/portal for the chunk-10 past_due banner Link; the in-app
  // /settings/billing flow uses POST /settings/billing/portal-session instead.
  app.get(
    '/billing/portal',
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const tenant = await db.global.tenant.findUnique({
        where: { id: auth.tenant.id },
        select: { stripeCustomerId: true },
      });
      if (!tenant?.stripeCustomerId) {
        reply.code(409).send({
          error: 'no_customer',
          message: 'Finish signup billing first.',
        });
        return;
      }
      const session = await app.adapters.stripe.createPortalSession({
        customerId: tenant.stripeCustomerId,
        returnUrl: `${app.appEnv.webOrigin}/settings/billing`,
      });
      reply.send({ url: session.url });
    },
  );
}
