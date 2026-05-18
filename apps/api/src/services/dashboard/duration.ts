import { db, AppointmentStatus } from '@mygroomtime/db';
import { daysAgo } from './windows.js';

export type DurationSummary = {
  avgMin: number | null;
  sampleSize: number;
  windowDays: number;
};

export type DurationInput = {
  tenantId: string;
  days?: number;
  now?: Date;
};

const DEFAULT_DAYS = 30;
const MS_PER_MIN = 60_000;

// why: avg service duration = completedAt - startedAt over completed appts in window. A
// small offline-replay skew (chunk 18 replays can land a "completed" with a server-side
// completedAt that's a few seconds off the on-device wall clock) is a known limitation we
// don't try to correct — sample size dominates. Rows missing startedAt (e.g. legacy or
// imported) are excluded from the sample.
export async function getAvgDuration(input: DurationInput): Promise<DurationSummary> {
  const days = input.days ?? DEFAULT_DAYS;
  const now = input.now ?? new Date();
  const since = daysAgo(now, days);
  const scoped = db.forTenant(input.tenantId);

  const rows = (await scoped.appointment.findMany({
    where: {
      status: AppointmentStatus.completed,
      completedAt: { gte: since, lte: now },
      NOT: { startedAt: null },
    },
    select: { startedAt: true, completedAt: true },
  })) as Array<{ startedAt: Date | null; completedAt: Date | null }>;

  if (rows.length === 0) return { avgMin: null, sampleSize: 0, windowDays: days };

  let totalMin = 0;
  let counted = 0;
  for (const r of rows) {
    if (!r.startedAt || !r.completedAt) continue;
    const deltaMin = (r.completedAt.getTime() - r.startedAt.getTime()) / MS_PER_MIN;
    if (deltaMin <= 0) continue;
    totalMin += deltaMin;
    counted += 1;
  }

  if (counted === 0) return { avgMin: null, sampleSize: 0, windowDays: days };
  return { avgMin: Math.round(totalMin / counted), sampleSize: counted, windowDays: days };
}
