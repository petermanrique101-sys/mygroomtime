import type { AppointmentOutput } from '@mygroomtime/shared';
import { TimeAxis } from './time-axis';
import { DayGrid } from './day-grid';
import { isSameDay, nextNine, startOfDay } from './date-nav';
import type { BufferLookup, ConflictCheck } from './drag-zones';

type Props = {
  day: Date;
  appointments: AppointmentOutput[];
  buffers: BufferLookup;
  now: Date;
  onTapSlot: (slotStart: Date) => void;
  onTapAppointment: (a: AppointmentOutput) => void;
  onMoveAttempt: (id: string, proposedStart: Date, check: ConflictCheck) => void;
  validateProposal: (id: string, proposedStart: Date) => ConflictCheck;
  onAnnounce?: (msg: string) => void;
};

export function DayView(props: Props): JSX.Element {
  const todayAppts = props.appointments.filter((a) =>
    isSameDay(new Date(a.start), props.day),
  );
  return (
    <div className="flex w-full">
      <TimeAxis />
      <div className="relative flex-1">
        <DayGrid
          day={props.day}
          appointments={props.appointments}
          buffers={props.buffers}
          now={props.now}
          onTapSlot={props.onTapSlot}
          onTapAppointment={props.onTapAppointment}
          onMoveAttempt={props.onMoveAttempt}
          validateProposal={props.validateProposal}
          onAnnounce={props.onAnnounce}
        />
        {todayAppts.length === 0 ? (
          <EmptyDayPrompt day={props.day} onTapSlot={props.onTapSlot} />
        ) : null}
      </div>
    </div>
  );
}

function EmptyDayPrompt({ day, onTapSlot }: { day: Date; onTapSlot: (d: Date) => void }): JSX.Element {
  const target = isSameDay(day, new Date()) ? nextNine(new Date()) : (() => {
    const x = startOfDay(day);
    x.setHours(9, 0, 0, 0);
    return x;
  })();
  return (
    <div className="pointer-events-none absolute inset-x-2 top-3 z-10 flex flex-col items-center gap-2">
      <div className="pointer-events-auto rounded-lg bg-gray-900/90 px-3 py-2 text-center text-xs font-medium text-white shadow">
        Tap a time to add your first appointment ↓
      </div>
      <button
        type="button"
        onClick={() => onTapSlot(target)}
        className="pointer-events-auto inline-flex min-h-[44px] items-center rounded-lg border border-gray-300 bg-white px-3 text-xs font-medium text-gray-800"
      >
        Jump to 9:00 am
      </button>
    </div>
  );
}
