import { useCallback, useMemo } from 'react';
import type { AppointmentOutput } from '@mygroomtime/shared';
import {
  DAY_END_HOUR,
  DAY_START_HOUR,
  LABEL_MINUTES,
  PIXELS_PER_MINUTE,
  SLOT_MINUTES,
  dateAtSlot,
  isSameDay,
  minutesSinceDayStart,
  totalSlotsPerDay,
} from './date-nav';
import { AppointmentBlock } from './appointment-block';
import { BufferBand } from './buffer-band';
import { useAppointmentDrag, type DragSource } from './use-appointment-drag';
import {
  type BufferLookup,
  type ConflictCheck,
} from './drag-zones';

type Props = {
  day: Date;
  appointments: AppointmentOutput[];
  buffers?: BufferLookup;
  now?: Date;
  onTapSlot: (slotStart: Date) => void;
  onTapAppointment: (a: AppointmentOutput) => void;
  onMoveAttempt?: (id: string, proposedStart: Date, check: ConflictCheck) => void;
  validateProposal?: (id: string, proposedStart: Date) => ConflictCheck;
  onAnnounce?: (msg: string) => void;
};

const EMPTY_BUFFERS: BufferLookup = new Map();

export function DayGrid({
  day,
  appointments,
  buffers,
  now,
  onTapSlot,
  onTapAppointment,
  onMoveAttempt,
  validateProposal,
  onAnnounce,
}: Props): JSX.Element {
  const dragEnabled = onMoveAttempt !== undefined && validateProposal !== undefined;
  const effectiveBuffers = buffers ?? EMPTY_BUFFERS;
  const effectiveNow = now ?? new Date();
  const slots = totalSlotsPerDay();
  const totalMinutes = (DAY_END_HOUR - DAY_START_HOUR) * 60;
  const labelStride = LABEL_MINUTES / SLOT_MINUTES;
  const dayAppts = appointments.filter((a) => isSameDay(new Date(a.start), day));

  const getSource = useCallback(
    (id: string): DragSource | null => {
      const a = dayAppts.find((x) => x.id === id);
      if (!a) return null;
      return { id: a.id, start: new Date(a.start), durationMin: a.durationMin };
    },
    [dayAppts],
  );

  const commit = useCallback(
    (id: string, proposedStart: Date): void => {
      if (!dragEnabled) return;
      const check = validateProposal!(id, proposedStart);
      onMoveAttempt!(id, proposedStart, check);
    },
    [dragEnabled, onMoveAttempt, validateProposal],
  );

  const { gridRef, dragState, blockHandlers } = useAppointmentDrag({
    day,
    getSource,
    onCommit: commit,
    onAnnounce,
  });

  const draggingId =
    dragEnabled && dragState.phase === 'active' ? dragState.sourceId : null;
  const ghost =
    dragEnabled && dragState.phase === 'active'
      ? {
          id: dragState.sourceId,
          start: dragState.proposedStart,
          source: getSource(dragState.sourceId),
          check: validateProposal!(dragState.sourceId, dragState.proposedStart),
        }
      : null;

  const pastBandPx = useMemo(() => {
    if (!isSameDay(day, effectiveNow)) return 0;
    const minutesElapsed = Math.max(0, minutesSinceDayStart(effectiveNow));
    return Math.min(totalMinutes, minutesElapsed) * PIXELS_PER_MINUTE;
  }, [day, effectiveNow, totalMinutes]);

  return (
    <div
      ref={gridRef}
      data-testid="day-grid"
      className="relative flex-1 bg-white"
      style={{ height: totalMinutes * PIXELS_PER_MINUTE }}
    >
      {pastBandPx > 0 ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 bg-gray-100/80"
          style={{ height: pastBandPx }}
          data-testid="past-band"
        />
      ) : null}
      {Array.from({ length: slots }).map((_, i) => {
        const top = i * SLOT_MINUTES * PIXELS_PER_MINUTE;
        const isLabelRow = i % labelStride === 0;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onTapSlot(dateAtSlot(day, i))}
            aria-label={`Create at ${dateAtSlot(day, i).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}
            className={`absolute left-0 right-0 w-full ${
              isLabelRow ? 'border-t border-gray-200' : 'border-t border-dashed border-gray-100'
            }`}
            style={{ top, height: SLOT_MINUTES * PIXELS_PER_MINUTE }}
          />
        );
      })}

      {dayAppts.map((a) => {
        if (a.id === draggingId) return null;
        const buf = effectiveBuffers.get(a.id);
        if (!buf) return null;
        const start = new Date(a.start);
        const topPx = minutesSinceDayStart(start) * PIXELS_PER_MINUTE;
        const heightPx = a.durationMin * PIXELS_PER_MINUTE;
        const beforePx = buf.beforeBufferMin * PIXELS_PER_MINUTE;
        const afterPx = buf.afterBufferMin * PIXELS_PER_MINUTE;
        return (
          <div key={`buf-${a.id}`}>
            <BufferBand
              color={a.serviceColorSnapshot}
              topPx={Math.max(0, topPx - beforePx)}
              heightPx={Math.min(beforePx, topPx)}
              position="before"
              petName={a.pet.name}
            />
            <BufferBand
              color={a.serviceColorSnapshot}
              topPx={topPx + heightPx}
              heightPx={afterPx}
              position="after"
              petName={a.pet.name}
            />
          </div>
        );
      })}

      {dayAppts.map((a) => (
        <AppointmentBlock
          key={a.id}
          appointment={a}
          onTap={onTapAppointment}
          dragHandlers={
            dragEnabled
              ? blockHandlers({
                  id: a.id,
                  start: new Date(a.start),
                  durationMin: a.durationMin,
                })
              : undefined
          }
          isDragging={a.id === draggingId}
        />
      ))}

      {ghost && ghost.source ? (
        <DragGhost
          start={ghost.start}
          durationMin={ghost.source.durationMin}
          color={dayAppts.find((x) => x.id === ghost.id)?.serviceColorSnapshot ?? '#2563eb'}
          label={dayAppts.find((x) => x.id === ghost.id)?.pet.name ?? ''}
          valid={ghost.check.ok}
        />
      ) : null}
    </div>
  );
}

function DragGhost(props: {
  start: Date;
  durationMin: number;
  color: string;
  label: string;
  valid: boolean;
}): JSX.Element {
  const topPx = minutesSinceDayStart(props.start) * PIXELS_PER_MINUTE;
  const heightPx = Math.max(28, props.durationMin * PIXELS_PER_MINUTE - 2);
  return (
    <div
      data-testid="drag-ghost"
      aria-live="polite"
      className={`pointer-events-none absolute left-1 right-1 z-20 overflow-hidden rounded-md border-2 px-2 py-1 text-[11px] font-semibold text-white shadow-md ${
        props.valid ? 'border-blue-500' : 'border-red-600 bg-red-100/40'
      }`}
      style={{
        top: topPx,
        height: heightPx,
        backgroundColor: props.valid ? props.color : undefined,
      }}
    >
      {props.label} → {formatTime(props.start)}
    </div>
  );
}

function formatTime(d: Date): string {
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12;
  if (h === 0) h = 12;
  if (m === 0) return `${h}${ampm}`;
  return `${h}:${m.toString().padStart(2, '0')}${ampm}`;
}

