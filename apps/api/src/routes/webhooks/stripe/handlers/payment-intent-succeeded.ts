import type { FastifyInstance } from 'fastify';
import {
  AppointmentStatus,
  BookingRequestStatus,
  db,
  type TenantScopedDb,
} from '@mygroomtime/db';
import type { BookingPageRequest } from '@mygroomtime/db';
import type { PaymentIntentSucceededEvent } from '../../../../adapters/stripe/types.js';
import { normalizePhone, tenDigitSuffix, toDialFormat } from '../../../../services/phone.js';
import { formatAppointmentDateTime } from '../../../../services/format-datetime.js';
import { enqueueAppointmentReminders } from '../../../../services/reminder-schedule.js';

export type HandlerResult = { ok: true } | { ok: false; reason: string };

const PROMOTED_OK: HandlerResult = { ok: true };

async function matchOrCreateClient(
  scoped: TenantScopedDb,
  row: BookingPageRequest,
): Promise<string> {
  const phoneDigits = normalizePhone(row.ownerPhone);
  if (phoneDigits.length > 0) {
    const suffix = tenDigitSuffix(row.ownerPhone);
    const candidates = await scoped.client.findMany({
      where: { deletedAt: null },
      select: { id: true, phone: true },
    });
    const match = candidates.find((c) => tenDigitSuffix(c.phone) === suffix);
    if (match) return match.id;
  }
  const created = await scoped.client.create({
    data: {
      name: row.ownerName,
      phone: row.ownerPhone,
      email: row.ownerEmail ?? null,
      addressStreet: row.addressStreet,
      addressCity: row.addressCity,
      addressState: row.addressState,
      addressZip: row.addressZip,
      addressLat: row.addressLat,
      addressLng: row.addressLng,
      addressVerified: row.addressLat !== null && row.addressLng !== null,
      notes: '',
    },
  });
  return created.id;
}

async function matchOrCreatePet(
  scoped: TenantScopedDb,
  clientId: string,
  row: BookingPageRequest,
): Promise<string> {
  const lowerName = row.petName.trim().toLowerCase();
  const lowerBreed = row.petBreed.trim().toLowerCase();
  const candidates = await scoped.pet.findMany({
    where: { clientId, deletedAt: null },
    select: { id: true, name: true, breed: true },
  });
  const match = candidates.find(
    (p) =>
      p.name.trim().toLowerCase() === lowerName &&
      p.breed.trim().toLowerCase() === lowerBreed,
  );
  if (match) return match.id;
  const created = await scoped.pet.create({
    data: {
      clientId,
      name: row.petName,
      breed: row.petBreed,
      weightLb: row.petWeightLb,
      coatType: row.petCoatType,
      temperamentNotes: row.petTemperamentNotes,
      vaccinationExpiry: row.petVaccinationExpiry,
    },
  });
  return created.id;
}

