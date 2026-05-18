export const REMINDER_QUEUE = 'sms-reminders';

export const REMINDER_JOB_NAMES = [
  'reminder-7d',
  'reminder-48h',
  'reminder-2h',
  'reminder-post',
] as const;
export type ReminderJobName = (typeof REMINDER_JOB_NAMES)[number];

export type ReminderJobData = {
  appointmentId: string;
  tenantId: string;
};

// why: BullMQ rejects ':' in custom job IDs. We use '.' as the separator so the format is
// still readable and the deterministic-per-(kind, appointment) property is preserved.
export function reminderJobId(name: ReminderJobName, appointmentId: string): string {
  return `${name}.${appointmentId}`;
}

export const MATERIALIZE_QUEUE = 'recurring-materialize';

export const MATERIALIZE_JOB_NAME = 'walk-due-series' as const;
export type MaterializeJobName = typeof MATERIALIZE_JOB_NAME;

export type MaterializeJobData = { tick: number };
