import type { Appointment, Client, Pet, RecurringSeries } from '@mygroomtime/db';
import type { AppointmentOutput } from '@mygroomtime/shared';

export type AppointmentWithMaybeSeries = Appointment & {
  recurringSeries?: RecurringSeries | null;
};

export function computeEnd(start: Date, durationMin: number): Date {
  return new Date(start.getTime() + durationMin * 60_000);
}

export function serializeAppointment(
  a: AppointmentWithMaybeSeries,
  pet: Pet,
  client: Client,
): AppointmentOutput {
  const start = a.scheduledStart;
  const end = computeEnd(start, a.durationMin);
  const hasOverride =
    a.addressOverrideStreet !== null &&
    a.addressOverrideCity !== null &&
    a.addressOverrideState !== null &&
    a.addressOverrideZip !== null;
  return {
    id: a.id,
    status: a.status,
    start: start.toISOString(),
    end: end.toISOString(),
    durationMin: a.durationMin,
    petId: a.petId,
    serviceId: a.serviceId,
    vehicleId: a.vehicleId,
    groomerId: a.groomerId,
    recurringSeriesId: a.recurringSeriesId,
    recurringSeriesActive:
      a.recurringSeries === null || a.recurringSeries === undefined
        ? null
        : a.recurringSeries.active,
    serviceNameSnapshot: a.serviceNameSnapshot,
    servicePriceCentsSnapshot: a.servicePriceCentsSnapshot,
    serviceDepositCentsSnapshot: a.serviceDepositCentsSnapshot,
    serviceColorSnapshot: a.serviceColorSnapshot,
    serviceDurationMinSnapshot: a.serviceDurationMinSnapshot,
    addressOverride: hasOverride
      ? {
          street: a.addressOverrideStreet!,
          city: a.addressOverrideCity!,
          state: a.addressOverrideState!,
          zip: a.addressOverrideZip!,
          lat: a.addressOverrideLat,
          lng: a.addressOverrideLng,
          verified: a.addressOverrideVerified,
        }
      : null,
    notes: a.notes,
    timeLocked: a.timeLocked,
    canceledAt: a.canceledAt ? a.canceledAt.toISOString() : null,
    onTheWayAt: a.onTheWayAt ? a.onTheWayAt.toISOString() : null,
    startedAt: a.startedAt ? a.startedAt.toISOString() : null,
    completedAt: a.completedAt ? a.completedAt.toISOString() : null,
    noShowAt: a.noShowAt ? a.noShowAt.toISOString() : null,
    tipCents: a.tipCents,
    finalAmountCents: a.finalAmountCents,
    balanceChargeId: a.balanceChargeId,
    depositChargeId: a.depositChargeId,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    pet: {
      id: pet.id,
      name: pet.name,
      breed: pet.breed,
    },
    client: {
      id: client.id,
      name: client.name,
      phone: client.phone,
      street: client.addressStreet,
      city: client.addressCity,
      state: client.addressState,
      zip: client.addressZip,
      lat: client.addressLat,
      lng: client.addressLng,
    },
  };
}
