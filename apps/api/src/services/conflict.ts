import type { Appointment, Client, Pet, TenantScopedDb } from '@mygroomtime/db';
import { AppointmentStatus } from '@mygroomtime/db';
import type { AppointmentConflictDetail, AppointmentConflictReason } from '@mygroomtime/shared';
import type { GmapsAdapter } from '../adapters/gmaps/index.js';
import { coordsKey, resolveAppointmentCoords, type LatLng } from './address.js';

const BLOCKING_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.scheduled,
  AppointmentStatus.on_the_way,
  AppointmentStatus.started,
  AppointmentStatus.completed,
];

type ConflictAppt = Appointment & { client: Client; pet: Pet };

export type ConflictInput = {
  scoped: TenantScopedDb;
  vehicleId: string | null;
  appointmentId: string | null;
  start: Date;
  durationMin: number;
  gmaps: GmapsAdapter;
  defaultBufferMin: number;
  proposedCoords?: LatLng | null;
  now?: Date;
};

export type ConflictResult =
  | { ok: true }
  | { ok: false; reason: AppointmentConflictReason; detail: AppointmentConflictDetail };

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

async function loadDayAppts(
  scoped: TenantScopedDb,
  vehicleId: string,
  date: Date,
  excludeId: string | null,
): Promise<ConflictAppt[]> {
  const rows = (await scoped.appointment.findMany({
    where: {
      vehicleId,
      status: { in: BLOCKING_STATUSES },
      scheduledStart: { gte: startOfDay(date), lte: endOfDay(date) },
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
    },
    include: { client: true, pet: true },
    orderBy: { scheduledStart: 'asc' },
  })) as ConflictAppt[];
  return rows;
}

function detectOverlap(
  others: ConflictAppt[],
  startMs: number,
  endMs: number,
): ConflictAppt | null {
  for (const a of others) {
    const aStart = a.scheduledStart.getTime();
    const aEnd = aStart + a.durationMin * 60_000;
    if (aStart < endMs && aEnd > startMs) return a;
  }
  return null;
}

function findNeighbors(
  others: ConflictAppt[],
  startMs: number,
): { before: ConflictAppt | null; after: ConflictAppt | null } {
  let before: ConflictAppt | null = null;
  let after: ConflictAppt | null = null;
  for (const a of others) {
    const aStart = a.scheduledStart.getTime();
    if (aStart < startMs) {
      if (!before || aStart > before.scheduledStart.getTime()) before = a;
    } else {
      if (!after || aStart < after.scheduledStart.getTime()) after = a;
    }
  }
  return { before, after };
}

async function driveMinutes(
  gmaps: GmapsAdapter,
  from: LatLng,
  to: LatLng,
  fallback: number,
): Promise<number> {
  try {
    const res = await gmaps.distanceMatrix({
      origins: [coordsKey(from)],
      destinations: [coordsKey(to)],
    });
    const cell = res.rows[0]?.[0];
    if (!cell || cell.status !== 'OK') return fallback;
    return Math.max(1, Math.round(cell.durationSec / 60));
  } catch {
    return fallback;
  }
}

function detail(
  a: ConflictAppt | null,
  bufferMin: number | null,
): AppointmentConflictDetail {
  return {
    neighborAppointmentId: a?.id ?? null,
    neighborPetName: a?.pet.name ?? null,
    neighborStart: a ? a.scheduledStart.toISOString() : null,
    bufferMin,
  };
}

export async function canPlaceAppointment(input: ConflictInput): Promise<ConflictResult> {
  const now = input.now ?? new Date();
  const startMs = input.start.getTime();
  const endMs = startMs + input.durationMin * 60_000;

  if (startMs < now.getTime()) {
    return { ok: false, reason: 'past', detail: detail(null, null) };
  }

  if (!input.vehicleId) {
    return { ok: true };
  }

  const others = await loadDayAppts(
    input.scoped,
    input.vehicleId,
    input.start,
    input.appointmentId,
  );

  const overlap = detectOverlap(others, startMs, endMs);
  if (overlap) {
    return { ok: false, reason: 'overlap', detail: detail(overlap, null) };
  }

  const { before, after } = findNeighbors(others, startMs);
  const proposedCoords = input.proposedCoords ?? null;

  if (before) {
    const beforeEndMs = before.scheduledStart.getTime() + before.durationMin * 60_000;
    const gap = startMs - beforeEndMs;
    const beforeCoords = resolveAppointmentCoords(before, before.client);
    const required =
      beforeCoords && proposedCoords
        ? await driveMinutes(input.gmaps, beforeCoords, proposedCoords, input.defaultBufferMin)
        : input.defaultBufferMin;
    if (gap < required * 60_000) {
      return { ok: false, reason: 'buffer', detail: detail(before, required) };
    }
  }

  if (after) {
    const gap = after.scheduledStart.getTime() - endMs;
    const afterCoords = resolveAppointmentCoords(after, after.client);
    const required =
      afterCoords && proposedCoords
        ? await driveMinutes(input.gmaps, proposedCoords, afterCoords, input.defaultBufferMin)
        : input.defaultBufferMin;
    if (gap < required * 60_000) {
      return { ok: false, reason: 'buffer', detail: detail(after, required) };
    }
  }

  return { ok: true };
}
