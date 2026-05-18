import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  AppointmentRebookRequestSchema,
  type AppointmentRebookResponse,
} from '@mygroomtime/shared';
import { requireAuth } from '../../middleware/require-auth.js';
import { requirePaidPlan } from '../../middleware/require-paid-plan.js';
import { makeMutationDedupe } from '../../middleware/mutation-dedupe.js';
import { serializeAppointment } from './serialize.js';
import { rebookFromAppointment } from '../../services/rebook-appointment.js';
import { enqueueGcalPushIfLinked } from '../../services/gcal-enqueue.js';

type Params = { id: string };

export default async function appointmentRebookRoute(app: FastifyInstance): Promise<void> {
  app.post(
    '/appointments/:id/rebook',
    {
      preHandler: [
        requireAuth,
        requirePaidPlan,
        makeMutationDedupe({ resourceType: 'appointment' }),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { id } = request.params as Params;
      const parsed = AppointmentRebookRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400).send({
          error: 'invalid_request',
          message: parsed.error.issues[0]?.message ?? 'Invalid rebook request.',
        });
        return;
      }

      const outcome = await rebookFromAppointment({
        tenantId: auth.tenant.id,
        appointmentId: id,
        intervalWeeks: parsed.data.intervalWeeks,
        gmaps: app.adapters.gmaps,
      });

      if (!outcome.ok) {
        if (outcome.reason === 'not_found') {
          reply.code(404).send({ error: 'appointment_not_found', message: outcome.message });
          return;
        }
        if (outcome.reason === 'not_completed') {
          reply.code(409).send({ error: 'not_completed', message: outcome.message });
          return;
        }
        if (outcome.reason === 'conflict') {
          reply.code(409).send({
            error: 'rebook_conflict',
            message: outcome.message,
            conflict: outcome.conflict,
          });
          return;
        }
        // why: should be unreachable — types make all `ok: false` shapes explicit above.
        reply.code(500).send({ error: 'internal', message: 'Unhandled rebook outcome.' });
        return;
      }

      await enqueueGcalPushIfLinked({
        queue: app.gcalPushQueue,
        tenantId: auth.tenant.id,
        appointmentId: outcome.nextAppointment.id,
        kind: 'create',
      });

      const body: AppointmentRebookResponse = {
        recurringSeries: {
          id: outcome.recurringSeries.id,
          intervalWeeks: outcome.recurringSeries.intervalWeeks,
          nextDueDate: outcome.recurringSeries.nextDueDate.toISOString(),
          active: outcome.recurringSeries.active,
          pausedAt: outcome.recurringSeries.pausedAt
            ? outcome.recurringSeries.pausedAt.toISOString()
            : null,
          pauseReason: outcome.recurringSeries.pauseReason,
        },
        nextAppointment: serializeAppointment(
          { ...outcome.nextAppointment, recurringSeries: outcome.recurringSeries },
          outcome.nextAppointment.pet,
          outcome.nextAppointment.client,
        ),
        reusedSeries: outcome.reusedSeries,
      };
      reply.code(201).send(body);
    },
  );
}
