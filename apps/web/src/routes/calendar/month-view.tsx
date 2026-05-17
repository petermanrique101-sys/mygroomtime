import type { AppointmentOutput } from '@mygroomtime/shared';
import {
  addDays,
  isSameDay,
  isToday,
  startOfMonth,
  startOfMonthGrid,
} from './date-nav';

type Props = {
  anchor: Date;
  appointments: AppointmentOutput[];
  onPickDay: (d: Date) => void;
};

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function MonthView({ anchor, appointments, onPickDay }: Props): JSX.Element {
  const gridStart = startOfMonthGrid(anchor);
  const days = Array.from({ length: 42 }).map((_, i) => addDays(gridStart, i));
  const month = startOfMonth(anchor).getMonth();

  function dotsFor(d: Date): AppointmentOutput[] {
    return appointments.filter((a) => isSameDay(new Date(a.start), d)).slice(0, 6);
  }

  return (
    <div className="flex w-full flex-col">
      <div className="grid grid-cols-7 border-b border-gray-100 bg-white text-center text-[11px] font-semibold text-gray-500">
        {WEEKDAY_SHORT.map((w) => (
          <div key={w} className="py-2">
            {w}
          </div>
        ))}
      </div>
      <div className="grid flex-1 grid-cols-7">
        {days.map((d) => {
          const dots = dotsFor(d);
          const inMonth = d.getMonth() === month;
          return (
            <button
              key={d.toDateString()}
              type="button"
              onClick={() => onPickDay(d)}
              className={`flex min-h-[64px] flex-col items-center border-b border-r border-gray-100 px-1 py-1 text-left ${
                inMonth ? 'bg-white' : 'bg-gray-50 text-gray-400'
              }`}
              aria-label={`View ${d.toDateString()}`}
            >
              <span
                className={`mb-1 inline-flex h-6 w-6 items-center justify-center self-end rounded-full text-xs ${
                  isToday(d) ? 'bg-gray-900 text-white' : 'text-gray-700'
                }`}
              >
                {d.getDate()}
              </span>
              <div className="flex flex-wrap gap-0.5">
                {dots.map((a) => (
                  <span
                    key={a.id}
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: a.serviceColorSnapshot }}
                    aria-hidden="true"
                  />
                ))}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
