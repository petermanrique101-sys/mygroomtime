import {
  db,
  AppointmentStatus,
  type Appointment,
  type Client,
  type Pet,
  type RecurringSeries,
} from '@mygroomtime/db';
import type { AppointmentConflictDetail, AppointmentConflictReason } from '@mygroomtime/shared';
import type { GmapsAdapter } from '../adapters/gmaps/index.js';
import { canPlaceAppointment } from './conflict.js';
import { resolveAppointmentCoords } from './address.js';
import { loadTenantDefaultBufferMin } from './buffers.js';

export type RebookInput = {
  tenantId: string;
  appointmentId: string;
  intervalWeeks: number;
  gmaps: GmapsAdapter;
};

type ApptWithRels = Appointment & { client: Client; pet: Pet };

export type RebookOutcome =
  | {
      ok: true;
      recurringSeries: RecurringSeries;
      nextAppointment: ApptWithRels;
      reusedSeries: boolean;
    }
  | { ok: false; reason: 'not_found' | 'not_completed'; message: string }
  | {
      ok: false;
      reason: 'conflict';
      message: string;
      conflict: { reason: AppointmentConflictReason; detail: AppointmentConflictDetail };
    };

const MIN_WEEKS = 1;
const MAX_WEEKS = 26;

function addWeeks(d: Date, weeks: number): Date {
  return new Date(d.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);
}

function clampWeeks(raw: number): number {
  if (!Number.isFinite(raw)) return MIN_WEEKS;
  const n = Math.round(raw);
  if (n < MIN_WEEKS) return MIN_WEEKS;
  if (n > MAX_WEEKS) return MAX_WEEKS;
  return n;
}

export async function rebookFromAppointment(input: RebookInput): Promise<RebookOutcome> {
  const intervalWeeks = clampWeeks(input.intervalWeeks);
  const scoped = db.forTenant(input.tenantId);

  const parent = (await scoped.appointment.findFirst({
    where: { id: input.appointmentId },
    include: { client: true, pet: true },
  })) as ApptWithRels | null;
  if (!parent) {
    return { ok: false, reason: 'not_found', message: 'Appointment not found.' };
  }
  if (parent.status !== AppointmentStatus.completed) {
    return {
      ok: false,
      reason: 'not_completed',
      message: 'Rebook is only available after marking an appointment complete.',
    };
  }

  // why: find-or-create RecurringSeries by (clientId, petId, serviceId, intervalWeeks).
  // Exact-interval match: a 4-week series and a 6-week series for the same pet/service
  // are distinct entities. Reusing would silently shift the customer's cadence.
  let series = (await scoped.recurringSeries.findFirst({
    where: {
      clientId: parent.clientId,
      petId: parent.petId,
      serviceId: parent.serviceId,
      intervalWeeks,
      active: true,
    },
  })) as RecurringSeries | null;
  const reusedSeries = series !== null;

  const newStart = addWeeks(parent.scheduledStart, intervalWeeks);
  const defaultBufferMin = await loadTenantDefaultBufferMin(input.tenantId);
  const proposedCoords = resolveAppointmentCoords(parent, parent.client);
  const conflictCheck = await canPlaceAppointment({
    scoped,
    vehicleId: parent.vehicleId,
    appointmentId: null,
    start: newStart,
    durationMin: parent.durationMin,
    gmaps: input.gmaps,
    defaultBufferMin,
    proposedCoords,
  });
  if (!conflictCheck.ok) {
    return {
      ok: false,
      reason: 'conflict',
      message: 'That time on the future date is already booked or buffered.',
      conflict: { reason: conflictCheck.reason, detail: conflictCheck.detail },
    };
  }

  if (!series) {
    series = (await scoped.recurringSeries.create({
      data: {
        clientId: parent.clientId,
        petId: parent.petId,
        serviceId: parent.serviceId,
        intervalWeeks,
        nextDueDate: newStart,
        active: true,
      },
    })) as RecurringSeries;
  }

  const created = (await scoped.appointment.create({
    data: {
      clientId: parent.clientId,
      petId: parent.petId,
      serviceId: parent.serviceId,
      vehicleId: parent.vehicleId,
      groomerId: parent.groomerId,
      recurringSeriesId: series.id,
      status: AppointmentStatus.scheduled,
      scheduledStart: newStart,
      durationMin: parent.durationMin,
      // why: copy snapshot fields from the parent appointment, NOT from the live Service
      // master. The customer experience stays consistent across the series even if the
      // owner reprices the service or changes color between rebook moments.
      serviceNameSnapshot: parent.serviceNameSnapshot,
      servicePriceCentsSnapshot: parent.servicePriceCentsSnapshot,
      serviceDepositCentsSnapshot: parent.serviceDepositCentsSnapshot,
      serviceColorSnapshot: parent.serviceColorSnapshot,
      serviceDurationMinSnapshot: parent.serviceDurationMinSnapshot,
      addressOverrideStreet: parent.addressOverrideStreet,
      addressOverrideCity: parent.addressOverrideCity,
      addressOverrideState: parent.addressOverrideState,
      addressOverrideZip: parent.addressOverrideZip,
      addressOverrideLat: parent.addressOverrideLat,
      addressOverrideLng: parent.addressOverrideLng,
      addressOverrideVerified: parent.addressOverrideVerified,
      notes: '',
    },
  })) as Appointment;

  await scoped.recurringSeries.update({
    where: { id: series.id },
    data: { nextDueDate: newStart },
  });

  const hydrated = (await scoped.appointment.findFirst({
    where: { id: created.id },
    include: { client: true, pet: true },
  })) as ApptWithRels;

  return {
    ok: true,
    recurringSeries: { ...series, nextDueDate: newStart },
    nextAppointment: hydrated,
    reusedSeries,
  };
}
