import { BookingRequestStatus, type Service, type TenantScopedDb } from '@mygroomtime/db';
import {
  PUBLIC_BOOKING_CLOSE_HOUR,
  PUBLIC_BOOKING_LEAD_TIME_MIN,
  PUBLIC_BOOKING_OPEN_HOUR,
  PUBLIC_BOOKING_SLOT_STEP_MIN,
  type PublicAvailabilitySlot,
} from '@mygroomtime/shared';
import type { GmapsAdapter } from '../adapters/gmaps/index.js';
import { canPlaceAppointment } from './conflict.js';
import type { LatLng } from './address.js';

export type AvailabilityInput = {
  scoped: TenantScopedDb;
  service: Pick<Service, 'id' | 'durationMin'>;
  date: Date;
  now: Date;
  vehicleId: string | null;
  proposedCoords: LatLng | null;
  gmaps: GmapsAdapter;
  defaultBufferMin: number;
};

export function isBusinessDay(d: Date): boolean {
  // why: hardcoded v1 hours per chunk 11 — Mon-Sat open, Sun closed. Tenant-configurable
  // hours land in chunk 22.
  return d.getDay() !== 0;
}

function candidateStartTimes(date: Date, durationMin: number): Date[] {
  const out: Date[] = [];
  if (!isBusinessDay(date)) return out;
  const open = new Date(date);
  open.setHours(PUBLIC_BOOKING_OPEN_HOUR, 0, 0, 0);
  const close = new Date(date);
  close.setHours(PUBLIC_BOOKING_CLOSE_HOUR, 0, 0, 0);
  const stepMs = PUBLIC_BOOKING_SLOT_STEP_MIN * 60_000;
  const durMs = durationMin * 60_000;
  for (let t = open.getTime(); t + durMs <= close.getTime(); t += stepMs) {
    out.push(new Date(t));
  }
  return out;
}

export async function computeAvailableSlots(
  input: AvailabilityInput,
): Promise<PublicAvailabilitySlot[]> {
  const candidates = candidateStartTimes(input.date, input.service.durationMin);
  if (candidates.length === 0) return [];

  const leadCutoff = new Date(input.now.getTime() + PUBLIC_BOOKING_LEAD_TIME_MIN * 60_000);

  // why: lazy sweep. Pending bookings past their 30-min TTL still hold their requested
  // slot until expired — flipping them here on every availability read keeps the slot
  // grid honest without needing a BullMQ worker until chunk 17+.
  await input.scoped.bookingPageRequest.updateMany({
    where: {
      status: BookingRequestStatus.pending_payment,
      expiresAt: { lte: input.now },
    },
    data: { status: BookingRequestStatus.expired },
  });

  const holds = await input.scoped.bookingPageRequest.findMany({
    where: {
      status: BookingRequestStatus.pending_payment,
      requestedStart: {
        gte: candidates[0]!,
        lte: candidates[candidates.length - 1]!,
      },
    },
    select: { requestedStart: true, durationMin: true },
  });

  function overlapsHold(slotStart: Date, slotDur: number): boolean {
    const slotEnd = slotStart.getTime() + slotDur * 60_000;
    for (const h of holds) {
      const hStart = h.requestedStart.getTime();
      const hEnd = hStart + h.durationMin * 60_000;
      if (hStart < slotEnd && hEnd > slotStart.getTime()) return true;
    }
    return false;
  }

  // why: reuse canPlaceAppointment from chunk 9 per candidate. It re-queries the day's
  // appts internally, but the cost is dominated by gmaps batching — and routing every
  // public availability check through the same conflict function keeps overlap + buffer
  // semantics in exactly one place.
  const out: PublicAvailabilitySlot[] = [];
  for (const start of candidates) {
    if (start.getTime() < leadCutoff.getTime()) continue;
    if (overlapsHold(start, input.service.durationMin)) continue;
    const result = await canPlaceAppointment({
      scoped: input.scoped,
      vehicleId: input.vehicleId,
      appointmentId: null,
      start,
      durationMin: input.service.durationMin,
      gmaps: input.gmaps,
      defaultBufferMin: input.defaultBufferMin,
      proposedCoords: input.proposedCoords,
      now: input.now,
    });
    if (result.ok) {
      out.push({ start: start.toISOString(), durationMin: input.service.durationMin });
    }
  }
  return out;
}
