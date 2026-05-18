import type { Job } from 'bullmq';
import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import { db, AppointmentStatus, type Appointment } from '@mygroomtime/db';
import type { GcalAdapter, GcalEvent } from '../adapters/gcal/index.js';
import { getAccessToken } from '../services/gcal-token-cache.js';
import {
  resolveConflict,
  type ConflictAppointment,
} from '../services/gcal-conflict.js';
import type { ReminderQueue } from './connection.js';
import { rescheduleAppointmentReminders } from '../services/reminder-schedule.js';
import type { GcalPullHandler } from './gcal-connection.js';
import type { GcalPullJobData, GcalPullJobName } from './queue-names.js';

export type GcalPullDeps = {
  gcal: GcalAdapter;
  redis: Redis | null;
  encryptionKey: string;
  reminderQueue: ReminderQueue | null;
  log: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>;
};

const TERMINAL: ReadonlySet<string> = new Set([
  AppointmentStatus.canceled,
  AppointmentStatus.completed,
  AppointmentStatus.no_show,
]);

export function createGcalPullHandler(deps: GcalPullDeps): GcalPullHandler {
  return async function handle(
    job: Job<GcalPullJobData, void, GcalPullJobName>,
  ): Promise<void> {
    const link = await db.global.googleCalendarLink.findUnique({
      where: { id: job.data.linkId },
    });
    if (!link) {
      deps.log.info({ linkId: job.data.linkId }, 'gcal-pull: link missing — skipping');
      return;
    }

    const token = await getAccessToken(
      { redis: deps.redis, gcal: deps.gcal, encryptionKey: deps.encryptionKey },
      { userId: link.userId, encryptedRefreshToken: link.encryptedRefreshToken },
    );

    const list = await deps.gcal.listEvents({
      accessToken: token.accessToken,
      calendarId: link.googleCalendarId,
      syncToken: link.lastSyncToken ?? undefined,
    });

    if (list.fullResyncRequired) {
      deps.log.warn(
        { linkId: link.id },
        'gcal-pull: syncToken invalidated — clearing for full resync',
      );
      await db.global.googleCalendarLink.update({
        where: { id: link.id },
        data: { lastSyncToken: null, lastSyncedAt: new Date() },
      });
      return;
    }

    for (const ev of list.events) {
      await applyDelta(deps, link.tenantId, ev);
    }

    if (list.nextSyncToken) {
      await db.global.googleCalendarLink.update({
        where: { id: link.id },
        data: { lastSyncToken: list.nextSyncToken, lastSyncedAt: new Date() },
      });
    }
  };
}

async function applyDelta(deps: GcalPullDeps, tenantId: string, ev: GcalEvent): Promise<void> {
  const apptId = ev.extendedProperties.private.mgtAppointmentId;
  if (!apptId) {
    // why: per policy, external events without our tag are IGNORED in v1. No auto-create.
    return;
  }
  const scoped = db.forTenant(tenantId);
  const appt = (await scoped.appointment.findFirst({
    where: { id: apptId },
  })) as Appointment | null;
  if (!appt) {
    deps.log.info({ apptId }, 'gcal-pull: tagged event refers to unknown appointment');
    return;
  }

  const ours: ConflictAppointment = {
    id: appt.id,
    scheduledStart: appt.scheduledStart,
    durationMin: appt.durationMin,
    notes: appt.notes,
    status: appt.status,
    updatedAt: appt.updatedAt,
  };
  const decision = resolveConflict({ ours, theirs: ev });

  if (decision.kind === 'cancel_ours') {
    if (TERMINAL.has(appt.status)) return;
    await scoped.appointment.update({
      where: { id: appt.id },
      data: { status: AppointmentStatus.canceled, canceledAt: new Date() },
    });
    if (deps.reminderQueue) {
      await rescheduleAppointmentReminders(
        deps.reminderQueue,
        { id: appt.id, scheduledStart: appt.scheduledStart, durationMin: appt.durationMin },
        tenantId,
        false,
      );
    }
    deps.log.info({ appointmentId: appt.id }, 'gcal-pull: Google deletion → cancel');
    return;
  }

  if (decision.kind !== 'theirs_wins') return;

  const data: Record<string, unknown> = {};
  if (decision.patch.scheduledStart) data.scheduledStart = decision.patch.scheduledStart;
  if (decision.patch.durationMin) data.durationMin = decision.patch.durationMin;
  if (decision.patch.notes !== undefined) data.notes = decision.patch.notes;
  if (Object.keys(data).length === 0) return;

  await scoped.appointment.update({ where: { id: appt.id }, data });

  if (decision.patch.scheduledStart && deps.reminderQueue) {
    const tenantRow = await db.global.tenant.findUnique({
      where: { id: tenantId },
      select: { smsRemindersEnabled: true },
    });
    await rescheduleAppointmentReminders(
      deps.reminderQueue,
      {
        id: appt.id,
        scheduledStart: decision.patch.scheduledStart,
        durationMin: decision.patch.durationMin ?? appt.durationMin,
      },
      tenantId,
      tenantRow?.smsRemindersEnabled === true,
    );
  }

  deps.log.info(
    { appointmentId: appt.id, patch: Object.keys(data) },
    'gcal-pull: applied Google delta',
  );
}
