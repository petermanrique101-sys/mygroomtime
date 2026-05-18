import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db } from '@mygroomtime/db';
import { requireAuth } from '../../../../middleware/require-auth.js';
import { requirePaidPlan } from '../../../../middleware/require-paid-plan.js';

export type GcalStatusResponse = {
  connected: boolean;
  googleEmail: string | null;
  watchExpiresAt: string | null;
  needsReauth: boolean;
  tierGated: boolean;
};

export default async function gcalStatusRoute(app: FastifyInstance): Promise<void> {
  app.get(
    '/settings/integrations/google-calendar',
    { preHandler: [requireAuth, requirePaidPlan] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const tier = auth.tenant.plan;
      const tierGated = !(tier === 'pro' || tier === 'business');

      const link = await db
        .forTenant(auth.tenant.id)
        .googleCalendarLink.findFirst({ where: { userId: auth.user.id } });

      const body: GcalStatusResponse = {
        connected: !!link,
        googleEmail: link?.googleEmail ?? null,
        watchExpiresAt: link?.watchExpirationAt ? link.watchExpirationAt.toISOString() : null,
        needsReauth: link?.needsReauth ?? false,
        tierGated,
      };
      reply.send(body);
    },
  );
}