async function ensureVehicle(scoped: TenantScopedDb): Promise<string> {
  const existing = await scoped.vehicle.findFirst({ orderBy: { createdAt: 'asc' } });
  if (existing) return existing.id;
  const created = await scoped.vehicle.create({ data: { name: 'Van 1' } });
  return created.id;
}

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function makePaymentIntentSucceededHandler(app: FastifyInstance) {
  return async function handlePaymentIntentSucceeded(
    event: PaymentIntentSucceededEvent,
  ): Promise<HandlerResult> {
    const tenantId = event.metadata.tenantId;
    if (!tenantId) {
      // why: a payment_intent.succeeded without our metadata isn't a booking — could be a
      // future balance charge or a manual top-up. Drop cleanly.
      return PROMOTED_OK;
    }
    const scoped = db.forTenant(tenantId);
    const row = await scoped.bookingPageRequest.findFirst({
      where: { depositPaymentIntentId: event.paymentIntentId },
    });
    if (!row) return PROMOTED_OK;
    if (row.status === BookingRequestStatus.promoted && row.promotedAppointmentId) {
      // why: idempotent replay — Stripe will redeliver; we've already done the work.
      return PROMOTED_OK;
    }
    if (row.status === BookingRequestStatus.expired) {
      // why: rare race — PI succeeded after our 30-min TTL. Honor the payment, promote
      // anyway. The owner sees the appointment and can decide whether to refund.
      app.log.warn(
        { bookingRequestId: row.id },
        'stripe webhook: late payment_intent.succeeded — promoting expired booking',
      );
    }

    const service = await scoped.service.findFirst({
      where: { id: row.serviceId },
      select: {
        id: true,
        name: true,
        basePriceCents: true,
        depositCents: true,
        color: true,
        durationMin: true,
      },
    });
    if (!service) return { ok: false, reason: 'service not found for booking' };

    const clientId = await matchOrCreateClient(scoped, row);
    const petId = await matchOrCreatePet(scoped, clientId, row);
    const vehicleId = await ensureVehicle(scoped);

    const appointment = await scoped.appointment.create({
      data: {
        clientId,
        petId,
        serviceId: service.id,
        vehicleId,
        status: AppointmentStatus.scheduled,
        scheduledStart: row.requestedStart,
        durationMin: row.durationMin,
        serviceNameSnapshot: service.name,
        servicePriceCentsSnapshot: service.basePriceCents,
        serviceDepositCentsSnapshot: service.depositCents,
        serviceColorSnapshot: service.color,
        serviceDurationMinSnapshot: service.durationMin,
        addressOverrideStreet: row.addressStreet,
        addressOverrideCity: row.addressCity,
        addressOverrideState: row.addressState,
        addressOverrideZip: row.addressZip,
        addressOverrideLat: row.addressLat,
        addressOverrideLng: row.addressLng,
        addressOverrideVerified:
          row.addressLat !== null && row.addressLng !== null,
        depositChargeId: event.paymentIntentId,
      },
    });

    await scoped.bookingPageRequest.update({
      where: { id: row.id },
      data: {
        status: BookingRequestStatus.promoted,
        promotedAppointmentId: appointment.id,
        clientId,
      },
    });

    const tenantRow = await db.global.tenant.findUnique({
      where: { id: tenantId },
      select: { businessName: true, smsRemindersEnabled: true },
    });
    const businessName = tenantRow?.businessName ?? 'MyGroomTime';
    const startFormatted = formatAppointmentDateTime(row.requestedStart);

    if (row.ownerEmail) {
      await app.adapters.email.sendBookingConfirmation({
        to: row.ownerEmail,
        customerName: row.ownerName,
        businessName,
        serviceName: service.name,
        start: startFormatted,
        addressLine: `${row.addressStreet}, ${row.addressCity}, ${row.addressState} ${row.addressZip}`,
        depositAmount: dollars(row.depositCents),
      });
    }

    const toE164 = toDialFormat(row.ownerPhone);
    if (toE164.length > 0) {
      const firstName = row.ownerName.trim().split(/\s+/)[0] ?? row.ownerName;
      const smsBody = `Hi ${firstName}, this is ${businessName} confirming ${row.petName}'s ${service.name} on ${startFormatted}.`;
      const smsResult = await app.adapters.twilio.sendSms({
        toE164,
        body: smsBody,
        idempotencyKey: `booking-confirmation:${appointment.id}`,
        tenantId,
        clientId,
        appointmentId: appointment.id,
      });
      if (smsResult.sent) {
        app.log.info(
          { appointmentId: appointment.id, twilioSid: smsResult.twilioSid },
          'booking confirmation SMS sent',
        );
      } else {
        app.log.info(
          { appointmentId: appointment.id, reason: smsResult.reason },
          'booking confirmation SMS skipped or failed (see SmsMessage row)',
        );
      }
    }

    if (app.reminderQueue && tenantRow?.smsRemindersEnabled) {
      await enqueueAppointmentReminders(
        app.reminderQueue,
        {
          id: appointment.id,
          scheduledStart: appointment.scheduledStart,
          durationMin: appointment.durationMin,
        },
        tenantId,
        true,
      );
    }

    return PROMOTED_OK;
  };
}
