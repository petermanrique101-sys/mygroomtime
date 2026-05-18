import { Redis } from 'ioredis';
import { Queue } from 'bullmq';
import { loadEnv } from '../src/config/env.js';
import { createAdapters } from '../src/adapters/index.js';
import { createMemorySessionStore } from '../src/adapters/session/index.js';
import { createStdoutEmailAdapter } from '../src/adapters/email/index.js';
import { REMINDER_QUEUE, type ReminderJobData, type ReminderJobName } from '../src/queue/queue-names.js';
import { materializeAllDueSeries } from '../src/services/materialize-series-walk.js';

// why: dev convenience — invoke the nightly walk now so you can verify materialization
// without waiting for 02:00 UTC. Bypasses BullMQ entirely (calls the walker directly),
// so the queue state stays clean. Usage: pnpm dev:fire-materialization
async function main(): Promise<void> {
  const env = loadEnv();
  const sessionStore = createMemorySessionStore();
  const emailAdapter = createStdoutEmailAdapter();
  const adapters = createAdapters(env, { session: sessionStore, email: emailAdapter });

  const redisUrl = env.redisUrl;
  const reminderConnection = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  const reminderQueue = new Queue<ReminderJobData, void, ReminderJobName>(REMINDER_QUEUE, {
    connection: reminderConnection,
  });

  const log = {
    info: (o: object, msg: string) => console.log(JSON.stringify({ level: 'info', msg, ...o })),
    warn: (o: object, msg: string) => console.warn(JSON.stringify({ level: 'warn', msg, ...o })),
  };

  const outcomes = await materializeAllDueSeries({
    gmaps: adapters.gmaps,
    reminderQueue,
    log,
  });
  console.log(`processed ${outcomes.length} due series:`);
  for (const o of outcomes) console.log('  ', o);

  await reminderQueue.close();
  await reminderConnection.quit().catch(() => undefined);
  await adapters.session.close();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
