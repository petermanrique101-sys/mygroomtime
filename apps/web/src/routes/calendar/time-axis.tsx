import {
  DAY_END_HOUR,
  DAY_START_HOUR,
  LABEL_MINUTES,
  PIXELS_PER_MINUTE,
} from './date-nav';

export function TimeAxis(): JSX.Element {
  const rows: { label: string; topPx: number }[] = [];
  const totalMinutes = (DAY_END_HOUR - DAY_START_HOUR) * 60;
  for (let m = 0; m < totalMinutes; m += LABEL_MINUTES) {
    const totalHourMinutes = DAY_START_HOUR * 60 + m;
    const hour24 = Math.floor(totalHourMinutes / 60);
    const minute = totalHourMinutes % 60;
    const ampm = hour24 >= 12 ? 'pm' : 'am';
    const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
    const label =
      minute === 0 ? `${hour12}${ampm}` : `${hour12}:${minute.toString().padStart(2, '0')}`;
    rows.push({ label, topPx: m * PIXELS_PER_MINUTE });
  }
  return (
    <div
      className="relative w-12 shrink-0 border-r border-gray-100 bg-white"
      aria-hidden="true"
      style={{ height: totalMinutes * PIXELS_PER_MINUTE }}
    >
      {rows.map((r) => (
        <div
          key={r.topPx}
          className="absolute right-1 -translate-y-1/2 text-[10px] leading-none text-gray-400"
          style={{ top: r.topPx }}
        >
          {r.label}
        </div>
      ))}
    </div>
  );
}
