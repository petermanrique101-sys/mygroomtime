import type { Job } from 'bullmq';
import { AppointmentStatus, db } from '@mygroomtime/db';
import type { FastifyBaseLogger } from 'fastify';
import type { TwilioAdapter } from '../adapters/twilio/index.js';
import type { ReminderHandler } from './connection.js';
import {
  type ReminderJobData,
  type ReminderJobName,
} from './queue-names.js';
import { firstName, renderReminderBody } from './reminder-templates.js';
import { formatAppointmentDateTime } from '../services/format-datetime.js';
import { toDialFormat } from '../services/phone.js';

export type ReminderWorkerDeps = {
  twilio: TwilioAdapter;
  log: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>;
};

// why: v1 fires at the scheduled customer-local time without quiet-hours awareness — a 2h
// reminder for an 8am appointment fires at 6am. We accept this until a real customer
// complains. When that lands, add a per-tenant quiet-hours window in chunk 21+.
export function createReminderHandler(deps: ReminderWorkerDeps): ReminderHandler {
  return async function handleReminder(
    job: Job<ReminderJobData, void, ReminderJobName>,
  ): Promise<void> {
    const { appointmentId, tenantId } = job.data;
    const scoped = db.forTenant(tenantId);

    const appt = await scoped.appointment.findFirst({
      where: { id: appointmentId },
      include: { client: true, pet: true, service: true },
    });
    if (!appt) {
      deps.log.info(
        { appointmentId, jobName: job.name },
        'reminder worker: appointment not found at fire time — skipping',
      );
      return;
    }

    type ApptWithRelations = typeof appt & {
      client: { id: string; name: string; phone: string };
      pet: { name: string };
      service: { name: string };
    };
    const hydrated = appt as ApptWithRelations;

    if (
      hydrated.status === AppointmentStatus.canceled ||
      hydrated.status === AppointmentStatus.no_show
    ) {
      deps.log.info(
        { appointmentId, status: hydrated.status, jobName: job.name },
        'reminder worker: appointment canceled/no-show — skipping',
      );
      return;
    }

    const tenant = await db.global.tenant.findUnique({
      where: { id: tenantId },
      select: { businessName: true },
    });
    if (!tenant) {
      deps.log.info({ tenantId, jobName: job.name }, 'reminder worker: tenant missing — skipping');
      return;
    }

    const toE164 = toDialFormat(hydrated.client.phone);
    if (toE164.length === 0) {
      deps.log.info(
        { appointmentId, jobName: job.name },
        'reminder worker: client missing phone — skipping',
      );
      return;
    }

    const body = renderReminderBody(job.name, {
      firstName: firstName(hydrated.client.name) || hydrated.client.name,
      tenantName: tenant.businessName,
      petName: hydrated.pet.name,
      serviceName: hydrated.service.name,
      dateTimeFormatted: formatAppointmentDateTime(hydrated.scheduledStart),
    });

    const result = await deps.twilio.sendSms({
      toE164,
      body,
      idempotencyKey: `${job.name}:${appointmentId}`,
      tenantId,
      clientId: hydrated.client.id,
      appointmentId,
    });

    if (result.sent) {
      deps.log.info(
        { appointmentId, jobName: job.name, twilioSid: result.twilioSid },
        'reminder worker: SMS sent',
      );
    } else {
      // why: adapter returns sent:false for tier-gated, opted-out, duplicate, truncation
      // blocks, or wire error. All of those are recorded on SmsMessage; the worker reads the
      // result but doesn't throw — those are business outcomes, not infrastructure failures.
      deps.log.info(
        { appointmentId, jobName: job.name, reason: result.reason },
        'reminder worker: SMS skipped (see SmsMessage row)',
      );
    }
  };
}
