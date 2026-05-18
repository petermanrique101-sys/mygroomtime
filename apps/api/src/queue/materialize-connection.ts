import type { Redis } from 'ioredis';
import { Queue, Worker, type Processor } from 'bullmq';
import {
  MATERIALIZE_QUEUE,
  type MaterializeJobData,
  type MaterializeJobName,
} from './queue-names.js';

export type MaterializeQueue = Queue<MaterializeJobData, void, MaterializeJobName>;
export type MaterializeWorker = Worker<MaterializeJobData, void, MaterializeJobName>;
export type MaterializeHandler = Processor<MaterializeJobData, void, MaterializeJobName>;

export function createMaterializeQueue(connection: Redis): MaterializeQueue {
  return new Queue<MaterializeJobData, void, MaterializeJobName>(MATERIALIZE_QUEUE, {
    connection,
  });
}

export function createMaterializeWorker(
  connection: Redis,
  handler: MaterializeHandler,
): MaterializeWorker {
  return new Worker<MaterializeJobData, void, MaterializeJobName>(
    MATERIALIZE_QUEUE,
    handler,
    { connection, autorun: true },
  );
}

export async function closeMaterializeInfra(
  worker: MaterializeWorker | null,
  queue: MaterializeQueue | null,
  connection: Redis | null,
): Promise<void> {
  if (worker) await worker.close();
  if (queue) await queue.close();
  if (connection) await connection.quit().catch(() => undefined);
}
