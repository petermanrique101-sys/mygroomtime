import { db, type Appointment, type Client, type Pet, type Service } from '@mygroomtime/db';

export type ApptWithRelations = Appointment & {
  client: Client;
  pet: Pet;
  service: Service;
};

export type TenantSummary = {
  id: string;
  slug: string;
  businessName: string;
  defaultBufferMinutes: number;
  depotLat: number | null;
  depotLng: number | null;
};

export async function loadTenant(tenantId: string): Promise<TenantSummary | null> {
  const t = await db.global.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      slug: true,
      businessName: true,
      defaultBufferMinutes: true,
      depotLat: true,
      depotLng: true,
    },
  });
  return t;
}

export async function loadAppointmentWithRelations(
  tenantId: string,
  appointmentId: string,
): Promise<ApptWithRelations | null> {
  const scoped = db.forTenant(tenantId);
  return (await scoped.appointment.findFirst({
    where: { id: appointmentId },
    include: { client: true, pet: true, service: true },
  })) as ApptWithRelations | null;
}

export async function findRescheduledChild(
  tenantId: string,
  sourceAppointmentId: string,
): Promise<Appointment | null> {
  const scoped = db.forTenant(tenantId);
  return (await scoped.appointment.findFirst({
    where: { rescheduledFromAppointmentId: sourceAppointmentId },
    orderBy: { createdAt: 'desc' },
  })) as Appointment | null;
}
