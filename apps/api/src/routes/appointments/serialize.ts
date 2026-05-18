import type { Appointment, Client, Pet } from '@mygroomtime/db';
import type { AppointmentOutput } from '@mygroomtime/shared';

export function computeEnd(start: Date, durationMin: number): Date {
  return new Date(start.getTime() + durationMin * 60_000);
}

export function serializeAppointment(
  a: Appointment,
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
