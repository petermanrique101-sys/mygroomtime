import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db } from '@mygroomtime/db';
import {
  PayrollPeriodsQuerySchema,
  type PayrollPeriodsResponse,
} from '@mygroomtime/shared';
import { requireAuth } from '../../middleware/require-auth.js';
import { requirePaidPlan } from '../../middleware/require-paid-plan.js';
import { requireBusinessTier } from '../../middleware/require-business-tier.js';
import { computePeriods } from '../../services/payroll-periods.js';

export default async function payrollPeriodsRoute(app: FastifyInstance): Promise<void> {
  app.get(
    '/payroll/periods',
    { preHandler: [requireAuth, requirePaidPlan, requireBusinessTier] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const parsed = PayrollPeriodsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        reply.code(400).send({
          error: 'invalid_request',
          message: parsed.error.issues[0]?.message ?? 'Invalid range.',
        });
        return;
      }
      const tenant = await db.global.tenant.findUnique({
        where: { id: auth.tenant.id },
        select: { payrollPeriodKind: true, payrollPeriodAnchorDate: true },
      });
      if (!tenant) {
        reply.code(404).send({ error: 'tenant_not_found', message: 'Tenant not found.' });
        return;
      }
      const periods = computePeriods({
        kind: tenant.payrollPeriodKind,
        anchor: tenant.payrollPeriodAnchorDate,
        from: new Date(parsed.data.from),
        to: new Date(parsed.data.to),
      });
      const body: PayrollPeriodsResponse = {
        kind: tenant.payrollPeriodKind,
        periods,
      };
      reply.send(body);
    },
  );
}
