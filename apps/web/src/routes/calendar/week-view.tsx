import type { AppointmentOutput } from '@mygroomtime/shared';
import { TimeAxis } from './time-axis';
import { DayGrid } from './day-grid';
import { addDays, isToday, startOfWeek } from './date-nav';

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type Props = {
  anchor: Date;
  appointments: AppointmentOutput[];
  onTapSlot: (slotStart: Date) => void;
  onTapAppointment: (a: AppointmentOutput) => void;
};

export function WeekView({ anchor, appointments, onTapSlot, onTapAppointment }: Props): JSX.Element {
  const start = startOfWeek(anchor);
  const days = Array.from({ length: 7 }).map((_, i) => addDays(start, i));
  return (
    <div className="flex w-full overflow-x-auto">
      <TimeAxis />
      <div className="flex flex-1 snap-x snap-mandatory">
        {days.map((d) => (
          <div
            key={d.toDateString()}
            className="relative flex w-[min(100%,140px)] shrink-0 snap-start flex-col border-r border-gray-100 last:border-r-0 md:w-auto md:flex-1"
          >
            <div
              className={`sticky top-0 z-[1] flex h-9 items-center justify-center border-b border-gray-100 bg-white text-[11px] font-semibold ${
                isToday(d) ? 'text-gray-900' : 'text-gray-500'
              }`}
            >
              <span>
                {WEEKDAY_SHORT[d.getDay()]}{' '}
                <span
                  className={`ml-1 inline-block min-w-[1.5rem] rounded-full px-1 text-center ${
                    isToday(d) ? 'bg-gray-900 text-white' : 'text-gray-700'
                  }`}
                >
                  {d.getDate()}
                </span>
              </span>
            </div>
            <DayGrid
              day={d}
              appointments={appointments}
              onTapSlot={onTapSlot}
              onTapAppointment={onTapAppointment}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
