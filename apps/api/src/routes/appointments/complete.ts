import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db } from '@mygroomtime/db';
import {
  AppointmentCompleteRequestSchema,
  type AppointmentCompleteResponse,
} from '@mygroomtime/shared';
import { requireAuth } from '../../middleware/require-auth.js';
import { requirePaidPlan } from '../../middleware/require-paid-plan.js';
import { makeMutationDedupe } from '../../middleware/mutation-dedupe.js';
import { findActiveAppointment } from './find.js';
import { serializeAppointment } from './serialize.js';
import { completeAppointment } from '../../services/complete-appointment.js';
import { removeAppointmentReminders } from '../../services/reminder-schedule.js';
import { enqueueGcalPushIfLinked } from '../../services/gcal-enqueue.js';

type Params = { id: string };

export default async function appointmentCompleteRoute(app: FastifyInstance): Promise<void> {
  app.post(
    '/appointments/:id/complete',
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
      const parsed = AppointmentCompleteRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400).send({
          error: 'invalid_request',
          message: parsed.error.issues[0]?.message ?? 'Invalid complete request.',
        });
        return;
      }

      const outcome = await completeAppointment({
        appointmentId: id,
        tenantId: auth.tenant.id,
        tipCents: parsed.data.tipCents,
        stripe: app.adapters.stripe,
        mutation: request.mutation,
      });

      if (!outcome.ok) {
        if (outcome.reason === 'not_found') {
          reply.code(404).send({ error: 'appointment_not_found', message: outcome.message });
          return;
        }
        if (outcome.reason === 'invalid_transition') {
          reply.code(409).send({ error: 'invalid_transition', message: outcome.message });
          return;
        }
        // why: 402 Payment Required is the semantic match for "we tried to capture the
        // remaining balance and the card said no". UI can render retry + skip-charging.
        reply.code(402).send({ error: 'balance_capture_failed', message: outcome.message });
        return;
      }

      if (!outcome.alreadyCompleted) {
        await enqueueGcalPushIfLinked({
          queue: app.gcalPushQueue,
          tenantId: auth.tenant.id,
          appointmentId: outcome.appointment.id,
          kind: 'update',
        });
      }
      if (!outcome.alreadyCompleted && app.reminderQueue) {
        // why: completed appts shouldn't get the 48h/2h reminder jobs anymore. Post-appt
        // job is still useful (it's the review SMS), but the worker's defense-in-depth
        // re-fetch handles the canceled/no_show check at fire time. For completed appts
        // we let the post-appt job run normally.
        await removeAppointmentReminders(app.reminderQueue, outcome.appointment.id).catch(() => undefined);
      }

      // Re-fetch through scoped wrapper to keep the serialized shape consistent.
      const scoped = db.forTenant(auth.tenant.id);
      const hydrated = await findActiveAppointment(scoped, outcome.appointment.id);
      if (!hydrated) {
        reply.code(500).send({ error: 'internal', message: 'Could not reload appointment.' });
        return;
      }

      const body: AppointmentCompleteResponse = {
        appointment: serializeAppointment(hydrated, hydrated.pet, hydrated.client),
        finalAmountCents: outcome.finalAmountCents,
        balanceChargeId: outcome.balanceChargeId,
        alreadyCompleted: outcome.alreadyCompleted,
      };
      reply.send(body);
    },
  );
}
