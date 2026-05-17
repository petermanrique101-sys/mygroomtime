import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db } from '@mygroomtime/db';
import {
  BillingCheckoutRequestSchema,
  type BillingCheckoutResponse,
  type PaidPlanTier,
} from '@mygroomtime/shared';
import { requireAuth } from '../../middleware/require-auth.js';

function priceIdFor(tier: PaidPlanTier, app: FastifyInstance): string {
  if (tier === 'starter') return app.appEnv.stripe.priceIdStarter;
  if (tier === 'pro') return app.appEnv.stripe.priceIdPro;
  return app.appEnv.stripe.priceIdBusiness;
}

export default async function billingCheckoutRoute(app: FastifyInstance): Promise<void> {
  app.post(
    '/billing/checkout',
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const parsed = BillingCheckoutRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400).send({
          error: 'invalid_request',
          message: parsed.error.issues[0]?.message ?? 'Pick a plan to continue.',
        });
        return;
      }
      const { tier } = parsed.data;

      const tenant = await db.global.tenant.findUnique({
        where: { id: auth.tenant.id },
        select: { id: true, stripeCustomerId: true },
      });
      if (!tenant) {
        reply.code(404).send({ error: 'tenant_not_found', message: 'Tenant not found.' });
        return;
      }

      let customerId = tenant.stripeCustomerId;
      if (!customerId) {
        const customer = await app.adapters.stripe.createCustomer({
          email: auth.user.email,
          name: auth.tenant.businessName,
          metadata: { tenantId: tenant.id },
        });
        customerId = customer.id;
        await db.global.tenant.update({
          where: { id: tenant.id },
          data: { stripeCustomerId: customerId },
        });
      }

      const successUrl = `${app.appEnv.webOrigin}/signup/billing/success?session={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${app.appEnv.webOrigin}/signup/billing`;

      const session = await app.adapters.stripe.createCheckoutSession({
        customerId,
        priceId: priceIdFor(tier, app),
        successUrl,
        cancelUrl,
        metadata: { tenantId: tenant.id, tier },
      });

      const body: BillingCheckoutResponse = { url: session.url, sessionId: session.sessionId };
      reply.send(body);
    },
  );
}
