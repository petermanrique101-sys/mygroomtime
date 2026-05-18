import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { DashboardNoShowsListResponse } from '@mygroomtime/shared';
import { requireAuth } from '../../middleware/require-auth.js';
import { requirePaidPlan } from '../../middleware/require-paid-plan.js';
import { listNoShows } from '../../services/dashboard/no-show-rate.js';

type Query = { days?: string; page?: string; pageSize?: string };

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export default async function dashboardNoShowsRoute(app: FastifyInstance): Promise<void> {
  app.get(
    '/dashboard/no-shows',
    { preHandler: [requireAuth, requirePaidPlan] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const q = request.query as Query;
      const days = clampInt(q.days, 30, 1, 365);
      const page = clampInt(q.page, 1, 1, 10_000);
      const pageSize = clampInt(q.pageSize, 25, 1, 100);
      const out = await listNoShows({
        tenantId: auth.tenant.id,
        days,
        page,
        pageSize,
      });
      const body: DashboardNoShowsListResponse = {
        rows: out.rows.map((r) => ({
          appointmentId: r.appointmentId,
          clientId: r.clientId,
          clientName: r.clientName,
          petName: r.petName,
          serviceName: r.serviceName,
          scheduledStart: r.scheduledStart.toISOString(),
          noShowAt: r.noShowAt ? r.noShowAt.toISOString() : null,
        })),
        pagination: { page: out.page, pageSize: out.pageSize, total: out.total },
        windowDays: out.windowDays,
      };
      reply.send(body);
    },
  );
}
