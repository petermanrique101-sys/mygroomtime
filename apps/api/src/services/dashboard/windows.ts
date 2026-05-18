// why: shared window helpers for dashboard metrics. v1 uses the server's local TZ as the
// tenant TZ — per-tenant TZ lands in chunk 22. Keeping the math here so every metric uses
// the same boundary definitions and a future chunk only flips one file.
// TODO chunk 22: accept a tenant timezone and resolve boundaries in that zone.

export function startOfDay(now: Date): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function startOfWeek(now: Date): Date {
  const d = startOfDay(now);
  const dow = d.getDay();
  d.setDate(d.getDate() - dow);
  return d;
}

export function startOfMonth(now: Date): Date {
  const d = startOfDay(now);
  d.setDate(1);
  return d;
}

export function daysAgo(now: Date, days: number): Date {
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  return d;
}

export function startOfDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
