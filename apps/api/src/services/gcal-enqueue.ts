import { db } from '@mygroomtime/db';
import type { GcalPushQueue } from '../queue/gcal-connection.js';
import {
  gcalPushJobId,
  type GcalPushJobData,
  type GcalPushJobName,
  type GcalPushLinkKind,
} from '../queue/queue-names.js';

export type EnqueuePushesArgs = {
  queue: GcalPushQueue | null;
  tenantId: string;
  appointmentId: string;
  kind: 'create' | 'update' | 'delete';
  // why: cross-vehicle drag passes the source groomerId so the user-side push knows to
  // delete the event from the old groomer's calendar. Null on same-groomer updates.
  previousGroomerId?: string | null;
  // why: source vehicle for symmetry with previousGroomerId. Currently unused at enqueue
  // time (route recompute is done by the caller), but kept so future ops-link variants
  // can attach per-vehicle metadata without re-plumbing.
  previousVehicleId?: string | null;
};

export type EnqueuePushesResult = {
  user: { enqueued: boolean; reason?: string };
  ops: { enqueued: boolean; reason?: string };
};

// why: chunk-21 splits the push into TWO link kinds — the assigned groomer's user link,
// and the tenant operations calendar (if linked). The two pushes write to different
// `(appointmentId, linkKind)` job IDs so a BullMQ collision on one kind never starves
// the other. The worker re-fetches the appointment and looks up the link by kind, so
// the latest mutation always wins.
export async function enqueueAppointmentGcalPushes(
  args: EnqueuePushesArgs,
): Promise<EnqueuePushesResult> {
  if (!args.queue) {
    return {
      user: { enqueued: false, reason: 'no_queue' },
      ops: { enqueued: false, reason: 'no_queue' },
    };
  }

  const scoped = db.forTenant(args.tenantId);
  const appt = await scoped.appointment.findFirst({
    where: { id: args.appointmentId },
    select: { id: true, groomerId: true },
  });
  if (!appt) {
    return {
      user: { enqueued: false, reason: 'appt_missing' },
      ops: { enqueued: false, reason: 'appt_missing' },
    };
  }

  const userResult = await enqueueUserPush(args, scoped, appt.groomerId);
  const opsResult = await enqueueOpsPush(args, scoped);
  return { user: userResult, ops: opsResult };
}

// why: kept as a thin alias of the dual enqueue for the small number of code paths that
// only care about one outcome (worker tests). Returns the user-side result for backwards
// shape with the chunk-20 caller surface.
export async function enqueueGcalPushIfLinked(
  args: Omit<EnqueuePushesArgs, 'previousGroomerId' | 'previousVehicleId'>,
): Promise<{ enqueued: boolean; reason?: string }> {
  const result = await enqueueAppointmentGcalPushes({
    ...args,
    previousGroomerId: null,
    previousVehicleId: null,
  });
  if (result.user.enqueued) return result.user;
  if (result.ops.enqueued) return result.ops;
  return result.user;
}

async function enqueueUserPush(
  args: EnqueuePushesArgs,
  scoped: ReturnType<typeof db.forTenant>,
  groomerId: string | null,
): Promise<{ enqueued: boolean; reason?: string }> {
  if (!groomerId && !args.previousGroomerId) {
    return { enqueued: false, reason: 'no_groomer' };
  }

  // why: for cross-vehicle drag with a groomer change, we need the destination side to
  // create-on-new even if the new groomer has no link, AND we still want the delete on
  // the OLD side. Strategy: prefer the destination groomer's link; fall back to the
  // previous groomer's link when the destination has no link but the source did.
  const linkUserId = groomerId ?? args.previousGroomerId;
  if (!linkUserId) return { enqueued: false, reason: 'no_groomer' };

  const link = await scoped.googleCalendarLink.findFirst({
    where: { userId: linkUserId, linkKind: 'user', needsReauth: false },
    select: { id: true },
  });
  if (!link) return { enqueued: false, reason: 'no_link' };

  return enqueuePushJob({
    queue: args.queue!,
    tenantId: args.tenantId,
    appointmentId: args.appointmentId,
    kind: args.kind,
    linkKind: 'user',
    previousGroomerId: args.previousGroomerId ?? null,
  });
}

async function enqueueOpsPush(
  args: EnqueuePushesArgs,
  scoped: ReturnType<typeof db.forTenant>,
): Promise<{ enqueued: boolean; reason?: string }> {
  const opsLink = await scoped.googleCalendarLink.findFirst({
    where: { linkKind: 'tenant_operations', needsReauth: false },
    select: { id: true },
  });
  if (!opsLink) return { enqueued: false, reason: 'no_ops_link' };

  return enqueuePushJob({
    queue: args.queue!,
    tenantId: args.tenantId,
    appointmentId: args.appointmentId,
    kind: args.kind,
    linkKind: 'tenant_operations',
    previousGroomerId: null,
  });
}

async function enqueuePushJob(args: {
  queue: GcalPushQueue;
  tenantId: string;
  appointmentId: string;
  kind: 'create' | 'update' | 'delete';
  linkKind: GcalPushLinkKind;
  previousGroomerId: string | null;
}): Promise<{ enqueued: true }> {
  const name: GcalPushJobName = (`gcal-push.${args.kind}` as GcalPushJobName);
  const data: GcalPushJobData = {
    appointmentId: args.appointmentId,
    tenantId: args.tenantId,
    linkKind: args.linkKind,
    previousGroomerId: args.previousGroomerId,
  };
  await args.queue.add(name, data, {
    jobId: gcalPushJobId(name, args.appointmentId, args.linkKind),
    attempts: 5,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: 1000,
    removeOnFail: 500,
  });
  return { enqueued: true };
}
