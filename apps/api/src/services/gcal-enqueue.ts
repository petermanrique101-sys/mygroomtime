import { db } from '@mygroomtime/db';
import type { GcalPushQueue } from '../queue/gcal-connection.js';
import {
  gcalPushJobId,
  type GcalPushJobData,
  type GcalPushJobName,
} from '../queue/queue-names.js';

// why: every appointment mutation in chunks 8 / 16.5 / 17 calls this AFTER its DB commit.
// We look up the assigned groomer's active GoogleCalendarLink first; if there's no link
// (unassigned appointment, groomer hasn't connected, link in needsReauth) we skip the
// enqueue entirely so we don't build up dead jobs for groomers without GCal.
export async function enqueueGcalPushIfLinked(args: {
  queue: GcalPushQueue | null;
  tenantId: string;
  appointmentId: string;
  kind: 'create' | 'update' | 'delete';
}): Promise<{ enqueued: boolean; reason?: string }> {
  if (!args.queue) return { enqueued: false, reason: 'no_queue' };

  const scoped = db.forTenant(args.tenantId);
  const appt = await scoped.appointment.findFirst({
    where: { id: args.appointmentId },
    select: { id: true, groomerId: true },
  });
  if (!appt) return { enqueued: false, reason: 'appt_missing' };
  if (!appt.groomerId) return { enqueued: false, reason: 'no_groomer' };

  const link = await scoped.googleCalendarLink.findFirst({
    where: { userId: appt.groomerId, needsReauth: false },
    select: { id: true },
  });
  if (!link) return { enqueued: false, reason: 'no_link' };

  const name: GcalPushJobName = (`gcal-push.${args.kind}` as GcalPushJobName);
  const data: GcalPushJobData = {
    appointmentId: args.appointmentId,
    tenantId: args.tenantId,
  };
  // why: jobId is per-(kind, appointmentId). If a second mutation lands while the first
  // job is still queued, BullMQ's add-with-existing-jobId is a no-op — and that's the
  // wrong behavior here (the second mutation has fresher data). The worker re-reads the
  // appointment at fire time, so a no-op-collision is acceptable for create/update; for
  // delete we use a separate name so it can't be swallowed by a pending update.
  await args.queue.add(name, data, {
    jobId: gcalPushJobId(name, args.appointmentId),
    attempts: 5,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: 1000,
    removeOnFail: 500,
  });
  return { enqueued: true };
}
