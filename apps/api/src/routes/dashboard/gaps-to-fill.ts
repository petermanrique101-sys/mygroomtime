import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { DashboardGapsListResponse } from '@mygroomtime/shared';
import { requireAuth } from '../../middleware/require-auth.js';
import { requirePaidPlan } from '../../middleware/require-paid-plan.js';
import { getGapsToFill } from '../../services/dashboard/gaps-to-fill.js';

export default async function dashboardGapsToFillRoute(app: FastifyInstance): Promise<void> {
  app.get(
    '/dashboard/gaps-to-fill',
    { preHandler: [requireAuth, requirePaidPlan] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      // why: gaps-to-fill requires RecurringSeries (Pro+). Rather than 403, return a gated
      // payload so the dashboard widget can render upgrade copy in-place.
      if (auth.tenant.plan === 'starter') {
        const body: DashboardGapsListResponse = {
          rows: [],
          gated: true,
          gatedReason: 'recurring_requires_pro',
        };
        reply.send(body);
        return;
      }
      const rows = await getGapsToFill({ tenantId: auth.tenant.id });
      const body: DashboardGapsListResponse = {
        rows: rows.map((r) => ({
          seriesId: r.seriesId,
          clientId: r.clientId,
          clientName: r.clientName,
          petName: r.petName,
          lastGroomedAt: r.lastGroomedAt ? r.lastGroomedAt.toISOString() : null,
          intervalWeeks: r.intervalWeeks,
          daysOverdue: r.daysOverdue,
        })),
        gated: false,
      };
      reply.send(body);
    },
  );
}
