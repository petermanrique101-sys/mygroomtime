import type { AppointmentBufferEntry, AppointmentOutput } from '@mygroomtime/shared';
import { isSameDay } from './date-nav';

export type BufferLookup = Map<string, { beforeBufferMin: number; afterBufferMin: number }>;

export function buildBufferLookup(entries: AppointmentBufferEntry[]): BufferLookup {
  const m: BufferLookup = new Map();
  for (const e of entries) {
    m.set(e.appointmentId, {
      beforeBufferMin: e.beforeBufferMin,
      afterBufferMin: e.afterBufferMin,
    });
  }
  return m;
}

export type ZoneKind = 'appointment' | 'buffer' | 'past';

export type DayZone = {
  startMs: number;
  endMs: number;
  kind: ZoneKind;
  neighborId?: string;
  neighborPetName?: string;
  neighborStartMs?: number;
};

export function computeNonDroppableZones(args: {
  day: Date;
  now: Date;
  appointments: AppointmentOutput[];
  buffers: BufferLookup;
  excludeId: string | null;
}): DayZone[] {
  const zones: DayZone[] = [];
  if (isSameDay(args.day, args.now)) {
    const dayStart = new Date(args.day);
    dayStart.setHours(0, 0, 0, 0);
    zones.push({
      startMs: dayStart.getTime(),
      endMs: args.now.getTime(),
      kind: 'past',
    });
  }
  for (const a of args.appointments) {
    if (!isSameDay(new Date(a.start), args.day)) continue;
    if (a.id === args.excludeId) continue;
    if (a.status === 'canceled' || a.canceledAt !== null) continue;
    const start = new Date(a.start).getTime();
    const end = start + a.durationMin * 60_000;
    zones.push({
      startMs: start,
      endMs: end,
      kind: 'appointment',
      neighborId: a.id,
      neighborPetName: a.pet.name,
      neighborStartMs: start,
    });
    const buf = args.buffers.get(a.id);
    if (buf) {
      if (buf.beforeBufferMin > 0) {
        zones.push({
          startMs: start - buf.beforeBufferMin * 60_000,
          endMs: start,
          kind: 'buffer',
          neighborId: a.id,
          neighborPetName: a.pet.name,
          neighborStartMs: start,
        });
      }
      if (buf.afterBufferMin > 0) {
        zones.push({
          startMs: end,
          endMs: end + buf.afterBufferMin * 60_000,
          kind: 'buffer',
          neighborId: a.id,
          neighborPetName: a.pet.name,
          neighborStartMs: start,
        });
      }
    }
  }
  return zones;
}

export type ConflictReason = 'overlap' | 'buffer' | 'past';

export type ConflictCheck =
  | { ok: true }
  | {
      ok: false;
      reason: ConflictReason;
      neighborPetName?: string;
      neighborStartMs?: number;
    };

export function findDropConflict(args: {
  proposedStartMs: number;
  durationMin: number;
  excludeId: string | null;
  zones: DayZone[];
  nowMs: number;
}): ConflictCheck {
  const endMs = args.proposedStartMs + args.durationMin * 60_000;
  if (args.proposedStartMs < args.nowMs) {
    return { ok: false, reason: 'past' };
  }
  for (const z of args.zones) {
    if (z.kind === 'past') continue;
    if (z.startMs < endMs && z.endMs > args.proposedStartMs) {
      const reason: ConflictReason = z.kind === 'appointment' ? 'overlap' : 'buffer';
      return {
        ok: false,
        reason,
        neighborPetName: z.neighborPetName,
        neighborStartMs: z.neighborStartMs,
      };
    }
  }
  return { ok: true };
}

export function conflictToastMessage(check: ConflictCheck): string | null {
  if (check.ok) return null;
  if (check.reason === 'past') {
    return "Can't move appointments into the past.";
  }
  const name = check.neighborPetName ?? 'another appointment';
  if (check.reason === 'overlap') {
    return `Can't move there — overlaps with ${name}'s appointment.`;
  }
  const time = check.neighborStartMs ? formatTimeShort(new Date(check.neighborStartMs)) : null;
  if (time) {
    return `Can't move there — drive time from ${name} at ${time} would conflict.`;
  }
  return `Can't move there — drive time from ${name} would conflict.`;
}

function formatTimeShort(d: Date): string {
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12;
  if (h === 0) h = 12;
  if (m === 0) return `${h}${ampm}`;
  return `${h}:${m.toString().padStart(2, '0')}${ampm}`;
}
