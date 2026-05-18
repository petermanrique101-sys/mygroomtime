import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db, AppointmentStatus, type Appointment } from '@mygroomtime/db';
import {
  AppointmentStatusUpdateRequestSchema,
  type AppointmentMutationResponse,
  type AppointmentTransitionTarget,
} from '@mygroomtime/shared';
import { requireAuth } from '../../middleware/require-auth.js';
import { requirePaidPlan } from '../../middleware/require-paid-plan.js';
import { makeMutationDedupe } from '../../middleware/mutation-dedupe.js';
import { findActiveAppointment } from './find.js';
import { serializeAppointment } from './serialize.js';
import {
  assertTransitionAllowed,
  TransitionError,
} from '../../services/status-transitions.js';
import { removeAppointmentReminders } from '../../services/reminder-schedule.js';
import { enqueueGcalPushIfLinked } from '../../services/gcal-enqueue.js';
import { toDialFormat } from '../../services/phone.js';
import { centsToDollarsString } from '../../services/format-money.js';

type Params = { id: string };

const TARGET_TO_STATUS: Record<AppointmentTransitionTarget, AppointmentStatus> = {
  on_the_way: AppointmentStatus.on_the_way,
  started: AppointmentStatus.started,
  no_show: AppointmentStatus.no_show,
  canceled: AppointmentStatus.canceled,
};

function timestampFieldFor(target: AppointmentTransitionTarget): string | null {
  switch (target) {
    case 'on_the_way':
      return 'onTheWayAt';
    case 'started':
      return 'startedAt';
    case 'no_show':
      return 'noShowAt';
    case 'canceled':
      return 'canceledAt';
    default:
      return null;
  }
}

function buildNoShowBody(args: {
  firstName: string;
  scheduledStart: Date;
  depositCents: number;
  tenantPhone: string | null;
  tenantName: string;
}): string {
  const time = args.scheduledStart.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
  const deposit = centsToDollarsString(args.depositCents);
  const phoneTail = args.tenantPhone ? ` or call ${args.tenantPhone}` : '';
  return (
    `Hi ${args.firstName} — we missed you at ${time} today. ` +
    `Your ${deposit} deposit was retained per the booking terms. ` +
    `Reply RESCHEDULE to book a new time${phoneTail}.`
  );
}

export default async function appointmentStatusRoutes(app: FastifyInstance): Promise<void> {
  app.patch(
    '/appointments/:id/status',
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
      const parsed = AppointmentStatusUpdateRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400).send({
          error: 'invalid_request',
          message: parsed.error.issues[0]?.message ?? 'Invalid status update.',
        });
        return;
      }
      const target = parsed.data.status;
      const nextStatus = TARGET_TO_STATUS[target];
      const scoped = db.forTenant(auth.tenant.id);

      const existing = await findActiveAppointment(scoped, id);
      if (!existing) {
        reply
          .code(404)
          .send({ error: 'appointment_not_found', message: 'Appointment not found.' });
        return;
      }

      try {
        assertTransitionAllowed(existing.status, nextStatus);
      } catch (err) {
        if (err instanceof TransitionError) {
          reply.code(409).send({
            error: 'invalid_transition',
            message: `Can't move ${existing.status} → ${nextStatus}.`,
            reason: err.reason,
            current: err.current,
            attempted: err.attempted,
          });
          return;
        }
        throw err;
      }

      const now = new Date();
      const tsField = timestampFieldFor(target);
      const data: Record<string, unknown> = { status: nextStatus };
      if (tsField) data[tsField] = now;

      const updated = (await scoped.appointment.update({
        where: { id: existing.id },
        data,
      })) as Appointment;

      // why: terminal transitions (canceled/no_show) drop their pending reminder jobs
      // so we don't text the customer the day-before / 2h-out reminders for an appt
      // that's already over. completed runs through its own route; not handled here.
      if (
        (target === 'canceled' || target === 'no_show') &&
        app.reminderQueue
      ) {
        await removeAppointmentReminders(app.reminderQueue, existing.id);
      }

      if (target === 'no_show') {
        // why: send the deposit-retention notice via the chunk-14 adapter. The adapter
        // enforces tier gate + opt-out + STOP suffix + idempotency at its boundary so
        // we just hand it a bare body and idempotency key.
        const firstName = existing.client.name.trim().split(/\s+/)[0] ?? 'there';
        const dial = toDialFormat(existing.client.phone);
        if (dial) {
          const tenantRow = await db.global.tenant.findUnique({
            where: { id: auth.tenant.id },
            select: { phone: true, businessName: true },
          });
          const body = buildNoShowBody({
            firstName,
            scheduledStart: existing.scheduledStart,
            depositCents: existing.serviceDepositCentsSnapshot,
            tenantPhone: tenantRow?.phone ?? null,
            tenantName: tenantRow?.businessName ?? '',
          });
          await app.adapters.twilio.sendSms({
            toE164: dial,
            body,
            idempotencyKey: `no-show:${existing.id}`,
            tenantId: auth.tenant.id,
            clientId: existing.clientId,
            appointmentId: existing.id,
          });
        }
      }

      const hydrated = await findActiveAppointment(scoped, updated.id);
      if (!hydrated) {
        reply.code(500).send({ error: 'internal', message: 'Could not reload appointment.' });
        return;
      }

      // why: canceled/no_show → tear the event down in Google (cancellation policy).
      // Other transitions (on_the_way, started) don't have a meaningful Google equivalent;
      // we still push as update so the description carries the latest status notes if any.
      const gcalKind: 'update' | 'delete' =
        target === 'canceled' || target === 'no_show' ? 'delete' : 'update';
      await enqueueGcalPushIfLinked({
        queue: app.gcalPushQueue,
        tenantId: auth.tenant.id,
        appointmentId: hydrated.id,
        kind: gcalKind,
      });

      const body: AppointmentMutationResponse = {
        appointment: serializeAppointment(hydrated, hydrated.pet, hydrated.client),
        warning: null,
      };
      reply.send(body);
    },
  );
}
