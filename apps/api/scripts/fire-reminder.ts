import { Queue, Job } from 'bullmq';
import { Redis } from 'ioredis';
import {
  REMINDER_JOB_NAMES,
  REMINDER_QUEUE,
  reminderJobId,
  type ReminderJobName,
} from '../src/queue/queue-names.js';

// why: dev convenience — promote a delayed reminder job so it runs now without waiting
// 48 hours. Chunk 22 will own the operator-facing version on the admin UI. Usage:
//   pnpm dev:fire-reminder <appointmentId> <kind>
//   kind ∈ reminder-48h | reminder-2h | reminder-post
async function main(): Promise<void> {
  const [appointmentId, kindArg] = process.argv.slice(2);
  if (!appointmentId || !kindArg) {
    console.error('usage: dev:fire-reminder <appointmentId> <kind>');
    console.error(`  kind ∈ ${REMINDER_JOB_NAMES.join(' | ')}`);
    process.exit(1);
  }
  if (!(REMINDER_JOB_NAMES as readonly string[]).includes(kindArg)) {
    console.error(`invalid kind: ${kindArg}. expected one of ${REMINDER_JOB_NAMES.join(', ')}`);
    process.exit(1);
  }
  const kind = kindArg as ReminderJobName;
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

  const queue = new Queue(REMINDER_QUEUE, { connection });
  const id = reminderJobId(kind, appointmentId);
  const job = await Job.fromId(queue, id);
  if (!job) {
    console.error(`no job with id ${id}`);
    process.exit(2);
  }
  await job.promote();
  console.log(`promoted ${id} — the worker should pick it up immediately.`);
  await queue.close();
  await connection.quit();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
