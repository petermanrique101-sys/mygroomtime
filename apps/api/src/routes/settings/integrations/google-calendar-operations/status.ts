import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db, GoogleCalendarLinkKind } from '@mygroomtime/db';
import { requireAuth } from '../../../../middleware/require-auth.js';
import { requirePaidPlan } from '../../../../middleware/require-paid-plan.js';
import { requireBusinessTier } from '../../../../middleware/require-business-tier.js';

export type GcalOpsStatusResponse = {
  connected: boolean;
  googleEmail: string | null;
  needsReauth: boolean;
};

export default async function gcalOpsStatusRoute(app: FastifyInstance): Promise<void> {
  app.get(
    '/settings/integrations/google-calendar/operations',
    { preHandler: [requireAuth, requirePaidPlan, requireBusinessTier] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const link = await db
        .forTenant(auth.tenant.id)
        .googleCalendarLink.findFirst({
          where: { linkKind: GoogleCalendarLinkKind.tenant_operations },
        });
      const body: GcalOpsStatusResponse = {
        connected: !!link,
        googleEmail: link?.googleEmail ?? null,
        needsReauth: link?.needsReauth ?? false,
      };
      reply.send(body);
    },
  );
}
