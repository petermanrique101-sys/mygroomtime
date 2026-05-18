import type { Job } from 'bullmq';
import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import {
  db,
  type Appointment,
  type Client,
  type GoogleCalendarLink,
  type Pet,
} from '@mygroomtime/db';
import type { GcalAdapter } from '../adapters/gcal/index.js';
import { getAccessToken } from '../services/gcal-token-cache.js';
import { buildEventInput, type PushAppointment } from '../services/gcal-payload.js';
import type { GcalPushHandler } from './gcal-connection.js';
import type {
  GcalPushJobData,
  GcalPushJobName,
  GcalPushLinkKind,
} from './queue-names.js';

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
    const { appointmentId, tenantId, previousGroomerId } = job.data;
    // why: chunk-20 jobs (and the gcal-e2e test helper that bypasses the enqueue layer)
    // do not set linkKind. Default to 'user' so they keep working — the dual-push split
    // is fully driven by the chunk-21 enqueue helper that DOES set the field.
    const linkKind = job.data.linkKind ?? 'user';
    const scoped = db.forTenant(tenantId);

    const appt = (await scoped.appointment.findFirst({
      where: { id: appointmentId },
      include: { client: true, pet: true },
    })) as ApptWithRelations | null;
    if (!appt) {
      deps.log.info(
        { appointmentId, jobName: job.name, linkKind },
        'gcal-push: appointment missing — skipping',
      );
      return;
    }

    if (linkKind === 'user') {
      await dispatchUserPush(deps, scoped, job, appt, previousGroomerId ?? null);
      return;
    }
    if (linkKind === 'tenant_operations') {
      await dispatchOpsPush(deps, scoped, job, appt);
      return;
    }
  };
}

async function dispatchUserPush(
  deps: GcalPushDeps,
  scoped: ReturnType<typeof db.forTenant>,
  job: Job<GcalPushJobData, void, GcalPushJobName>,
  appt: ApptWithRelations,
  previousGroomerId: string | null,
): Promise<void> {
  // why: cross-vehicle drag reassigns groomerId AND requires removing the old groomer's
  // event from their personal calendar. We do that delete first (best effort — missing
  // googleEventId means there was nothing to remove); then handle the destination side.
  if (
    previousGroomerId &&
    previousGroomerId !== appt.groomerId &&
    appt.googleEventId
  ) {
    const oldLink = await scoped.googleCalendarLink.findFirst({
      where: { userId: previousGroomerId, linkKind: 'user' },
    });
    if (oldLink && !oldLink.needsReauth) {
      try {
        const oldToken = await getAccessToken(
          { redis: deps.redis, gcal: deps.gcal, encryptionKey: deps.encryptionKey },
          { userId: previousGroomerId, encryptedRefreshToken: oldLink.encryptedRefreshToken },
        );
        await deps.gcal.deleteEvent({
          accessToken: oldToken.accessToken,
          calendarId: oldLink.googleCalendarId,
          eventId: appt.googleEventId,
        });
        // why: drop the now-stale id so a same-user retry doesn't try to update a
        // deleted event. The destination groomer's create below repopulates it.
        await scoped.appointment.update({
          where: { id: appt.id },
          data: { googleEventId: null },
        });
        appt.googleEventId = null;
      } catch (err) {
        deps.log.warn(
          { appointmentId: appt.id, previousGroomerId, err: (err as Error).message },
          'gcal-push: old groomer event delete failed — continuing with new groomer push',
        );
      }
    }
  }

  if (!appt.groomerId) {
    deps.log.info(
      { appointmentId: appt.id, jobName: job.name },
      'gcal-push: no groomer assigned — skipping user link',
    );
    return;
  }

  const link = await scoped.googleCalendarLink.findFirst({
    where: { userId: appt.groomerId, linkKind: 'user' },
  });
  if (!link || link.needsReauth) {
    deps.log.info(
      { appointmentId: appt.id, userId: appt.groomerId, jobName: job.name },
      'gcal-push: no active user link — skipping',
    );
    return;
  }

  await pushToLink(deps, scoped, job, appt, link, 'user');
}

async function dispatchOpsPush(
  deps: GcalPushDeps,
  scoped: ReturnType<typeof db.forTenant>,
  job: Job<GcalPushJobData, void, GcalPushJobName>,
  appt: ApptWithRelations,
): Promise<void> {
  const opsLink = await scoped.googleCalendarLink.findFirst({
    where: { linkKind: 'tenant_operations' },
  });
  if (!opsLink || opsLink.needsReauth) {
    deps.log.info(
      { appointmentId: appt.id, jobName: job.name },
      'gcal-push: no active tenant_operations link — skipping ops push',
    );
    return;
  }
  await pushToLink(deps, scoped, job, appt, opsLink, 'tenant_operations');
}

async function pushToLink(
  deps: GcalPushDeps,
  scoped: ReturnType<typeof db.forTenant>,
  job: Job<GcalPushJobData, void, GcalPushJobName>,
  appt: ApptWithRelations,
  link: GoogleCalendarLink,
  linkKind: GcalPushLinkKind,
): Promise<void> {
  // why: ops link's encryptedRefreshToken is encrypted with the tenant-wide key. The
  // helper exchanges it for an access token (cached in Redis) regardless of who the
  // "user" is — for tenant_operations links, userId can be null. We use the link.id as
  // the cache key prefix so user vs ops tokens don't collide.
  const tokenSubject = link.userId ?? `tenant-ops:${link.tenantId}`;
  const token = await getAccessToken(
    { redis: deps.redis, gcal: deps.gcal, encryptionKey: deps.encryptionKey },
    { userId: tokenSubject, encryptedRefreshToken: link.encryptedRefreshToken },
  );

  const eventIdField = linkKind === 'user' ? 'googleEventId' : 'opsGoogleEventId';
  const existingEventId =
    linkKind === 'user' ? appt.googleEventId : appt.opsGoogleEventId;

  if (job.name === 'gcal-push.delete') {
    if (!existingEventId) {
      deps.log.info(
        { appointmentId: appt.id, linkKind },
        'gcal-push.delete: no event id — skipping',
      );
      return;
    }
    await deps.gcal.deleteEvent({
      accessToken: token.accessToken,
      calendarId: link.googleCalendarId,
      eventId: existingEventId,
    });
    await scoped.appointment.update({
      where: { id: appt.id },
      data: { [eventIdField]: null },
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

  if (!existingEventId) {
    const inserted = await deps.gcal.insertEvent({
      accessToken: token.accessToken,
      calendarId: link.googleCalendarId,
      event: eventInput,
    });
    await scoped.appointment.update({
      where: { id: appt.id },
      data: { [eventIdField]: inserted.id },
    });
    deps.log.info(
      { appointmentId: appt.id, googleEventId: inserted.id, linkKind },
      'gcal-push: inserted event',
    );
    return;
  }

  await deps.gcal.updateEvent({
    accessToken: token.accessToken,
    calendarId: link.googleCalendarId,
    eventId: existingEventId,
    patch: eventInput,
  });
  deps.log.info(
    { appointmentId: appt.id, googleEventId: existingEventId, linkKind },
    'gcal-push: updated event',
  );
}
