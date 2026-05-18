import type { Redis } from 'ioredis';
import {
  createReminderQueue,
  createReminderRedis,
  createReminderWorker,
  type ReminderHandler,
  type ReminderQueue,
  type ReminderWorker,
} from './connection.js';

const TEST_REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

export async function makeTestReminderInfra(handler?: ReminderHandler): Promise<{
  queue: ReminderQueue;
  worker: ReminderWorker | null;
  connection: Redis;
  workerConnection: Redis | null;
  close: () => Promise<void>;
}> {
  const connection = createReminderRedis(TEST_REDIS_URL);
  const queue = createReminderQueue(connection);
  await queue.obliterate({ force: true }).catch(() => undefined);

  let worker: ReminderWorker | null = null;
  let workerConnection: Redis | null = null;
  if (handler) {
    workerConnection = createReminderRedis(TEST_REDIS_URL);
    worker = createReminderWorker(workerConnection, handler);
    await worker.waitUntilReady();
  }

  return {
    queue,
    worker,
    connection,
    workerConnection,
    async close() {
      if (worker) await worker.close();
      await queue.obliterate({ force: true }).catch(() => undefined);
      await queue.close();
      await connection.quit().catch(() => undefined);
      if (workerConnection) await workerConnection.quit().catch(() => undefined);
    },
  };
}
