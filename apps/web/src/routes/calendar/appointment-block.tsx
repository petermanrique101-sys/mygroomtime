import type { AppointmentOutput } from '@mygroomtime/shared';
import { PIXELS_PER_MINUTE, minutesSinceDayStart } from './date-nav';

type DragHandlers = {
  onPointerDown?: (e: React.PointerEvent<HTMLElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLElement>) => void;
  'aria-grabbed'?: boolean;
  'aria-roledescription'?: string;
  tabIndex?: number;
};

type Props = {
  appointment: AppointmentOutput;
  onTap: (a: AppointmentOutput) => void;
  dragHandlers?: DragHandlers;
  isDragging?: boolean;
};

export function AppointmentBlock({ appointment, onTap, dragHandlers, isDragging }: Props): JSX.Element {
  const start = new Date(appointment.start);
  const topPx = minutesSinceDayStart(start) * PIXELS_PER_MINUTE;
  const heightPx = Math.max(28, appointment.durationMin * PIXELS_PER_MINUTE - 2);
  const isCanceled = appointment.status === 'canceled' || appointment.canceledAt !== null;

  return (
    <button
      type="button"
      onClick={(e) => {
        if (isDragging) {
          e.preventDefault();
          return;
        }
        onTap(appointment);
      }}
      onPointerDown={dragHandlers?.onPointerDown}
      onKeyDown={dragHandlers?.onKeyDown}
      aria-grabbed={dragHandlers?.['aria-grabbed']}
      aria-roledescription={dragHandlers?.['aria-roledescription']}
      tabIndex={dragHandlers?.tabIndex}
      className={`absolute left-1 right-1 min-h-[44px] touch-none select-none overflow-hidden rounded-md border border-white/40 px-2 py-1 text-left text-[11px] leading-tight text-white shadow-sm ${
        isCanceled ? 'opacity-40 line-through' : ''
      } ${isDragging ? 'opacity-30 ring-2 ring-blue-400' : ''}`}
      style={{
        top: topPx,
        height: heightPx,
        backgroundColor: appointment.serviceColorSnapshot,
      }}
      aria-label={`${appointment.pet.name} — ${appointment.serviceNameSnapshot}`}
    >
      <div className="truncate font-semibold">{appointment.pet.name}</div>
      <div className="truncate opacity-90">{appointment.serviceNameSnapshot}</div>
    </button>
  );
}
