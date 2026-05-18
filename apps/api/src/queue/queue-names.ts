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

export const GCAL_PUSH_QUEUE = 'gcal-push';

export const GCAL_PUSH_JOB_NAMES = ['gcal-push.create', 'gcal-push.update', 'gcal-push.delete'] as const;
export type GcalPushJobName = (typeof GCAL_PUSH_JOB_NAMES)[number];

export type GcalPushJobData = {
  appointmentId: string;
  tenantId: string;
};

export function gcalPushJobId(name: GcalPushJobName, appointmentId: string): string {
  return `${name}.${appointmentId}`;
}

export const GCAL_PULL_QUEUE = 'gcal-pull';
export const GCAL_PULL_JOB_NAME = 'gcal-pull.delta' as const;
export type GcalPullJobName = typeof GCAL_PULL_JOB_NAME;
export type GcalPullJobData = { linkId: string };
export function gcalPullJobId(linkId: string, messageNumber: string): string {
  // why: dedup by (link, X-Goog-Message-Number). Many notifications can fire before
  // a single pull catches up; only the latest message number wins for ordering, but
  // we still want exactly-one work item per notification at the queue layer.
  return `gcal-pull.${linkId}.${messageNumber}`;
}

export const GCAL_RENEW_QUEUE = 'gcal-renew-watch';
export const GCAL_RENEW_JOB_NAME = 'gcal-renew.tick' as const;
export type GcalRenewJobName = typeof GCAL_RENEW_JOB_NAME;
export type GcalRenewJobData = { tick: number };
