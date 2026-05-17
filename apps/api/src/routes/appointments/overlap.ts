import type { Appointment, TenantScopedDb } from '@mygroomtime/db';
import { AppointmentStatus } from '@mygroomtime/db';

const BLOCKING_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.scheduled,
  AppointmentStatus.on_the_way,
  AppointmentStatus.started,
  AppointmentStatus.completed,
];

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export async function findOverlappingAppointment(
  scoped: TenantScopedDb,
  args: {
    vehicleId: string;
    start: Date;
    durationMin: number;
    excludeId?: string;
  },
): Promise<Appointment | null> {
  const proposedEndMs = args.start.getTime() + args.durationMin * 60_000;
  // why: prisma can't compare start + duration arithmetically against another row, so we
  // fetch same-day non-canceled appts for the vehicle and filter in memory. Same-day +
  // single-vehicle + small N (≤ ~20/day) keeps this cheap.
  const candidates = (await scoped.appointment.findMany({
    where: {
      vehicleId: args.vehicleId,
      status: { in: BLOCKING_STATUSES },
      scheduledStart: { gte: startOfDay(args.start), lte: endOfDay(args.start) },
      ...(args.excludeId ? { NOT: { id: args.excludeId } } : {}),
    },
  })) as Appointment[];
  for (const a of candidates) {
    const aStart = a.scheduledStart.getTime();
    const aEnd = aStart + a.durationMin * 60_000;
    if (aStart < proposedEndMs && aEnd > args.start.getTime()) return a;
  }
  return null;
}
