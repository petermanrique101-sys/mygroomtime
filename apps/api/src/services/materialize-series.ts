import {
  AppointmentStatus,
  db,
  type Appointment,
  type Client,
  type Pet,
  type RecurringSeries,
  type Service,
  type Vehicle,
} from '@mygroomtime/db';
import type { GmapsAdapter } from '../adapters/gmaps/index.js';
import { canPlaceAppointment } from './conflict.js';
import { resolveAppointmentCoords } from './address.js';
import { loadTenantDefaultBufferMin } from './buffers.js';
import { enqueueAppointmentReminders } from './reminder-schedule.js';
import { enqueueGcalPushIfLinked } from './gcal-enqueue.js';
import type { ReminderQueue } from '../queue/connection.js';
import type { GcalPushQueue } from '../queue/gcal-connection.js';

export type MaterializeOutcome =
  | { status: 'materialized'; appointmentId: string; seriesId: string }
  | { status: 'skipped_already_materialized'; appointmentId: string; seriesId: string }
  | { status: 'paused_source_deleted'; seriesId: string; reason: 'client' | 'pet' }
  | {
      status: 'skipped_no_slot_retry';
      seriesId: string;
      attemptCount: number;
      nextAttemptAt: Date;
    }
  | { status: 'paused_no_slot'; seriesId: string; finalAttempts: number };

export const MAX_CONSECUTIVE_FAILED_MATERIALIZATIONS = 7;

export type MaterializeDeps = {
  gmaps: GmapsAdapter;
  reminderQueue: ReminderQueue | null;
  gcalPushQueue: GcalPushQueue | null;
  log: { info: (o: object, msg: string) => void; warn: (o: object, msg: string) => void };
};

type SeriesRow = RecurringSeries & {
  client: Client;
  pet: Pet;
  service: Service;
};

type CompletedSnapshot = Pick<
  Appointment,
  | 'serviceNameSnapshot'
  | 'servicePriceCentsSnapshot'
  | 'serviceDepositCentsSnapshot'
  | 'serviceColorSnapshot'
  | 'serviceDurationMinSnapshot'
  | 'addressOverrideStreet'
  | 'addressOverrideCity'
  | 'addressOverrideState'
  | 'addressOverrideZip'
  | 'addressOverrideLat'
  | 'addressOverrideLng'
  | 'addressOverrideVerified'
>;

function snapshotFromService(s: Service): CompletedSnapshot {
  return {
    serviceNameSnapshot: s.name,
    servicePriceCentsSnapshot: s.basePriceCents,
    serviceDepositCentsSnapshot: s.depositCents,
    serviceColorSnapshot: s.color,
    serviceDurationMinSnapshot: s.durationMin,
    addressOverrideStreet: null,
    addressOverrideCity: null,
    addressOverrideState: null,
    addressOverrideZip: null,
    addressOverrideLat: null,
    addressOverrideLng: null,
    addressOverrideVerified: false,
  };
}

function snapshotFromCompleted(prev: Appointment): CompletedSnapshot {
  return {
    serviceNameSnapshot: prev.serviceNameSnapshot,
    servicePriceCentsSnapshot: prev.servicePriceCentsSnapshot,
    serviceDepositCentsSnapshot: prev.serviceDepositCentsSnapshot,
    serviceColorSnapshot: prev.serviceColorSnapshot,
    serviceDurationMinSnapshot: prev.serviceDurationMinSnapshot,
    addressOverrideStreet: prev.addressOverrideStreet,
    addressOverrideCity: prev.addressOverrideCity,
    addressOverrideState: prev.addressOverrideState,
    addressOverrideZip: prev.addressOverrideZip,
    addressOverrideLat: prev.addressOverrideLat,
    addressOverrideLng: prev.addressOverrideLng,
    addressOverrideVerified: prev.addressOverrideVerified,
  };
}

async function loadSeriesAndRelations(
  tenantId: string,
  seriesId: string,
): Promise<SeriesRow | null> {
  const scoped = db.forTenant(tenantId);
  // why: we deliberately don't filter client.deletedAt / pet.deletedAt here. The auto-pause
  // policy needs the row even if soft-deleted so we can record the pause reason; the active
  // read-paths filter elsewhere.
  const row = await scoped.recurringSeries.findFirst({
    where: { id: seriesId },
    include: { client: true, pet: true, service: true },
  });
  return (row as SeriesRow | null) ?? null;
}

