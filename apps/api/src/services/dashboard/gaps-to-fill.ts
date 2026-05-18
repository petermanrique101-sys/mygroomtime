import { db, AppointmentStatus } from '@mygroomtime/db';

export type GapRow = {
  seriesId: string;
  clientId: string;
  clientName: string;
  petName: string;
  lastGroomedAt: Date | null;
  intervalWeeks: number;
  daysOverdue: number;
};

export type GapsInput = {
  tenantId: string;
  now?: Date;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const GAP_THRESHOLD_DAYS_BEYOND_INTERVAL = 7;

// why: for each active RecurringSeries, find the last completed appointment in that series.
// If today - lastCompletedScheduledStart > intervalWeeks*7 + 7 days, surface as overdue.
// Series with no completed parent yet are skipped — those are pre-first-cut, not gaps.
// Returned rows are sorted by daysOverdue desc so the most overdue regulars sit on top.
export async function getGapsToFill(input: GapsInput): Promise<GapRow[]> {
  const now = input.now ?? new Date();
  const scoped = db.forTenant(input.tenantId);

  // why: the scoped delegate returns the full model type; the `select` is honored at runtime
  // but TS can't narrow back to the projected shape without an unknown-mediated cast.
  const series = (await scoped.recurringSeries.findMany({
    where: { active: true },
    select: {
      id: true,
      intervalWeeks: true,
      clientId: true,
      petId: true,
      client: { select: { name: true, deletedAt: true } },
      pet: { select: { name: true, deletedAt: true } },
    },
  })) as unknown as Array<{
    id: string;
    intervalWeeks: number;
    clientId: string;
    petId: string;
    client: { name: string; deletedAt: Date | null };
    pet: { name: string; deletedAt: Date | null };
  }>;

  if (series.length === 0) return [];

  // why: pull the last completed appointment per series in one batch — group + scan is
  // cheaper than N round-trips when active series count grows.
  const lasts = (await scoped.appointment.findMany({
    where: {
      recurringSeriesId: { in: series.map((s) => s.id) },
      status: AppointmentStatus.completed,
    },
    orderBy: { scheduledStart: 'desc' },
    select: { recurringSeriesId: true, scheduledStart: true },
  })) as unknown as Array<{ recurringSeriesId: string | null; scheduledStart: Date }>;

  const lastBySeries = new Map<string, Date>();
  for (const a of lasts) {
    if (!a.recurringSeriesId) continue;
    if (!lastBySeries.has(a.recurringSeriesId)) {
      lastBySeries.set(a.recurringSeriesId, a.scheduledStart);
    }
  }

  const rows: GapRow[] = [];
  for (const s of series) {
    if (s.client.deletedAt || s.pet.deletedAt) continue;
    const last = lastBySeries.get(s.id);
    if (!last) continue;
    const daysSince = Math.floor((now.getTime() - last.getTime()) / MS_PER_DAY);
    const intervalDays = s.intervalWeeks * 7;
    const overdueBy = daysSince - intervalDays;
    if (overdueBy > GAP_THRESHOLD_DAYS_BEYOND_INTERVAL) {
      rows.push({
        seriesId: s.id,
        clientId: s.clientId,
        clientName: s.client.name,
        petName: s.pet.name,
        lastGroomedAt: last,
        intervalWeeks: s.intervalWeeks,
        daysOverdue: daysSince - intervalDays,
      });
    }
  }

  rows.sort((a, b) => b.daysOverdue - a.daysOverdue);
  return rows;
}
