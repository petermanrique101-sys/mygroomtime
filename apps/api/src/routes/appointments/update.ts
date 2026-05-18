import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db } from '@mygroomtime/db';
import {
  AppointmentUpdateRequestSchema,
  type AppointmentConflictError,
  type AppointmentMutationResponse,
} from '@mygroomtime/shared';
import { requireAuth } from '../../middleware/require-auth.js';
import { requirePaidPlan } from '../../middleware/require-paid-plan.js';
import { makeMutationDedupe } from '../../middleware/mutation-dedupe.js';
import { findActiveAppointment } from './find.js';
import { serializeAppointment } from './serialize.js';
import { geocodeOverride } from './geocode-override.js';
import { canPlaceAppointment } from '../../services/conflict.js';
import { loadTenantDefaultBufferMin } from '../../services/buffers.js';
import { resolveAppointmentCoords } from '../../services/address.js';
import { conflictMessage } from './conflict-message.js';
import { rescheduleAppointmentReminders } from '../../services/reminder-schedule.js';
import { enqueueAppointmentGcalPushes } from '../../services/gcal-enqueue.js';

type Params = { id: string };

export default async function updateAppointmentRoute(app: FastifyInstance): Promise<void> {
  app.patch(
    '/appointments/:id',
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
      const parsed = AppointmentUpdateRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400).send({
          error: 'invalid_request',
          message: parsed.error.issues[0]?.message ?? 'Invalid update.',
        });
        return;
      }
      const input = parsed.data;
      const scoped = db.forTenant(auth.tenant.id);

      const existing = await findActiveAppointment(scoped, id);
      if (!existing) {
        reply
          .code(404)
          .send({ error: 'appointment_not_found', message: 'Appointment not found.' });
        return;
      }

      const data: Record<string, unknown> = {};
      let warning: { code: 'address_unverified'; message: string } | null = null;

      if (input.notes !== undefined) data.notes = input.notes;
      if (input.timeLocked !== undefined) data.timeLocked = input.timeLocked;

      if (input.addressOverride !== undefined) {
        if (input.addressOverride === null) {
          data.addressOverrideStreet = null;
          data.addressOverrideCity = null;
          data.addressOverrideState = null;
          data.addressOverrideZip = null;
          data.addressOverrideLat = null;
          data.addressOverrideLng = null;
          data.addressOverrideVerified = false;
        } else {
          const outcome = await geocodeOverride(
            app.adapters.geocode,
            input.addressOverride,
            reply,
          );
          if (!outcome.ok) return;
          data.addressOverrideStreet = input.addressOverride.street;
          data.addressOverrideCity = input.addressOverride.city;
          data.addressOverrideState = input.addressOverride.state;
          data.addressOverrideZip = input.addressOverride.zip;
          data.addressOverrideLat = outcome.lat;
          data.addressOverrideLng = outcome.lng;
          data.addressOverrideVerified = outcome.verified;
          if (!outcome.verified) {
            warning = { code: 'address_unverified', message: outcome.warning };
          }
        }
      }

      // why: chunk-21 cross-vehicle drag. Owner sends vehicleId; if the new vehicle has an
      // assigned driver AND owner didn't explicitly pin groomerId in the same PATCH, we
      // inherit the driver. Explicit groomerId (including null) wins.
      let destinationVehicleId: string | null = existing.vehicleId;
      let inheritedGroomerId: string | null = existing.groomerId;
      let vehicleChanged = false;
      const sourceVehicleId: string | null = existing.vehicleId;
      if (input.vehicleId !== undefined && input.vehicleId !== existing.vehicleId) {
        const destVehicle = await scoped.vehicle.findFirst({
          where: { id: input.vehicleId, deletedAt: null, active: true },
          select: { id: true, assignedGroomerId: true },
        });
        if (!destVehicle) {
          reply.code(404).send({
            error: 'vehicle_not_found',
            message: 'Destination vehicle not found or inactive.',
          });
          return;
        }
        destinationVehicleId = destVehicle.id;
        if (input.groomerId === undefined) {
          inheritedGroomerId = destVehicle.assignedGroomerId;
        }
        vehicleChanged = true;
        data.vehicleId = destVehicle.id;
      }

      if (input.groomerId !== undefined) {
        if (input.groomerId !== null) {
          const groomer = await scoped.user.findFirst({
            where: { id: input.groomerId },
            select: { id: true },
          });
          if (!groomer) {
            reply.code(404).send({
              error: 'groomer_not_found',
              message: 'Groomer not found for this account.',
            });
            return;
          }
        }
        inheritedGroomerId = input.groomerId;
        data.groomerId = input.groomerId;
      } else if (vehicleChanged && inheritedGroomerId !== existing.groomerId) {
        data.groomerId = inheritedGroomerId;
      }

      const newStart =
        input.start !== undefined ? new Date(input.start) : existing.scheduledStart;
      const startChanged =
        input.start !== undefined && newStart.getTime() !== existing.scheduledStart.getTime();

      if (startChanged || vehicleChanged) {
        const defaultBufferMin = await loadTenantDefaultBufferMin(auth.tenant.id);
        const proposedCoords = resolveAppointmentCoords(existing, existing.client);
        const check = await canPlaceAppointment({
          scoped,
          vehicleId: destinationVehicleId,
          appointmentId: existing.id,
          start: newStart,
          durationMin: existing.durationMin,
          gmaps: app.adapters.gmaps,
          defaultBufferMin,
          proposedCoords,
        });
        if (!check.ok) {
          const body: AppointmentConflictError = {
            error: 'appointment_conflict',
            message: conflictMessage(check.reason, check.detail),
            reason: check.reason,
            detail: check.detail,
          };
          reply.code(409).send(body);
          return;
        }
        if (startChanged) data.scheduledStart = newStart;
      }

      if (Object.keys(data).length > 0) {
        await scoped.appointment.update({ where: { id: existing.id }, data });
      }

      const hydrated = await findActiveAppointment(scoped, existing.id);
      if (!hydrated) {
        reply.code(500).send({ error: 'internal', message: 'Could not reload appointment.' });
        return;
      }

      if ((startChanged || vehicleChanged) && app.reminderQueue) {
        const tenantRow = await db.global.tenant.findUnique({
          where: { id: auth.tenant.id },
          select: { smsRemindersEnabled: true },
        });
        await rescheduleAppointmentReminders(
          app.reminderQueue,
          {
            id: hydrated.id,
            scheduledStart: hydrated.scheduledStart,
            durationMin: hydrated.durationMin,
          },
          auth.tenant.id,
          tenantRow?.smsRemindersEnabled === true,
        );
      }

      if (Object.keys(data).length > 0) {
        // why: cross-vehicle drag may require deleting the OLD groomer's event (so the
        // event disappears from their personal calendar) AND creating a fresh event on
        // the NEW groomer's calendar. Tenant-operations calendar updates in place.
        const groomerChanged =
          input.groomerId !== undefined
            ? input.groomerId !== existing.groomerId
            : vehicleChanged && inheritedGroomerId !== existing.groomerId;
        await enqueueAppointmentGcalPushes({
          queue: app.gcalPushQueue,
          tenantId: auth.tenant.id,
          appointmentId: hydrated.id,
          kind: 'update',
          previousGroomerId: groomerChanged ? existing.groomerId : null,
          previousVehicleId: vehicleChanged ? sourceVehicleId : null,
        });
      }

      const body: AppointmentMutationResponse = {
        appointment: serializeAppointment(hydrated, hydrated.pet, hydrated.client),
        warning,
      };
      reply.send(body);
    },
  );
}
