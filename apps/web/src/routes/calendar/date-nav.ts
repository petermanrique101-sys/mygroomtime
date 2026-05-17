export type CalendarView = 'day' | 'week' | 'month';

export const DAY_START_HOUR = 7;
export const DAY_END_HOUR = 19;
export const SLOT_MINUTES = 15;
export const LABEL_MINUTES = 30;
export const PIXELS_PER_MINUTE = 1.2;
export const DAY_HEIGHT_PX = (DAY_END_HOUR - DAY_START_HOUR) * 60 * PIXELS_PER_MINUTE;

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
export function endOfDay(d: Date): Date {
  const x = startOfDay(d);
  x.setDate(x.getDate() + 1);
  return x;
}
export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
export function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  x.setDate(x.getDate() - x.getDay());
  return x;
}
export function endOfWeek(d: Date): Date {
  return addDays(startOfWeek(d), 7);
}
export function startOfMonth(d: Date): Date {
  const x = startOfDay(d);
  x.setDate(1);
  return x;
}
export function endOfMonth(d: Date): Date {
  const x = startOfMonth(d);
  x.setMonth(x.getMonth() + 1);
  return x;
}
export function startOfMonthGrid(d: Date): Date {
  return startOfWeek(startOfMonth(d));
}
export function endOfMonthGrid(d: Date): Date {
  // why: month grid renders 6 weeks max so it always fills cleanly.
  return addDays(startOfMonthGrid(d), 42);
}

export function rangeForView(view: CalendarView, anchor: Date): { from: Date; to: Date } {
  switch (view) {
    case 'day':
      return { from: startOfDay(anchor), to: endOfDay(anchor) };
    case 'week':
      return { from: startOfWeek(anchor), to: endOfWeek(anchor) };
    case 'month':
      return { from: startOfMonthGrid(anchor), to: endOfMonthGrid(anchor) };
  }
}

export function stepForView(view: CalendarView): (d: Date, dir: 1 | -1) => Date {
  switch (view) {
    case 'day':
      return (d, dir) => addDays(d, dir);
    case 'week':
      return (d, dir) => addDays(d, 7 * dir);
    case 'month':
      return (d, dir) => {
        const x = new Date(d);
        x.setMonth(x.getMonth() + dir);
        return x;
      };
  }
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function formatHeaderLabel(view: CalendarView, anchor: Date): string {
  if (view === 'month') return `${anchor.toLocaleString('en-US', { month: 'long' })} ${anchor.getFullYear()}`;
  if (view === 'week') {
    const start = startOfWeek(anchor);
    const end = addDays(start, 6);
    return `${MONTH_SHORT[start.getMonth()]} ${start.getDate()} – ${MONTH_SHORT[end.getMonth()]} ${end.getDate()}`;
  }
  return `${WEEKDAY_SHORT[anchor.getDay()]}, ${MONTH_SHORT[anchor.getMonth()]} ${anchor.getDate()}`;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function snapToSlot(d: Date): Date {
  const x = new Date(d);
  const m = x.getMinutes();
  const snapped = Math.round(m / SLOT_MINUTES) * SLOT_MINUTES;
  x.setMinutes(snapped, 0, 0);
  return x;
}

export function formatTimeLabel(d: Date): string {
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12;
  if (h === 0) h = 12;
  if (m === 0) return `${h}${ampm}`;
  return `${h}:${m.toString().padStart(2, '0')}${ampm}`;
}

export function minutesSinceDayStart(d: Date): number {
  return (d.getHours() - DAY_START_HOUR) * 60 + d.getMinutes();
}

export function dateAtSlot(day: Date, slotIndex: number): Date {
  const x = startOfDay(day);
  const totalMinutes = DAY_START_HOUR * 60 + slotIndex * SLOT_MINUTES;
  x.setHours(0, totalMinutes, 0, 0);
  return x;
}

export function totalSlotsPerDay(): number {
  return ((DAY_END_HOUR - DAY_START_HOUR) * 60) / SLOT_MINUTES;
}

export function isToday(d: Date): boolean {
  return isSameDay(d, new Date());
}

export function toIsoLocal(d: Date): string {
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

export function parseLocalDateTime(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const result = new Date(y, m - 1, d, hh, mm, 0, 0);
  if (Number.isNaN(result.getTime())) return null;
  return result;
}

export function nextNine(d: Date): Date {
  const x = startOfDay(d);
  x.setHours(9, 0, 0, 0);
  if (x.getTime() <= d.getTime()) {
    x.setDate(x.getDate() + 1);
  }
  return x;
}
