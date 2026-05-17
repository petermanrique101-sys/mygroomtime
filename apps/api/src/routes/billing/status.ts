import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { BillingStatusResponse } from '@mygroomtime/shared';
import { requireAuth } from '../../middleware/require-auth.js';

export default async function billingStatusRoute(app: FastifyInstance): Promise<void> {
  app.get(
    '/billing',
    { preHandler: [requireAuth], config: { rateLimit: false } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const body: BillingStatusResponse = {
        plan: auth.tenant.plan,
        stripeSubscriptionStatus: auth.tenant.stripeSubscriptionStatus ?? null,
        currentPeriodEnd: auth.tenant.currentPeriodEnd
          ? auth.tenant.currentPeriodEnd.toISOString()
          : null,
        pastDueAt: auth.tenant.pastDueAt ? auth.tenant.pastDueAt.toISOString() : null,
      };
      reply.send(body);
    },
  );
}
