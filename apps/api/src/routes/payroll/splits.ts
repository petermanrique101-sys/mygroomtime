import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db } from '@mygroomtime/db';
import { PayrollSplitsQuerySchema } from '@mygroomtime/shared';
import { requireAuth } from '../../middleware/require-auth.js';
import { requirePaidPlan } from '../../middleware/require-paid-plan.js';
import { requireBusinessTier } from '../../middleware/require-business-tier.js';
import { getPayrollSplits } from '../../services/payroll-splits.js';

export default async function payrollSplitsRoute(app: FastifyInstance): Promise<void> {
  app.get(
    '/payroll/splits',
    { preHandler: [requireAuth, requirePaidPlan, requireBusinessTier] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const parsed = PayrollSplitsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        reply.code(400).send({
          error: 'invalid_request',
          message: parsed.error.issues[0]?.message ?? 'Invalid period.',
        });
        return;
      }
      const tenant = await db.global.tenant.findUnique({
        where: { id: auth.tenant.id },
        select: { payrollPeriodKind: true },
      });
      if (!tenant) {
        reply.code(404).send({ error: 'tenant_not_found', message: 'Tenant not found.' });
        return;
      }
      const result = await getPayrollSplits({
        tenantId: auth.tenant.id,
        periodStart: new Date(parsed.data.periodStart),
        periodEnd: new Date(parsed.data.periodEnd),
        kind: tenant.payrollPeriodKind,
      });
      reply.send(result);
    },
  );
}
