import { db, AppointmentStatus } from '@mygroomtime/db';
import { daysAgo } from './windows.js';

export type NoShowSummary = {
  rate: number;
  sampleSize: number;
  windowDays: number;
};

export type NoShowInput = {
  tenantId: string;
  days?: number;
  now?: Date;
};

const DEFAULT_DAYS = 30;

// why: no-show rate = count(no_show) / count(completed + no_show) in the last N days.
// Window is over completedAt OR noShowAt — we want the appointment to have *resolved*
// in-window, not just been scheduled in-window. Excludes scheduled/canceled/on_the_way/
// started because those carry incomplete data for the metric.
export async function getNoShowRate(input: NoShowInput): Promise<NoShowSummary> {
  const days = input.days ?? DEFAULT_DAYS;
  const now = input.now ?? new Date();
  const since = daysAgo(now, days);
  const scoped = db.forTenant(input.tenantId);

  const rows = (await scoped.appointment.findMany({
    where: {
      status: { in: [AppointmentStatus.completed, AppointmentStatus.no_show] },
      OR: [
        { completedAt: { gte: since, lte: now } },
        { noShowAt: { gte: since, lte: now } },
      ],
    },
    select: { status: true },
  })) as Array<{ status: AppointmentStatus }>;

  if (rows.length === 0) return { rate: 0, sampleSize: 0, windowDays: days };

  let noShow = 0;
  for (const r of rows) {
    if (r.status === AppointmentStatus.no_show) noShow += 1;
  }

  return {
    rate: noShow / rows.length,
    sampleSize: rows.length,
    windowDays: days,
  };
}

export type NoShowRow = {
  appointmentId: string;
  clientId: string;
  clientName: string;
  petName: string;
  serviceName: string;
  scheduledStart: Date;
  noShowAt: Date | null;
};

export type NoShowListInput = {
  tenantId: string;
  days?: number;
  page?: number;
  pageSize?: number;
  now?: Date;
};

export type NoShowListOutput = {
  rows: NoShowRow[];
  total: number;
  page: number;
  pageSize: number;
  windowDays: number;
};

export async function listNoShows(input: NoShowListInput): Promise<NoShowListOutput> {
  const days = input.days ?? DEFAULT_DAYS;
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 25));
  const now = input.now ?? new Date();
  const since = daysAgo(now, days);
  const scoped = db.forTenant(input.tenantId);

  const where = {
    status: AppointmentStatus.no_show,
    noShowAt: { gte: since, lte: now },
  };
  const total = await scoped.appointment.count({ where });
  // why: scoped delegate returns the full Appointment type; the projected `select` shape
  // needs an unknown-mediated cast to be readable at this call site.
  const rows = (await scoped.appointment.findMany({
    where,
    orderBy: { noShowAt: 'desc' },
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: {
      id: true,
      clientId: true,
      noShowAt: true,
      scheduledStart: true,
      serviceNameSnapshot: true,
      client: { select: { name: true } },
      pet: { select: { name: true } },
    },
  })) as unknown as Array<{
    id: string;
    clientId: string;
    noShowAt: Date | null;
    scheduledStart: Date;
    serviceNameSnapshot: string;
    client: { name: string };
    pet: { name: string };
  }>;

  return {
    rows: rows.map((r) => ({
      appointmentId: r.id,
      clientId: r.clientId,
      clientName: r.client.name,
      petName: r.pet.name,
      serviceName: r.serviceNameSnapshot,
      scheduledStart: r.scheduledStart,
      noShowAt: r.noShowAt,
    })),
    total,
    page,
    pageSize,
    windowDays: days,
  };
}
