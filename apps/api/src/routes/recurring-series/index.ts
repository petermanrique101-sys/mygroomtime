import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db } from '@mygroomtime/db';
import type { RecurringSeriesOutput } from '@mygroomtime/shared';
import { requireAuth } from '../../middleware/require-auth.js';
import { requirePaidPlan } from '../../middleware/require-paid-plan.js';
import { makeMutationDedupe } from '../../middleware/mutation-dedupe.js';

type Params = { id: string };

function toOutput(row: {
  id: string;
  intervalWeeks: number;
  nextDueDate: Date;
  active: boolean;
  pausedAt: Date | null;
  pauseReason: string | null;
}): RecurringSeriesOutput {
  return {
    id: row.id,
    intervalWeeks: row.intervalWeeks,
    nextDueDate: row.nextDueDate.toISOString(),
    active: row.active,
    pausedAt: row.pausedAt ? row.pausedAt.toISOString() : null,
    pauseReason: row.pauseReason,
  };
}

export default async function recurringSeriesRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/recurring-series/:id/pause',
    {
      preHandler: [
        requireAuth,
        requirePaidPlan,
        makeMutationDedupe({ resourceType: 'recurring_series' }),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { id } = request.params as Params;
      const scoped = db.forTenant(auth.tenant.id);
      const existing = await scoped.recurringSeries.findFirst({ where: { id } });
      if (!existing) {
        reply.code(404).send({ error: 'not_found', message: 'Recurring series not found.' });
        return;
      }
      if (!existing.active) {
        reply.send({ series: toOutput(existing) });
        return;
      }
      const updated = await scoped.recurringSeries.update({
        where: { id },
        data: {
          active: false,
          pausedAt: new Date(),
          pauseReason: 'owner_paused',
          nextMaterializationAttemptAt: null,
        },
      });
      reply.send({ series: toOutput(updated) });
    },
  );

  app.post(
    '/recurring-series/:id/resume',
    {
      preHandler: [
        requireAuth,
        requirePaidPlan,
        makeMutationDedupe({ resourceType: 'recurring_series' }),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { id } = request.params as Params;
      const scoped = db.forTenant(auth.tenant.id);
      const existing = await scoped.recurringSeries.findFirst({ where: { id } });
      if (!existing) {
        reply.code(404).send({ error: 'not_found', message: 'Recurring series not found.' });
        return;
      }
      if (existing.active) {
        reply.send({ series: toOutput(existing) });
        return;
      }
      const updated = await scoped.recurringSeries.update({
        where: { id },
        data: {
          active: true,
          pausedAt: null,
          pauseReason: null,
          consecutiveFailedMaterializations: 0,
          nextMaterializationAttemptAt: null,
        },
      });
      reply.send({ series: toOutput(updated) });
    },
  );
}
