import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  DashboardRevenuePeriodSchema,
  type DashboardRevenueDetailResponse,
} from '@mygroomtime/shared';
import { requireAuth } from '../../middleware/require-auth.js';
import { requirePaidPlan } from '../../middleware/require-paid-plan.js';
import { getRevenueBuckets } from '../../services/dashboard/revenue.js';

type Query = { period?: string };

export default async function dashboardRevenueRoute(app: FastifyInstance): Promise<void> {
  app.get(
    '/dashboard/revenue',
    { preHandler: [requireAuth, requirePaidPlan] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const q = request.query as Query;
      const parsed = DashboardRevenuePeriodSchema.safeParse(q.period ?? 'week');
      if (!parsed.success) {
        reply.code(400).send({
          error: 'invalid_request',
          message: 'period must be day, week, or month.',
        });
        return;
      }
      const buckets = await getRevenueBuckets({
        tenantId: auth.tenant.id,
        period: parsed.data,
      });
      const body: DashboardRevenueDetailResponse = { period: parsed.data, buckets };
      reply.send(body);
    },
  );
}
