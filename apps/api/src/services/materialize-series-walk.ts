import { db } from '@mygroomtime/db';
import {
  materializeOneSeries,
  type MaterializeDeps,
  type MaterializeOutcome,
} from './materialize-series.js';

export const MATERIALIZATION_HORIZON_MS = 14 * 24 * 60 * 60 * 1000;

// why: cross-tenant scan for the nightly walk. The list is naturally bounded by the
// (active, nextDueDate) index — for a healthy mid-size deployment this is at most a
// few hundred rows per night. We don't paginate; if it ever grows past a comfortable
// in-memory size, chunk-21's multi-vehicle work will introduce per-vehicle sharding.
export async function findDueSeries(now: Date = new Date()): Promise<
  Array<{ id: string; tenantId: string }>
> {
  const horizon = new Date(now.getTime() + MATERIALIZATION_HORIZON_MS);
  const rows = await db.global.recurringSeries.findMany({
    where: {
      active: true,
      nextDueDate: { lte: horizon },
      OR: [
        { nextMaterializationAttemptAt: null },
        { nextMaterializationAttemptAt: { lte: now } },
      ],
    },
    select: { id: true, tenantId: true },
  });
  return rows;
}

export async function materializeAllDueSeries(
  deps: MaterializeDeps,
  now: Date = new Date(),
): Promise<MaterializeOutcome[]> {
  const due = await findDueSeries(now);
  const outcomes: MaterializeOutcome[] = [];
  for (const row of due) {
    try {
      const out = await materializeOneSeries({
        seriesId: row.id,
        tenantId: row.tenantId,
        now,
        deps,
      });
      outcomes.push(out);
    } catch (err) {
      deps.log.warn(
        { seriesId: row.id, tenantId: row.tenantId, error: (err as Error).message },
        'materialize: series threw — continuing the walk',
      );
    }
  }
  return outcomes;
}
