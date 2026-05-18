import { randomBytes } from 'node:crypto';
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

// why: each test infra gets a unique queue name so it doesn't contend with a long-running
// dev `pnpm dev` worker that holds a BZPOPMIN on the production `sms-reminders` queue.
// Without this, the dev worker grabs every job the test enqueues — the test's own worker
// never sees a `completed`/`failed` event and the test times out at 5s.
function makeUniqueTestQueueName(): string {
  return `sms-reminders-test-${process.pid}-${randomBytes(4).toString('hex')}`;
}

export async function makeTestReminderInfra(handler?: ReminderHandler): Promise<{
  queue: ReminderQueue;
  worker: ReminderWorker | null;
  connection: Redis;
  workerConnection: Redis | null;
  close: () => Promise<void>;
}> {
  const queueName = makeUniqueTestQueueName();
  const connection = createReminderRedis(TEST_REDIS_URL);
  const queue = createReminderQueue(connection, queueName);
  await queue.obliterate({ force: true }).catch(() => undefined);

  let worker: ReminderWorker | null = null;
  let workerConnection: Redis | null = null;
  if (handler) {
    workerConnection = createReminderRedis(TEST_REDIS_URL);
    worker = createReminderWorker(workerConnection, handler, queueName);
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
