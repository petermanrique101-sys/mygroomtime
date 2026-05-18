import { db, AppointmentStatus } from '@mygroomtime/db';
import { startOfDay, startOfMonth, startOfWeek, startOfDayKey } from './windows.js';

export type RevenueSummary = {
  dayCents: number;
  weekCents: number;
  monthCents: number;
};

export type RevenueInput = {
  tenantId: string;
  now?: Date;
};

// why: revenue = sum(finalAmountCents) where status='completed' in window. Tips are already
// included in finalAmountCents (chunk 16.5). Refunds are NOT subtracted in v1 —
// TODO chunk 22 when Refund tracking lands.
export async function getRevenue(input: RevenueInput): Promise<RevenueSummary> {
  const now = input.now ?? new Date();
  const monthStart = startOfMonth(now);
  const scoped = db.forTenant(input.tenantId);

  // why: pull one slim batch covering month start → now, then bucket in JS. Month is the
  // widest window of the three, so a single fetch beats three round-trips. The
  // (tenantId, completedAt) index keeps the scan cheap at hundreds-to-low-thousands of rows.
  const rows = (await scoped.appointment.findMany({
    where: {
      status: AppointmentStatus.completed,
      completedAt: { gte: monthStart, lte: now },
    },
    select: { finalAmountCents: true, servicePriceCentsSnapshot: true, completedAt: true },
  })) as Array<{
    finalAmountCents: number | null;
    servicePriceCentsSnapshot: number;
    completedAt: Date | null;
  }>;

  const dayStart = startOfDay(now);
  const weekStart = startOfWeek(now);
  let dayCents = 0;
  let weekCents = 0;
  let monthCents = 0;

  for (const r of rows) {
    if (!r.completedAt) continue;
    const amount = r.finalAmountCents ?? r.servicePriceCentsSnapshot;
    monthCents += amount;
    if (r.completedAt >= weekStart) weekCents += amount;
    if (r.completedAt >= dayStart) dayCents += amount;
  }

  return { dayCents, weekCents, monthCents };
}

export type RevenueBucket = {
  dateIso: string;
  revenueCents: number;
  appointmentCount: number;
};

export type RevenueDetailInput = {
  tenantId: string;
  period: 'day' | 'week' | 'month';
  now?: Date;
};

// why: drilldown chart data. Daily buckets covering the period. "day" returns the single
// day; "week"/"month" return per-day rows. Buckets with zero revenue ARE included so the
// chart shows the dip rather than collapsing the x-axis.
export async function getRevenueBuckets(input: RevenueDetailInput): Promise<RevenueBucket[]> {
  const now = input.now ?? new Date();
  const start =
    input.period === 'day'
      ? startOfDay(now)
      : input.period === 'week'
      ? startOfWeek(now)
      : startOfMonth(now);
  const scoped = db.forTenant(input.tenantId);

  const rows = (await scoped.appointment.findMany({
    where: {
      status: AppointmentStatus.completed,
      completedAt: { gte: start, lte: now },
    },
    select: { finalAmountCents: true, servicePriceCentsSnapshot: true, completedAt: true },
  })) as Array<{
    finalAmountCents: number | null;
    servicePriceCentsSnapshot: number;
    completedAt: Date | null;
  }>;

  const byDay = new Map<string, { revenueCents: number; appointmentCount: number }>();
  const cursor = new Date(start);
  while (cursor <= now) {
    byDay.set(startOfDayKey(cursor), { revenueCents: 0, appointmentCount: 0 });
    cursor.setDate(cursor.getDate() + 1);
  }

  for (const r of rows) {
    if (!r.completedAt) continue;
    const key = startOfDayKey(r.completedAt);
    const bucket = byDay.get(key);
    if (!bucket) continue;
    bucket.revenueCents += r.finalAmountCents ?? r.servicePriceCentsSnapshot;
    bucket.appointmentCount += 1;
  }

  return Array.from(byDay.entries()).map(([dateIso, b]) => ({
    dateIso,
    revenueCents: b.revenueCents,
    appointmentCount: b.appointmentCount,
  }));
}
