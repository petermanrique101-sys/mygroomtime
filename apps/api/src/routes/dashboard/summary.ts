import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireAuth } from '../../middleware/require-auth.js';
import { requirePaidPlan } from '../../middleware/require-paid-plan.js';
import { getDashboardSummary } from '../../services/dashboard/index.js';

export default async function dashboardSummaryRoute(app: FastifyInstance): Promise<void> {
  app.get(
    '/dashboard',
    { preHandler: [requireAuth, requirePaidPlan] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const plan = auth.tenant.plan as 'starter' | 'pro' | 'business' | 'past_due' | 'canceled' | 'unpaid';
      const payload = await getDashboardSummary({
        tenantId: auth.tenant.id,
        plan,
        log: request.log,
      });
      // why: TanStack-Query client cache is the primary defense against repeat fetches; a
      // short server SMaxAge is just a polite extra if the user mashes refresh. Private —
      // metrics are per-tenant.
      reply.header('Cache-Control', 'private, max-age=30');
      reply.send(payload);
    },
  );
}