async function loadLatestCompleted(
  tenantId: string,
  seriesId: string,
): Promise<Appointment | null> {
  const scoped = db.forTenant(tenantId);
  return (await scoped.appointment.findFirst({
    where: {
      recurringSeriesId: seriesId,
      status: AppointmentStatus.completed,
    },
    orderBy: { completedAt: 'desc' },
  })) as Appointment | null;
}

async function loadDefaultVehicle(tenantId: string): Promise<Vehicle | null> {
  const scoped = db.forTenant(tenantId);
  return (await scoped.vehicle.findFirst({ orderBy: { createdAt: 'asc' } })) as Vehicle | null;
}

async function loadAlreadyMaterialized(
  tenantId: string,
  seriesId: string,
  nextDueDate: Date,
): Promise<Appointment | null> {
  const scoped = db.forTenant(tenantId);
  return (await scoped.appointment.findFirst({
    where: { recurringSeriesId: seriesId, scheduledStart: nextDueDate },
  })) as Appointment | null;
}

function addWeeks(d: Date, w: number): Date {
  return new Date(d.getTime() + w * 7 * 24 * 60 * 60 * 1000);
}

function nextDayUtc(now: Date): Date {
  const t = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  t.setUTCHours(2, 0, 0, 0);
  return t;
}

export type MaterializeOneInput = {
  seriesId: string;
  tenantId: string;
  now?: Date;
  deps: MaterializeDeps;
};

export async function materializeOneSeries(
  input: MaterializeOneInput,
): Promise<MaterializeOutcome> {
  const now = input.now ?? new Date();
  const series = await loadSeriesAndRelations(input.tenantId, input.seriesId);
  if (!series) {
    // why: a series that's vanished between the walk and this call is a benign race —
    // treat as already-handled and let the caller continue iterating.
    return {
      status: 'skipped_already_materialized',
      appointmentId: '',
      seriesId: input.seriesId,
    };
  }
  if (!series.active) {
    return {
      status: 'skipped_already_materialized',
      appointmentId: '',
      seriesId: series.id,
    };
  }

  if (series.client.deletedAt) {
    await pauseSeries(input.tenantId, series.id, 'source_deleted', now);
    input.deps.log.info(
      { seriesId: series.id, reason: 'client_deleted' },
      'materialize: paused series — source client soft-deleted',
    );
    return { status: 'paused_source_deleted', seriesId: series.id, reason: 'client' };
  }
  if (series.pet.deletedAt) {
    await pauseSeries(input.tenantId, series.id, 'source_deleted', now);
    input.deps.log.info(
      { seriesId: series.id, reason: 'pet_deleted' },
      'materialize: paused series — source pet soft-deleted',
    );
    return { status: 'paused_source_deleted', seriesId: series.id, reason: 'pet' };
  }

  const existing = await loadAlreadyMaterialized(input.tenantId, series.id, series.nextDueDate);
  if (existing) {
    // why: idempotency. If a prior run already created the appointment for this
    // nextDueDate (or the owner did so manually), skip and let the post-completion
    // rebook step advance nextDueDate the next time it completes.
    return {
      status: 'skipped_already_materialized',
      appointmentId: existing.id,
      seriesId: series.id,
    };
  }

  const latestCompleted = await loadLatestCompleted(input.tenantId, series.id);
  const snapshot: CompletedSnapshot = latestCompleted
    ? snapshotFromCompleted(latestCompleted)
    : snapshotFromService(series.service);
  const durationMin = snapshot.serviceDurationMinSnapshot;

  const vehicle = await loadDefaultVehicle(input.tenantId);
  const scoped = db.forTenant(input.tenantId);
  const defaultBufferMin = await loadTenantDefaultBufferMin(input.tenantId);
  const proposedCoords =
    snapshot.addressOverrideLat !== null && snapshot.addressOverrideLng !== null
      ? { lat: snapshot.addressOverrideLat, lng: snapshot.addressOverrideLng }
      : resolveAppointmentCoords(
          {
            addressOverrideLat: snapshot.addressOverrideLat,
            addressOverrideLng: snapshot.addressOverrideLng,
          },
          series.client,
        );

  const conflict = await canPlaceAppointment({
    scoped,
    vehicleId: vehicle?.id ?? null,
    appointmentId: null,
    start: series.nextDueDate,
    durationMin,
    gmaps: input.deps.gmaps,
    defaultBufferMin,
    proposedCoords,
    now,
  });

  if (!conflict.ok) {
    return recordFailedAttempt(input.tenantId, series, conflict.reason, now, input.deps);
  }

  const appointment = await db.global.$transaction(async (tx): Promise<Appointment> => {
      const created = (await tx.appointment.create({
        data: {
          tenantId: input.tenantId,
          clientId: series.clientId,
          petId: series.petId,
          serviceId: series.serviceId,
          vehicleId: vehicle?.id ?? null,
          groomerId: latestCompleted?.groomerId ?? null,
          recurringSeriesId: series.id,
          status: AppointmentStatus.scheduled,
          scheduledStart: series.nextDueDate,
          durationMin,
          serviceNameSnapshot: snapshot.serviceNameSnapshot,
          servicePriceCentsSnapshot: snapshot.servicePriceCentsSnapshot,
          serviceDepositCentsSnapshot: snapshot.serviceDepositCentsSnapshot,
          serviceColorSnapshot: snapshot.serviceColorSnapshot,
          serviceDurationMinSnapshot: snapshot.serviceDurationMinSnapshot,
          addressOverrideStreet: snapshot.addressOverrideStreet,
          addressOverrideCity: snapshot.addressOverrideCity,
          addressOverrideState: snapshot.addressOverrideState,
          addressOverrideZip: snapshot.addressOverrideZip,
          addressOverrideLat: snapshot.addressOverrideLat,
          addressOverrideLng: snapshot.addressOverrideLng,
          addressOverrideVerified: snapshot.addressOverrideVerified,
        },
      })) as Appointment;

      await tx.recurringSeries.update({
        where: { id: series.id },
        data: {
          nextDueDate: addWeeks(series.nextDueDate, series.intervalWeeks),
          consecutiveFailedMaterializations: 0,
          nextMaterializationAttemptAt: null,
        },
      });

      return created;
    },
  );

  if (input.deps.reminderQueue) {
    const tenantRow = await db.global.tenant.findUnique({
      where: { id: input.tenantId },
      select: { smsRemindersEnabled: true },
    });
    if (tenantRow?.smsRemindersEnabled) {
      await enqueueAppointmentReminders(
        input.deps.reminderQueue,
        { id: appointment.id, scheduledStart: appointment.scheduledStart, durationMin },
        input.tenantId,
        true,
        now,
      );
    }
  }

  await enqueueGcalPushIfLinked({
    queue: input.deps.gcalPushQueue,
    tenantId: input.tenantId,
    appointmentId: appointment.id,
    kind: 'create',
  });

  input.deps.log.info(
    { seriesId: series.id, appointmentId: appointment.id, scheduledStart: appointment.scheduledStart.toISOString() },
    'materialize: created appointment from recurring series',
  );

  return { status: 'materialized', appointmentId: appointment.id, seriesId: series.id };
}

