import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db } from '@mygroomtime/db';
import type { Appointment, Client, Pet, RecurringSeries } from '@mygroomtime/db';
import {
  AppointmentRangeQuerySchema,
  type AppointmentListResponse,
} from '@mygroomtime/shared';
import { requireAuth } from '../../middleware/require-auth.js';
import { requirePaidPlan } from '../../middleware/require-paid-plan.js';
import { serializeAppointment } from './serialize.js';

type Query = { from?: string; to?: string };
type WithRelations = Appointment & {
  client: Client;
  pet: Pet;
  recurringSeries: RecurringSeries | null;
};

export default async function listAppointmentsRoute(app: FastifyInstance): Promise<void> {
  app.get(
    '/appointments',
    { preHandler: [requireAuth, requirePaidPlan] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const q = request.query as Query;
      const parsed = AppointmentRangeQuerySchema.safeParse({ from: q.from, to: q.to });
      if (!parsed.success) {
        reply.code(400).send({
          error: 'invalid_request',
          message: parsed.error.issues[0]?.message ?? 'Invalid date range.',
        });
        return;
      }
      const scoped = db.forTenant(auth.tenant.id);
      const from = new Date(parsed.data.from);
      const to = new Date(parsed.data.to);
      const rows = (await scoped.appointment.findMany({
        where: { scheduledStart: { gte: from, lt: to } },
        orderBy: { scheduledStart: 'asc' },
        include: { client: true, pet: true, recurringSeries: true },
      })) as WithRelations[];

      const body: AppointmentListResponse = {
        appointments: rows.map((r) => serializeAppointment(r, r.pet, r.client)),
      };
      reply.send(body);
    },
  );
}
