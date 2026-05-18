import { db, AppointmentStatus } from '@mygroomtime/db';
import type { PayrollGroomerRow, PayrollSplitsResponse } from '@mygroomtime/shared';

export type SplitsInput = {
  tenantId: string;
  periodStart: Date;
  periodEnd: Date;
  kind: 'weekly' | 'biweekly';
};

type ApptRow = {
  groomerId: string | null;
  finalAmountCents: number | null;
  servicePriceCentsSnapshot: number;
  tipCents: number;
};

// why: per chunk-21 spec, payroll uses `completedAt` (NOT scheduledStart) and pulls
// `finalAmountCents` (which already includes tips per chunk 16.5). Tips broken out
// separately for the dashboard column. We accept the (tenantId, groomerId, completedAt)
// index from the same migration so this query stays cheap.
export async function getPayrollSplits(input: SplitsInput): Promise<PayrollSplitsResponse> {
  const scoped = db.forTenant(input.tenantId);
  const rows = (await scoped.appointment.findMany({
    where: {
      status: AppointmentStatus.completed,
      completedAt: { gte: input.periodStart, lt: input.periodEnd },
    },
    select: {
      groomerId: true,
      finalAmountCents: true,
      servicePriceCentsSnapshot: true,
      tipCents: true,
    },
  })) as ApptRow[];

  const groomerIds = Array.from(
    new Set(rows.map((r) => r.groomerId).filter((id): id is string => !!id)),
  );

  // why: hydrate groomer email/name in one batched read. Email is the CSV's stable
  // identifier per spec (operators recognize email > display name when reconciling).
  const groomers = groomerIds.length
    ? await scoped.user.findMany({
        where: { id: { in: groomerIds } },
        select: { id: true, email: true, name: true },
      })
    : [];
  const groomerById = new Map(groomers.map((g) => [g.id, g] as const));

  type Bucket = {
    groomerId: string | null;
    appointmentsCompleted: number;
    revenueCents: number;
    tipsCents: number;
    totalCents: number;
  };
  const buckets = new Map<string, Bucket>();
  for (const r of rows) {
    const key = r.groomerId ?? '__unassigned__';
    let b = buckets.get(key);
    if (!b) {
      b = {
        groomerId: r.groomerId,
        appointmentsCompleted: 0,
        revenueCents: 0,
        tipsCents: 0,
        totalCents: 0,
      };
      buckets.set(key, b);
    }
    const total = r.finalAmountCents ?? r.servicePriceCentsSnapshot;
    const tips = r.tipCents;
    b.appointmentsCompleted += 1;
    b.totalCents += total;
    b.tipsCents += tips;
    b.revenueCents += total - tips;
  }

  const out: PayrollGroomerRow[] = Array.from(buckets.values()).map((b) => {
    const user = b.groomerId ? groomerById.get(b.groomerId) : undefined;
    return {
      groomerId: b.groomerId,
      groomerEmail: user?.email ?? null,
      groomerName: user?.name ?? null,
      appointmentsCompleted: b.appointmentsCompleted,
      revenueCents: b.revenueCents,
      tipsCents: b.tipsCents,
      totalCents: b.totalCents,
    };
  });

  out.sort((a, b) => {
    const an = (a.groomerName ?? a.groomerEmail ?? '~').toLowerCase();
    const bn = (b.groomerName ?? b.groomerEmail ?? '~').toLowerCase();
    return an.localeCompare(bn);
  });

  const totals = out.reduce(
    (acc, r) => ({
      appointmentsCompleted: acc.appointmentsCompleted + r.appointmentsCompleted,
      revenueCents: acc.revenueCents + r.revenueCents,
      tipsCents: acc.tipsCents + r.tipsCents,
      totalCents: acc.totalCents + r.totalCents,
    }),
    { appointmentsCompleted: 0, revenueCents: 0, tipsCents: 0, totalCents: 0 },
  );

  return {
    period: {
      periodStart: input.periodStart.toISOString(),
      periodEnd: input.periodEnd.toISOString(),
      kind: input.kind,
    },
    rows: out,
    totals,
  };
}
