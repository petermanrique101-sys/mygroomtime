import { db, AppointmentStatus } from '@mygroomtime/db';
import { daysAgo } from './windows.js';

export type TopClientRow = {
  clientId: string;
  name: string;
  totalCents: number;
  appointmentCount: number;
  isDeleted: boolean;
};

export type TopClientsInput = {
  tenantId: string;
  days?: number;
  limit?: number;
  page?: number;
  pageSize?: number;
  now?: Date;
};

export type TopClientsOutput = {
  rows: TopClientRow[];
  total: number;
  page: number;
  pageSize: number;
  windowDays: number;
};

const DEFAULT_DAYS = 90;
const DEFAULT_LIMIT = 5;

// why: sum(finalAmountCents) per clientId where status=completed and completedAt in window,
// desc. Soft-deleted clients still surface (real revenue happened) but tagged isDeleted.
// Aggregation is in-JS — at hundreds-of-completed-rows-per-tenant a flat findMany + reduce
// is faster than three round-trips for groupBy + name lookup + delete-status check.
export async function getTopClients(input: TopClientsInput): Promise<TopClientsOutput> {
  const days = input.days ?? DEFAULT_DAYS;
  const limit = input.limit ?? DEFAULT_LIMIT;
  const now = input.now ?? new Date();
  const since = daysAgo(now, days);
  const scoped = db.forTenant(input.tenantId);

  const rows = (await scoped.appointment.findMany({
    where: {
      status: AppointmentStatus.completed,
      completedAt: { gte: since, lte: now },
    },
    select: {
      clientId: true,
      finalAmountCents: true,
      servicePriceCentsSnapshot: true,
    },
  })) as Array<{
    clientId: string;
    finalAmountCents: number | null;
    servicePriceCentsSnapshot: number;
  }>;

  const byClient = new Map<string, { totalCents: number; appointmentCount: number }>();
  for (const r of rows) {
    const amount = r.finalAmountCents ?? r.servicePriceCentsSnapshot;
    const existing = byClient.get(r.clientId);
    if (existing) {
      existing.totalCents += amount;
      existing.appointmentCount += 1;
    } else {
      byClient.set(r.clientId, { totalCents: amount, appointmentCount: 1 });
    }
  }

  if (byClient.size === 0) {
    return { rows: [], total: 0, page: 1, pageSize: limit, windowDays: days };
  }

  const clientRows = (await scoped.client.findMany({
    where: { id: { in: Array.from(byClient.keys()) } },
    select: { id: true, name: true, deletedAt: true },
  })) as Array<{ id: string; name: string; deletedAt: Date | null }>;
  const nameById = new Map(clientRows.map((c) => [c.id, c]));

  const aggregated: TopClientRow[] = Array.from(byClient.entries()).map(([clientId, agg]) => {
    const meta = nameById.get(clientId);
    return {
      clientId,
      name: meta?.name ?? '(unknown)',
      totalCents: agg.totalCents,
      appointmentCount: agg.appointmentCount,
      isDeleted: !!meta?.deletedAt,
    };
  });

  aggregated.sort((a, b) => {
    if (b.totalCents !== a.totalCents) return b.totalCents - a.totalCents;
    return a.name.localeCompare(b.name);
  });

  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? limit));
  const start = (page - 1) * pageSize;
  return {
    rows: aggregated.slice(start, start + pageSize),
    total: aggregated.length,
    page,
    pageSize,
    windowDays: days,
  };
}
