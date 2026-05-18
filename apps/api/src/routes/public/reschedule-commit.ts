import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  AppointmentStatus,
  db,
  type Appointment,
} from '@mygroomtime/db';
import {
  RescheduleCommitRequestSchema,
  type RescheduleCommitResponse,
} from '@mygroomtime/shared';
import {
  consumeJti,
  verifyRescheduleToken,
} from '../../services/reschedule-tokens.js';
import { canPlaceAppointment } from '../../services/conflict.js';
import { resolveAppointmentCoords } from '../../services/address.js';
import {
  enqueueAppointmentReminders,
  removeAppointmentReminders,
} from '../../services/reminder-schedule.js';
import { enqueueGcalPushIfLinked } from '../../services/gcal-enqueue.js';
import { serializeAppointment } from '../appointments/serialize.js';
import { findActiveAppointment } from '../appointments/find.js';
import { publicRateLimitConfig } from './rate-limit.js';
import {
  findRescheduledChild,
  loadAppointmentWithRelations,
  loadTenant,
} from './reschedule-load.js';

async function alreadyUsedReply(
  reply: FastifyReply,
  tenantId: string,
  sourceId: string,
): Promise<void> {
  const child = await findRescheduledChild(tenantId, sourceId);
  reply.code(409).send({
    error: 'already_used',
    message: 'This reschedule link has already been used.',
    linkedAppointmentId: child?.id ?? null,
    linkedAppointmentStart: child ? child.scheduledStart.toISOString() : null,
  });
}

export default async function publicRescheduleCommitRoute(
  app: FastifyInstance,
): Promise<void> {
  app.post(
    '/public/reschedule/commit',
    { config: { rateLimit: publicRateLimitConfig() } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = RescheduleCommitRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400).send({
          error: 'invalid_request',
          message: parsed.error.issues[0]?.message ?? 'Invalid request.',
        });
        return;
      }

      const verify = await verifyRescheduleToken(
        parsed.data.token,
        app.appEnv.rescheduleTokenSecret,
      );
      if (!verify.ok) {
        reply.code(verify.reason === 'expired' ? 410 : 400).send({
          error: verify.reason === 'expired' ? 'expired' : 'invalid_token',
          message:
            verify.reason === 'expired'
              ? 'This reschedule link has expired.'
              : 'This reschedule link is not valid.',
        });
        return;
      }

      const tenant = await loadTenant(verify.claims.tenantId);
      if (!tenant) {
        reply.code(404).send({ error: 'not_found', message: 'Tenant not found.' });
        return;
      }

      const source = await loadAppointmentWithRelations(
        tenant.id,
        verify.claims.appointmentId,
      );
      if (!source) {
        reply
          .code(404)
          .send({ error: 'not_found', message: 'Original appointment not found.' });
        return;
      }

      const newStart = new Date(parsed.data.newStart);
      if (Number.isNaN(newStart.getTime())) {
        reply.code(400).send({ error: 'invalid_start', message: 'Pick a valid time.' });
        return;
      }

      // why: we run the slot check BEFORE consuming the jti so a conflict at commit-time
      // leaves the link live and the customer can pick another slot without losing access.
      const scoped = db.forTenant(tenant.id);
      const proposedCoords = resolveAppointmentCoords(source, source.client);
      const conflict = await canPlaceAppointment({
        scoped,
        vehicleId: source.vehicleId,
        appointmentId: source.id,
        start: newStart,
        durationMin: source.serviceDurationMinSnapshot,
        gmaps: app.adapters.gmaps,
        defaultBufferMin: tenant.defaultBufferMinutes,
        proposedCoords,
      });
      if (!conflict.ok) {
        reply.code(409).send({
          error: 'slot_unavailable',
          reason: conflict.reason,
          message:
            conflict.reason === 'overlap'
              ? 'That time was just taken. Please pick another.'
              : conflict.reason === 'buffer'
                ? "There isn't enough drive time around that slot. Please pick another."
                : 'That time has passed. Please pick another.',
          detail: conflict.detail,
        });
        return;
      }

      const consumed = await consumeJti(app.adapters.session, verify.claims.jti);
      if (!consumed) {
        await alreadyUsedReply(reply, tenant.id, source.id);
        return;
      }

      const created = await db.global.$transaction(async (tx): Promise<Appointment> => {
        await tx.appointment.update({
          where: { id: source.id },
          data: {
            status: AppointmentStatus.canceled,
            canceledAt: new Date(),
          },
        });

        return (await tx.appointment.create({
          data: {
            tenantId: tenant.id,
            clientId: source.clientId,
            petId: source.petId,
            serviceId: source.serviceId,
            vehicleId: source.vehicleId,
            groomerId: source.groomerId,
            recurringSeriesId: source.recurringSeriesId,
            rescheduledFromAppointmentId: source.id,
            // why: deposit is inherited — no new payment is charged on reschedule.
            // depositChargeId references the same PaymentIntent created at original booking
            // submit; the new appointment is charged for the balance at completion.
            depositChargeId: source.depositChargeId,
            status: AppointmentStatus.scheduled,
            scheduledStart: newStart,
            durationMin: source.serviceDurationMinSnapshot,
            serviceNameSnapshot: source.serviceNameSnapshot,
            servicePriceCentsSnapshot: source.servicePriceCentsSnapshot,
            serviceDepositCentsSnapshot: source.serviceDepositCentsSnapshot,
            serviceColorSnapshot: source.serviceColorSnapshot,
            serviceDurationMinSnapshot: source.serviceDurationMinSnapshot,
            addressOverrideStreet: source.addressOverrideStreet,
            addressOverrideCity: source.addressOverrideCity,
            addressOverrideState: source.addressOverrideState,
            addressOverrideZip: source.addressOverrideZip,
            addressOverrideLat: source.addressOverrideLat,
            addressOverrideLng: source.addressOverrideLng,
            addressOverrideVerified: source.addressOverrideVerified,
          },
        })) as Appointment;
      });

      // reminders: drop old, enqueue new (chunk-15 helpers handle the 7d/48h/2h/post mix
      // based on the new lead time + tenant smsRemindersEnabled).
      if (app.reminderQueue) {
        await removeAppointmentReminders(app.reminderQueue, source.id).catch(() => undefined);
        const tenantSms = await db.global.tenant.findUnique({
          where: { id: tenant.id },
          select: { smsRemindersEnabled: true },
        });
        await enqueueAppointmentReminders(
          app.reminderQueue,
          {
            id: created.id,
            scheduledStart: created.scheduledStart,
            durationMin: created.durationMin,
          },
          tenant.id,
          tenantSms?.smsRemindersEnabled === true,
        );
      }

      // why: source goes to cancelled (Google event teardown) AND a new appointment is
      // created (Google event insert). The new appointment carries the same groomerId so
      // the same calendar gets the new event.
      await enqueueGcalPushIfLinked({
        queue: app.gcalPushQueue,
        tenantId: tenant.id,
        appointmentId: source.id,
        kind: 'delete',
      });
      await enqueueGcalPushIfLinked({
        queue: app.gcalPushQueue,
        tenantId: tenant.id,
        appointmentId: created.id,
        kind: 'create',
      });

      const hydrated = await findActiveAppointment(scoped, created.id);
      if (!hydrated) {
        reply.code(500).send({
          error: 'internal',
          message: 'Could not load the new appointment.',
        });
        return;
      }
      const body: RescheduleCommitResponse = {
        newAppointment: serializeAppointment(hydrated, hydrated.pet, hydrated.client),
        canceledAppointmentId: source.id,
      };
      reply.send(body);
    },
  );
}
