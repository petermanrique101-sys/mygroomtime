import type {
  Appointment,
  Client,
  Pet,
  RecurringSeries,
  TenantScopedDb,
} from '@mygroomtime/db';

export type AppointmentWithRelations = Appointment & {
  client: Client;
  pet: Pet;
  recurringSeries: RecurringSeries | null;
};

export async function findActiveAppointment(
  scoped: TenantScopedDb,
  id: string,
): Promise<AppointmentWithRelations | null> {
  // why: scoped delegate strips tenantId from where, but Prisma's "include" surface is untyped
  // through the wrapper — cast to the relation-augmented shape we know we asked for.
  const row = (await scoped.appointment.findFirst({
    where: { id },
    include: { client: true, pet: true, recurringSeries: true },
  })) as AppointmentWithRelations | null;
  return row;
}

export async function findActivePetForTenant(
  scoped: TenantScopedDb,
  petId: string,
): Promise<(Pet & { client: Client }) | null> {
  // why: confirm pet belongs to this tenant AND owning client is active (not soft-deleted).
  const row = (await scoped.pet.findFirst({
    where: { id: petId, deletedAt: null, client: { deletedAt: null } },
    include: { client: true },
  })) as (Pet & { client: Client }) | null;
  return row;
}

export async function findActiveServiceForCreate(
  scoped: TenantScopedDb,
  serviceId: string,
) {
  return scoped.service.findFirst({
    where: { id: serviceId, active: true, deletedAt: null },
  });
}

export async function ensureDefaultVehicle(
  scoped: TenantScopedDb,
): Promise<string> {
  const existing = await scoped.vehicle.findFirst({ orderBy: { createdAt: 'asc' } });
  if (existing) return existing.id;
  const created = await scoped.vehicle.create({ data: { name: 'Van 1' } });
  return created.id;
}
