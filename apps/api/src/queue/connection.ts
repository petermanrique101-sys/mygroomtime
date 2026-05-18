import { Redis, type RedisOptions } from 'ioredis';
import { Queue, Worker, type Processor } from 'bullmq';
import {
  REMINDER_QUEUE,
  type ReminderJobData,
  type ReminderJobName,
} from './queue-names.js';

export type ReminderQueue = Queue<ReminderJobData, void, ReminderJobName>;
export type ReminderWorker = Worker<ReminderJobData, void, ReminderJobName>;

export type ReminderHandler = Processor<ReminderJobData, void, ReminderJobName>;

// why: BullMQ requires `maxRetriesPerRequest: null` on the underlying ioredis connection.
// We expose a factory so tests can stub against an isolated Redis URL (or a mock) without
// touching the production startup wiring.
export function createReminderRedis(redisUrl: string, overrides: RedisOptions = {}): Redis {
  return new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    ...overrides,
  });
}

export function createReminderQueue(connection: Redis): ReminderQueue {
  return new Queue<ReminderJobData, void, ReminderJobName>(REMINDER_QUEUE, { connection });
}

export function createReminderWorker(
  connection: Redis,
  handler: ReminderHandler,
): ReminderWorker {
  // why: BullMQ defaults retry to immediate failure. The spec wants exponential backoff up
  // to 5 attempts; after that the job lands in BullMQ's `failed` state (dead-letter).
  return new Worker<ReminderJobData, void, ReminderJobName>(REMINDER_QUEUE, handler, {
    connection,
    autorun: true,
    settings: { backoffStrategy: undefined },
  });
}

export async function closeReminderInfra(
  worker: ReminderWorker | null,
  queue: ReminderQueue | null,
  connection: Redis | null,
): Promise<void> {
  if (worker) await worker.close();
  if (queue) await queue.close();
  if (connection) await connection.quit().catch(() => undefined);
}