async function pauseSeries(
  tenantId: string,
  seriesId: string,
  pauseReason: 'source_deleted' | 'no_available_slot' | 'owner_paused',
  now: Date,
): Promise<void> {
  const scoped = db.forTenant(tenantId);
  await scoped.recurringSeries.update({
    where: { id: seriesId },
    data: {
      active: false,
      pausedAt: now,
      pauseReason,
      nextMaterializationAttemptAt: null,
    },
  });
}

async function recordFailedAttempt(
  tenantId: string,
  series: SeriesRow,
  conflictReason: string,
  now: Date,
  deps: MaterializeDeps,
): Promise<MaterializeOutcome> {
  const scoped = db.forTenant(tenantId);
  const newCount = series.consecutiveFailedMaterializations + 1;
  if (newCount >= MAX_CONSECUTIVE_FAILED_MATERIALIZATIONS) {
    await pauseSeries(tenantId, series.id, 'no_available_slot', now);
    deps.log.warn(
      { seriesId: series.id, failedAttempts: newCount, conflictReason },
      'materialize: paused series after consecutive slot failures',
    );
    return { status: 'paused_no_slot', seriesId: series.id, finalAttempts: newCount };
  }
  const nextAttempt = nextDayUtc(now);
  await scoped.recurringSeries.update({
    where: { id: series.id },
    data: {
      consecutiveFailedMaterializations: newCount,
      nextMaterializationAttemptAt: nextAttempt,
    },
  });
  deps.log.warn(
    {
      seriesId: series.id,
      failedAttempts: newCount,
      conflictReason,
      nextAttemptAt: nextAttempt.toISOString(),
    },
    'materialize: slot unavailable, will retry on next run',
  );
  return {
    status: 'skipped_no_slot_retry',
    seriesId: series.id,
    attemptCount: newCount,
    nextAttemptAt: nextAttempt,
  };
}

