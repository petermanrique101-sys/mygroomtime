import type { Job } from 'bullmq';
import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import { db, type Appointment, type Client, type Pet } from '@mygroomtime/db';
import type { GcalAdapter } from '../adapters/gcal/index.js';
import { getAccessToken } from '../services/gcal-token-cache.js';
import { buildEventInput, type PushAppointment } from '../services/gcal-payload.js';
import type { GcalPushHandler } from './gcal-connection.js';
import type { GcalPushJobData, GcalPushJobName } from './queue-names.js';

type ApptWithRelations = Appointment & { client: Client; pet: Pet };

export type GcalPushDeps = {
  gcal: GcalAdapter;
  redis: Redis | null;
  encryptionKey: string;
  log: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>;
};

export function createGcalPushHandler(deps: GcalPushDeps): GcalPushHandler {
  return async function handle(
    job: Job<GcalPushJobData, void, GcalPushJobName>,
  ): Promise<void> {
    const { appointmentId, tenantId } = job.data;
    const scoped = db.forTenant(tenantId);

    const appt = (await scoped.appointment.findFirst({
      where: { id: appointmentId },
      include: { client: true, pet: true },
    })) as ApptWithRelations | null;
    if (!appt) {
      deps.log.info(
        { appointmentId, jobName: job.name },
        'gcal-push: appointment missing — skipping',
      );
      return;
    }
    if (!appt.groomerId) {
      deps.log.info(
        { appointmentId, jobName: job.name },
        'gcal-push: no groomer assigned — skipping',
      );
      return;
    }

    const link = await scoped.googleCalendarLink.findFirst({
      where: { userId: appt.groomerId },
    });
    if (!link || link.needsReauth) {
      deps.log.info(
        { appointmentId, userId: appt.groomerId, jobName: job.name },
        'gcal-push: no active link — skipping',
      );
      return;
    }

    const token = await getAccessToken(
      { redis: deps.redis, gcal: deps.gcal, encryptionKey: deps.encryptionKey },
      { userId: appt.groomerId, encryptedRefreshToken: link.encryptedRefreshToken },
    );

    if (job.name === 'gcal-push.delete') {
      if (!appt.googleEventId) {
        deps.log.info({ appointmentId }, 'gcal-push.delete: no googleEventId — skipping');
        return;
      }
      await deps.gcal.deleteEvent({
        accessToken: token.accessToken,
        calendarId: link.googleCalendarId,
        eventId: appt.googleEventId,
      });
      return;
    }

    const pushAppt: PushAppointment = {
      id: appt.id,
      tenantId: appt.tenantId,
      scheduledStart: appt.scheduledStart,
      durationMin: appt.durationMin,
      serviceNameSnapshot: appt.serviceNameSnapshot,
      notes: appt.notes,
      status: appt.status,
      pet: { name: appt.pet.name },
      client: {
        name: appt.client.name,
        addressStreet: appt.client.addressStreet,
        addressCity: appt.client.addressCity,
        addressState: appt.client.addressState,
        addressZip: appt.client.addressZip,
      },
      addressOverrideStreet: appt.addressOverrideStreet,
      addressOverrideCity: appt.addressOverrideCity,
      addressOverrideState: appt.addressOverrideState,
      addressOverrideZip: appt.addressOverrideZip,
    };
    const eventInput = buildEventInput(pushAppt);

    if (!appt.googleEventId) {
      const inserted = await deps.gcal.insertEvent({
        accessToken: token.accessToken,
        calendarId: link.googleCalendarId,
        event: eventInput,
      });
      await scoped.appointment.update({
        where: { id: appt.id },
        data: { googleEventId: inserted.id },
      });
      deps.log.info(
        { appointmentId, googleEventId: inserted.id },
        'gcal-push: inserted event',
      );
      return;
    }

    await deps.gcal.updateEvent({
      accessToken: token.accessToken,
      calendarId: link.googleCalendarId,
      eventId: appt.googleEventId,
      patch: eventInput,
    });
    deps.log.info(
      { appointmentId, googleEventId: appt.googleEventId },
      'gcal-push: updated event',
    );
  };
}
