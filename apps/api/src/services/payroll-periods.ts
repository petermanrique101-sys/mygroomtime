import { PayrollPeriodKind } from '@mygroomtime/db';
import type { PayrollPeriod } from '@mygroomtime/shared';

export type ComputePeriodsInput = {
  kind: PayrollPeriodKind;
  anchor: Date | null;
  from: Date;
  to: Date;
  now?: Date;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function startOfDayUtc(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

// why: ISO weeks start on Monday. For weekly payroll we ignore the tenant anchor and
// snap to Monday so periods line up with how owners read a calendar. UTC for v1; tenant
// TZ comes in chunk 22.
function startOfIsoWeek(d: Date): Date {
  const x = startOfDayUtc(d);
  const day = x.getUTCDay(); // 0=Sun ... 6=Sat
  const offset = (day + 6) % 7; // distance back to Monday
  x.setUTCDate(x.getUTCDate() - offset);
  return x;
}

// why: biweekly cycle is anchored to a tenant-provided date. We snap the anchor to the
// start of its UTC day, then walk forward/back in 14-day strides to find the period
// containing the target. If no anchor is set, default to the first Monday on or after
// 2000-01-03 (= ISO week 1 of Y2K). This keeps the math deterministic until the owner
// chooses an anchor.
const DEFAULT_BIWEEKLY_ANCHOR = new Date(Date.UTC(2000, 0, 3));

function biweeklyPeriodContaining(target: Date, anchorRaw: Date | null): {
  start: Date;
  end: Date;
} {
  const anchor = startOfDayUtc(anchorRaw ?? DEFAULT_BIWEEKLY_ANCHOR);
  const targetDay = startOfDayUtc(target);
  const diffDays = Math.floor((targetDay.getTime() - anchor.getTime()) / MS_PER_DAY);
  const cyclesBack = Math.floor(diffDays / 14);
  const start = new Date(anchor);
  start.setUTCDate(anchor.getUTCDate() + cyclesBack * 14);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 14);
  return { start, end };
}

function weeklyPeriodContaining(target: Date): { start: Date; end: Date } {
  const start = startOfIsoWeek(target);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 7);
  return { start, end };
}

export function periodContaining(args: {
  kind: PayrollPeriodKind;
  anchor: Date | null;
  target: Date;
}): { start: Date; end: Date } {
  if (args.kind === PayrollPeriodKind.weekly) {
    return weeklyPeriodContaining(args.target);
  }
  return biweeklyPeriodContaining(args.target, args.anchor);
}

// why: enumerate every period boundary whose [start, end) intersects [from, to]. We
// step strictly forward from the first containing period; one stride is the period
// length (7 for weekly, 14 for biweekly). Inclusive at the start, exclusive at the end.
export function computePeriods(input: ComputePeriodsInput): PayrollPeriod[] {
  const periods: PayrollPeriod[] = [];
  const strideDays = input.kind === PayrollPeriodKind.weekly ? 7 : 14;
  let cursor = periodContaining({
    kind: input.kind,
    anchor: input.anchor,
    target: input.from,
  });

  while (cursor.start.getTime() < input.to.getTime()) {
    periods.push({
      periodStart: cursor.start.toISOString(),
      periodEnd: cursor.end.toISOString(),
      kind: input.kind,
    });
    const nextStart = new Date(cursor.start);
    nextStart.setUTCDate(cursor.start.getUTCDate() + strideDays);
    const nextEnd = new Date(cursor.end);
    nextEnd.setUTCDate(cursor.end.getUTCDate() + strideDays);
    cursor = { start: nextStart, end: nextEnd };
  }
  return periods;
}
