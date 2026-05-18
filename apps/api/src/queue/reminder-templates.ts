import type { ReminderJobName } from './queue-names.js';

export type ReminderTemplateVars = {
  firstName: string;
  tenantName: string;
  petName: string;
  serviceName: string;
  dateTimeFormatted: string;
};

// why: SMS bodies live here, not scattered through the worker. Keep the leading body bare
// (no STOP suffix, no Reply-* footer) — the Twilio adapter appends those and handles
// truncation. Reviews-URL omission is intentional v1; chunk 21 wires Tenant.reviewUrl.
export function renderReminderBody(
  name: ReminderJobName,
  v: ReminderTemplateVars,
): string {
  switch (name) {
    case 'reminder-48h':
      return `Hi ${v.firstName}, this is ${v.tenantName} confirming ${v.petName}'s ${v.serviceName} on ${v.dateTimeFormatted}.`;
    case 'reminder-2h':
      return `Hi ${v.firstName}, ${v.tenantName} is heading to ${v.petName} in about 2 hours for ${v.serviceName}.`;
    case 'reminder-post':
      return `Thanks for trusting ${v.tenantName} with ${v.petName}. We'd love your feedback!`;
  }
}

export function firstName(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) return '';
  return trimmed.split(/\s+/)[0] ?? trimmed;
}
