import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db, AppointmentStatus } from '@mygroomtime/db';
import type { Appointment } from '@mygroomtime/db';
import {
  AppointmentCreateRequestSchema,
  type AppointmentMutationResponse,
} from '@mygroomtime/shared';
import { requireAuth } from '../../middleware/require-auth.js';
import { requirePaidPlan } from '../../middleware/require-paid-plan.js';
import { makeMutationDedupe } from '../../middleware/mutation-dedupe.js';
import {
  ensureDefaultVehicle,
  findActiveAppointment,
  findActivePetForTenant,
  findActiveServiceForCreate,
} from './find.js';
import { serializeAppointment } from './serialize.js';
import { findOverlappingAppointment } from './overlap.js';
import { geocodeOverride } from './geocode-override.js';
import { computeEnd } from './serialize.js';
import { enqueueAppointmentReminders } from '../../services/reminder-schedule.js';
import { enqueueGcalPushIfLinked } from '../../services/gcal-enqueue.js';

export default async function createAppointmentRoute(app: FastifyInstance): Promise<void> {
  app.post(
    '/appointments',
    {
      preHandler: [
        requireAuth,
        requirePaidPlan,
        makeMutationDedupe({ resourceType: 'appointment' }),
      ],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const parsed = AppointmentCreateRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400).send({
          error: 'invalid_request',
          message: parsed.error.issues[0]?.message ?? 'Invalid appointment.',
          issues: parsed.error.issues,
        });
        return;
      }
      const input = parsed.data;
      const scoped = db.forTenant(auth.tenant.id);

      if (input.mutationUuid) {
        const existing = (await scoped.appointment.findFirst({
          where: { mutationUuid: input.mutationUuid },
        })) as Appointment | null;
        if (existing) {
          const hydrated = await findActiveAppointment(scoped, existing.id);
          if (hydrated) {
            const body: AppointmentMutationResponse = {
              appointment: serializeAppointment(hydrated, hydrated.pet, hydrated.client),
              warning: null,
            };
            reply.code(200).send(body);
            return;
          }
        }
      }

      const service = await findActiveServiceForCreate(scoped, input.serviceId);
      if (!service) {
        reply.code(404).send({
          error: 'service_not_found',
          message: 'Service not found or no longer active.',
        });
        return;
      }
      const petWithClient = await findActivePetForTenant(scoped, input.petId);
      if (!petWithClient) {
        reply.code(404).send({
          error: 'pet_not_found',
          message: 'Pet not found for this account.',
        });
        return;
      }

      const start = new Date(input.start);
      const vehicleId = await ensureDefaultVehicle(scoped);

      // why: chunk-21 inherits the assigned groomer from the (default) vehicle. Without an
      // explicit override on the request, new appointments land on the van's driver. The
      // current logged-in user remains the fallback when the vehicle has no driver — keeps
      // chunk-2 behavior intact for single-vehicle tenants.
      const vehicleRow = await scoped.vehicle.findFirst({
        where: { id: vehicleId },
        select: { assignedGroomerId: true },
      });
      const inheritedGroomerId =
        vehicleRow?.assignedGroomerId ?? auth.user.id;

      const conflict = await findOverlappingAppointment(scoped, {
        vehicleId,
        start,
        durationMin: service.durationMin,
      });
      if (conflict) {
        const cEnd = computeEnd(conflict.scheduledStart, conflict.durationMin);
        reply.code(409).send({
          error: 'appointment_overlap',
          message: 'That time conflicts with another appointment on the same van.',
          conflictingId: conflict.id,
          conflictingStart: conflict.scheduledStart.toISOString(),
          conflictingEnd: cEnd.toISOString(),
        });
        return;
      }

      let overrideFields = {
        addressOverrideStreet: null as string | null,
        addressOverrideCity: null as string | null,
        addressOverrideState: null as string | null,
        addressOverrideZip: null as string | null,
        addressOverrideLat: null as number | null,
        addressOverrideLng: null as number | null,
        addressOverrideVerified: false,
      };
      let warning: { code: 'address_unverified'; message: string } | null = null;

      if (input.addressOverride) {
        const outcome = await geocodeOverride(
          app.adapters.geocode,
          input.addressOverride,
          reply,
        );
        if (!outcome.ok) return;
        overrideFields = {
          addressOverrideStreet: input.addressOverride.street,
          addressOverrideCity: input.addressOverride.city,
          addressOverrideState: input.addressOverride.state,
          addressOverrideZip: input.addressOverride.zip,
          addressOverrideLat: outcome.lat,
          addressOverrideLng: outcome.lng,
          addressOverrideVerified: outcome.verified,
        };
        if (!outcome.verified) {
          warning = { code: 'address_unverified', message: outcome.warning };
        }
      }

      const created = (await scoped.appointment.create({
        data: {
          clientId: petWithClient.clientId,
          petId: petWithClient.id,
          serviceId: service.id,
          vehicleId,
          groomerId: inheritedGroomerId,
          status: AppointmentStatus.scheduled,
          scheduledStart: start,
          durationMin: service.durationMin,
          serviceNameSnapshot: service.name,
          servicePriceCentsSnapshot: service.basePriceCents,
          serviceDepositCentsSnapshot: service.depositCents,
          serviceColorSnapshot: service.color,
          serviceDurationMinSnapshot: service.durationMin,
          ...overrideFields,
          notes: input.notes ?? '',
          mutationUuid: input.mutationUuid ?? null,
        },
      })) as Appointment;

      const hydrated = await findActiveAppointment(scoped, created.id);
      if (!hydrated) {
        // why: just-created row should always re-fetch; guard for type-narrowing only.
        reply.code(500).send({ error: 'internal', message: 'Could not load created appointment.' });
        return;
      }

      if (app.reminderQueue) {
        const tenantRow = await db.global.tenant.findUnique({
          where: { id: auth.tenant.id },
          select: { smsRemindersEnabled: true },
        });
        if (tenantRow?.smsRemindersEnabled) {
          await enqueueAppointmentReminders(
            app.reminderQueue,
            {
              id: hydrated.id,
              scheduledStart: hydrated.scheduledStart,
              durationMin: hydrated.durationMin,
            },
            auth.tenant.id,
            true,
          );
        }
      }

      await enqueueGcalPushIfLinked({
        queue: app.gcalPushQueue,
        tenantId: auth.tenant.id,
        appointmentId: hydrated.id,
        kind: 'create',
      });

      const body: AppointmentMutationResponse = {
        appointment: serializeAppointment(hydrated, hydrated.pet, hydrated.client),
        warning,
      };
      reply.code(201).send(body);
    },
  );
}
