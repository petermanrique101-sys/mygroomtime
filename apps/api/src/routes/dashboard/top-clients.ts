import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { DashboardTopClientsListResponse } from '@mygroomtime/shared';
import { requireAuth } from '../../middleware/require-auth.js';
import { requirePaidPlan } from '../../middleware/require-paid-plan.js';
import { getTopClients } from '../../services/dashboard/top-clients.js';

type Query = { days?: string; page?: string; pageSize?: string };

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export default async function dashboardTopClientsRoute(app: FastifyInstance): Promise<void> {
  app.get(
    '/dashboard/top-clients',
    { preHandler: [requireAuth, requirePaidPlan] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const q = request.query as Query;
      const days = clampInt(q.days, 90, 1, 365);
      const page = clampInt(q.page, 1, 1, 10_000);
      const pageSize = clampInt(q.pageSize, 25, 1, 100);
      const out = await getTopClients({
        tenantId: auth.tenant.id,
        days,
        page,
        pageSize,
        // why: drill-down view wants the full ranked list paginated, not the top-5 summary
        // limit. We pass pageSize-only so getTopClients returns the right slice.
        limit: pageSize,
      });
      const body: DashboardTopClientsListResponse = {
        rows: out.rows,
        pagination: { page: out.page, pageSize: out.pageSize, total: out.total },
        windowDays: out.windowDays,
      };
      reply.send(body);
    },
  );
}
