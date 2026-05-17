import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db } from '@mygroomtime/db';
import {
  AppointmentBuffersQuerySchema,
  type AppointmentBufferEntry,
  type AppointmentBuffersResponse,
} from '@mygroomtime/shared';
import { requireAuth } from '../../middleware/require-auth.js';
import { requirePaidPlan } from '../../middleware/require-paid-plan.js';
import { computeDayBuffers, loadTenantDefaultBufferMin } from '../../services/buffers.js';

type Query = { date?: string };

export default async function appointmentBuffersRoute(app: FastifyInstance): Promise<void> {
  app.get(
    '/appointments/buffers',
    { preHandler: [requireAuth, requirePaidPlan] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const q = request.query as Query;
      const parsed = AppointmentBuffersQuerySchema.safeParse({ date: q.date });
      if (!parsed.success) {
        reply.code(400).send({
          error: 'invalid_request',
          message: parsed.error.issues[0]?.message ?? 'Invalid date.',
        });
        return;
      }
      const date = new Date(parsed.data.date);
      const scoped = db.forTenant(auth.tenant.id);
      const defaultBufferMin = await loadTenantDefaultBufferMin(auth.tenant.id);
      const map = await computeDayBuffers({
        tenantId: auth.tenant.id,
        date,
        gmaps: app.adapters.gmaps,
        defaultBufferMin,
        scoped,
      });
      const buffers: AppointmentBufferEntry[] = [];
      for (const [appointmentId, entry] of map.entries()) {
        buffers.push({
          appointmentId,
          beforeBufferMin: entry.beforeBufferMin,
          afterBufferMin: entry.afterBufferMin,
        });
      }
      const body: AppointmentBuffersResponse = {
        date: date.toISOString(),
        defaultBufferMin,
        buffers,
      };
      reply.send(body);
    },
  );
}
