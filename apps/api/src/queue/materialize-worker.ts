import type { Job } from 'bullmq';
import type { FastifyBaseLogger } from 'fastify';
import type { GmapsAdapter } from '../adapters/gmaps/index.js';
import type { MaterializeDeps } from '../services/materialize-series.js';
import { materializeAllDueSeries } from '../services/materialize-series-walk.js';
import type { ReminderQueue } from './connection.js';
import type { GcalPushQueue } from './gcal-connection.js';
import type { MaterializeHandler } from './materialize-connection.js';
import type { MaterializeJobData, MaterializeJobName } from './queue-names.js';

export type MaterializeWorkerDeps = {
  gmaps: GmapsAdapter;
  reminderQueue: ReminderQueue | null;
  gcalPushQueue: GcalPushQueue | null;
  log: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>;
};

// why: the nightly job fires once per day (BullMQ repeat). It walks all RecurringSeries
// with nextDueDate within the 14-day horizon and processes each. Per-series failures are
// caught inside materializeAllDueSeries so a single bad row doesn't abort the walk.
export function createMaterializeHandler(deps: MaterializeWorkerDeps): MaterializeHandler {
  return async function handle(
    job: Job<MaterializeJobData, void, MaterializeJobName>,
  ): Promise<void> {
    const start = Date.now();
    const materializeDeps: MaterializeDeps = {
      gmaps: deps.gmaps,
      reminderQueue: deps.reminderQueue,
      gcalPushQueue: deps.gcalPushQueue,
      log: deps.log,
    };
    const outcomes = await materializeAllDueSeries(materializeDeps, new Date());
    const counts = { materialized: 0, alreadyMaterialized: 0, pausedSource: 0, retried: 0, pausedNoSlot: 0 };
    for (const o of outcomes) {
      switch (o.status) {
        case 'materialized':
          counts.materialized += 1;
          break;
        case 'skipped_already_materialized':
          counts.alreadyMaterialized += 1;
          break;
        case 'paused_source_deleted':
          counts.pausedSource += 1;
          break;
        case 'skipped_no_slot_retry':
          counts.retried += 1;
          break;
        case 'paused_no_slot':
          counts.pausedNoSlot += 1;
          break;
      }
    }
    deps.log.info(
      { jobId: job.id, durationMs: Date.now() - start, ...counts },
      'materialize worker: nightly walk completed',
    );
  };
}
