import { Job } from 'bullmq';
import {
  REMINDER_JOB_NAMES,
  reminderJobId,
  type ReminderJobData,
  type ReminderJobName,
} from '../queue/queue-names.js';
import type { ReminderQueue } from '../queue/connection.js';

export type ReminderAppointment = {
  id: string;
  scheduledStart: Date;
  durationMin: number;
};

export type ReminderTimestamps = {
  fortyEightH: Date | null;
  twoH: Date | null;
  post: Date | null;
};

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const FORTY_EIGHT_H = 48 * HOUR;
const TWO_H = 2 * HOUR;
const POST_OFFSET_H = 24 * HOUR;

// why: a reminder we'd schedule in the past is impossible to fire. We compute against `now`
// at enqueue time and emit nulls for the windows that have already lapsed. The worker has a
// second-line check for "appointment canceled between enqueue and fire" — this just stops
// jobs from being created with negative delays in the first place.
export function computeReminderTimestamps(
  appointment: ReminderAppointment,
  now: Date = new Date(),
): ReminderTimestamps {
  const start = appointment.scheduledStart.getTime();
  const end = start + appointment.durationMin * MIN;
  const nowMs = now.getTime();

  const fortyEight = start - FORTY_EIGHT_H;
  const two = start - TWO_H;
  const post = end + POST_OFFSET_H;

  return {
    fortyEightH: fortyEight > nowMs ? new Date(fortyEight) : null,
    twoH: two > nowMs ? new Date(two) : null,
    post: post > nowMs ? new Date(post) : null,
  };
}

const NAME_TO_FIELD: Record<ReminderJobName, keyof ReminderTimestamps> = {
  'reminder-48h': 'fortyEightH',
  'reminder-2h': 'twoH',
  'reminder-post': 'post',
};

export type EnqueueResult = {
  enqueued: ReminderJobName[];
  skipped: ReminderJobName[];
};

export async function enqueueAppointmentReminders(
  queue: ReminderQueue,
  appointment: ReminderAppointment,
  tenantId: string,
  smsRemindersEnabled: boolean,
  now: Date = new Date(),
): Promise<EnqueueResult> {
  if (!smsRemindersEnabled) {
    return { enqueued: [], skipped: [...REMINDER_JOB_NAMES] };
  }

  const ts = computeReminderTimestamps(appointment, now);
  const enqueued: ReminderJobName[] = [];
  const skipped: ReminderJobName[] = [];
  const data: ReminderJobData = { appointmentId: appointment.id, tenantId };

  for (const name of REMINDER_JOB_NAMES) {
    const when = ts[NAME_TO_FIELD[name]];
    if (!when) {
      skipped.push(name);
      continue;
    }
    const delay = Math.max(0, when.getTime() - now.getTime());
    await queue.add(name, data, {
      jobId: reminderJobId(name, appointment.id),
      delay,
      attempts: 5,
      backoff: { type: 'exponential', delay: 30_000 },
      removeOnComplete: 1000,
      removeOnFail: 500,
    });
    enqueued.push(name);
  }
  return { enqueued, skipped };
}

export async function removeAppointmentReminders(
  queue: ReminderQueue,
  appointmentId: string,
): Promise<void> {
  // why: BullMQ's `add()` with an existing jobId is a no-op (it returns the existing job).
  // So upsert can't shift timestamps. Reschedule = remove + add. We fetch the Job and call
  // `.remove()` rather than `queue.remove(jobId)` so we can swallow "lock not found / job
  // not found" silently — a job that already fired or was never enqueued is the same as
  // success here.
  for (const name of REMINDER_JOB_NAMES) {
    const id = reminderJobId(name, appointmentId);
    try {
      const job = await Job.fromId(queue, id);
      if (job) {
        await job.remove();
      }
    } catch {
      // already executing or already gone — both are fine.
    }
  }
}

export async function rescheduleAppointmentReminders(
  queue: ReminderQueue,
  appointment: ReminderAppointment,
  tenantId: string,
  smsRemindersEnabled: boolean,
  now: Date = new Date(),
): Promise<EnqueueResult> {
  await removeAppointmentReminders(queue, appointment.id);
  return enqueueAppointmentReminders(queue, appointment, tenantId, smsRemindersEnabled, now);
}
