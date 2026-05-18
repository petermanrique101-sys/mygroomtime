import type { Redis } from 'ioredis';
import { Queue, Worker, type Processor } from 'bullmq';
import {
  GCAL_PULL_QUEUE,
  GCAL_PUSH_QUEUE,
  GCAL_RENEW_QUEUE,
  type GcalPullJobData,
  type GcalPullJobName,
  type GcalPushJobData,
  type GcalPushJobName,
  type GcalRenewJobData,
  type GcalRenewJobName,
} from './queue-names.js';

export type GcalPushQueue = Queue<GcalPushJobData, void, GcalPushJobName>;
export type GcalPushWorker = Worker<GcalPushJobData, void, GcalPushJobName>;
export type GcalPushHandler = Processor<GcalPushJobData, void, GcalPushJobName>;

export type GcalPullQueue = Queue<GcalPullJobData, void, GcalPullJobName>;
export type GcalPullWorker = Worker<GcalPullJobData, void, GcalPullJobName>;
export type GcalPullHandler = Processor<GcalPullJobData, void, GcalPullJobName>;

export type GcalRenewQueue = Queue<GcalRenewJobData, void, GcalRenewJobName>;
export type GcalRenewWorker = Worker<GcalRenewJobData, void, GcalRenewJobName>;
export type GcalRenewHandler = Processor<GcalRenewJobData, void, GcalRenewJobName>;

export function createGcalPushQueue(connection: Redis): GcalPushQueue {
  return new Queue<GcalPushJobData, void, GcalPushJobName>(GCAL_PUSH_QUEUE, { connection });
}

export function createGcalPushWorker(
  connection: Redis,
  handler: GcalPushHandler,
): GcalPushWorker {
  return new Worker<GcalPushJobData, void, GcalPushJobName>(GCAL_PUSH_QUEUE, handler, {
    connection,
    autorun: true,
  });
}

export function createGcalPullQueue(connection: Redis): GcalPullQueue {
  return new Queue<GcalPullJobData, void, GcalPullJobName>(GCAL_PULL_QUEUE, { connection });
}

export function createGcalPullWorker(
  connection: Redis,
  handler: GcalPullHandler,
): GcalPullWorker {
  return new Worker<GcalPullJobData, void, GcalPullJobName>(GCAL_PULL_QUEUE, handler, {
    connection,
    autorun: true,
  });
}

export function createGcalRenewQueue(connection: Redis): GcalRenewQueue {
  return new Queue<GcalRenewJobData, void, GcalRenewJobName>(GCAL_RENEW_QUEUE, { connection });
}

export function createGcalRenewWorker(
  connection: Redis,
  handler: GcalRenewHandler,
): GcalRenewWorker {
  return new Worker<GcalRenewJobData, void, GcalRenewJobName>(GCAL_RENEW_QUEUE, handler, {
    connection,
    autorun: true,
  });
}

export async function closeGcalInfra(args: {
  push?: { queue: GcalPushQueue | null; worker: GcalPushWorker | null; connection: Redis | null };
  pull?: { queue: GcalPullQueue | null; worker: GcalPullWorker | null; connection: Redis | null };
  renew?: { queue: GcalRenewQueue | null; worker: GcalRenewWorker | null; connection: Redis | null };
}): Promise<void> {
  const closers: Promise<unknown>[] = [];
  for (const grp of [args.push, args.pull, args.renew]) {
    if (!grp) continue;
    if (grp.worker) closers.push(grp.worker.close());
    if (grp.queue) closers.push(grp.queue.close());
    if (grp.connection) closers.push(grp.connection.quit().catch(() => undefined));
  }
  await Promise.all(closers);
}
