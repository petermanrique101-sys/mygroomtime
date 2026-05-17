import type { AppointmentConflictDetail, AppointmentConflictReason } from '@mygroomtime/shared';

function formatTime(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12;
  if (h === 0) h = 12;
  if (m === 0) return `${h}${ampm}`;
  return `${h}:${m.toString().padStart(2, '0')}${ampm}`;
}

export function conflictMessage(
  reason: AppointmentConflictReason,
  detail: AppointmentConflictDetail,
): string {
  if (reason === 'past') {
    return "Can't move appointments into the past.";
  }
  const name = detail.neighborPetName ?? 'another appointment';
  if (reason === 'overlap') {
    return `Can't move there — overlaps with ${name}'s appointment.`;
  }
  const time = formatTime(detail.neighborStart);
  if (time) {
    return `Can't move there — drive time from ${name} at ${time} would conflict.`;
  }
  return `Can't move there — drive time from ${name} would conflict.`;
}
