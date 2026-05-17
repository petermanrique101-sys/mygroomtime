import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DAY_START_HOUR,
  PIXELS_PER_MINUTE,
  SLOT_MINUTES,
  minutesSinceDayStart,
  startOfDay,
} from './date-nav';

export type DragSource = {
  id: string;
  start: Date;
  durationMin: number;
};

export type DragState =
  | { phase: 'idle' }
  | {
      phase: 'pending';
      sourceId: string;
    }
  | {
      phase: 'active';
      sourceId: string;
      originStart: Date;
      proposedStart: Date;
      via: 'pointer' | 'keyboard';
    };

export type DragCallbacks = {
  day: Date;
  getSource: (id: string) => DragSource | null;
  onCommit: (id: string, proposedStart: Date) => void;
  onAnnounce?: (msg: string) => void;
};

const LONG_PRESS_MS = 300;
const POINTER_MOVE_CANCEL_PX = 8;

type PointerStart = {
  pointerId: number;
  pointerType: string;
  clientY: number;
  clientX: number;
  initialOffsetMin: number;
  sourceId: string;
};

export function useAppointmentDrag(opts: DragCallbacks): {
  gridRef: React.RefObject<HTMLDivElement>;
  dragState: DragState;
  blockHandlers: (source: DragSource) => {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
    'aria-grabbed': boolean;
    'aria-roledescription': string;
    tabIndex: number;
  };
} {
  const gridRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<DragState>({ phase: 'idle' });
  const pointerStartRef = useRef<PointerStart | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const clearLongPress = useCallback((): void => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const snap = useCallback((d: Date): Date => {
    const x = new Date(d);
    const min = x.getMinutes();
    const snapped = Math.round(min / SLOT_MINUTES) * SLOT_MINUTES;
    x.setMinutes(snapped, 0, 0);
    return x;
  }, []);

  const yToStart = useCallback(
    (clientY: number, durationMin: number, offsetMin: number): Date => {
      const grid = gridRef.current;
      if (!grid) {
        const fallback = startOfDay(optsRef.current.day);
        fallback.setHours(DAY_START_HOUR, 0, 0, 0);
        return fallback;
      }
      const rect = grid.getBoundingClientRect();
      const yPx = clientY - rect.top;
      const minutesIntoDay = Math.max(0, yPx / PIXELS_PER_MINUTE);
      const proposedTop = startOfDay(optsRef.current.day);
      proposedTop.setHours(0, DAY_START_HOUR * 60 + minutesIntoDay - offsetMin, 0, 0);
      const snapped = snap(proposedTop);
      // why: keep the appointment from being dragged off the visible day grid; the
      // 0..dayMinutes-duration clamp matches what the server's past-check would also catch.
      const dayStart = startOfDay(optsRef.current.day);
      dayStart.setHours(DAY_START_HOUR, 0, 0, 0);
      if (snapped < dayStart) return dayStart;
      return snapped;
    },
    [snap],
  );

  const finishActive = useCallback(
    (commit: boolean): void => {
      setState((s) => {
        if (s.phase !== 'active') return s;
        if (commit) {
          const { sourceId, proposedStart } = s;
          // why: defer onCommit out of the setState updater so the host's setState
          // calls don't fire during this component's render pass.
          queueMicrotask(() => optsRef.current.onCommit(sourceId, proposedStart));
        }
        return { phase: 'idle' };
      });
    },
    [],
  );

  const announce = useCallback((msg: string): void => {
    optsRef.current.onAnnounce?.(msg);
  }, []);

  const handlePointerMove = useCallback(
    (e: PointerEvent): void => {
      const ps = pointerStartRef.current;
      if (!ps) return;
      if (e.pointerId !== ps.pointerId) return;

      if (state.phase === 'pending') {
        const dx = Math.abs(e.clientX - ps.clientX);
        const dy = Math.abs(e.clientY - ps.clientY);
        if (dx > POINTER_MOVE_CANCEL_PX || dy > POINTER_MOVE_CANCEL_PX) {
          clearLongPress();
          pointerStartRef.current = null;
          setState({ phase: 'idle' });
        }
        return;
      }
      if (state.phase !== 'active') return;
      const src = optsRef.current.getSource(ps.sourceId);
      if (!src) return;
      const proposed = yToStart(e.clientY, src.durationMin, ps.initialOffsetMin);
      setState((s) => (s.phase === 'active' ? { ...s, proposedStart: proposed } : s));
    },
    [clearLongPress, state.phase, yToStart],
  );

  const handlePointerUp = useCallback(
    (e: PointerEvent): void => {
      const ps = pointerStartRef.current;
      if (!ps || e.pointerId !== ps.pointerId) return;
      clearLongPress();
      pointerStartRef.current = null;
      if (state.phase === 'active') {
        finishActive(true);
      } else {
        setState({ phase: 'idle' });
      }
    },
    [clearLongPress, finishActive, state.phase],
  );

  const handlePointerCancel = useCallback(
    (e: PointerEvent): void => {
      const ps = pointerStartRef.current;
      if (!ps || e.pointerId !== ps.pointerId) return;
      clearLongPress();
      pointerStartRef.current = null;
      setState({ phase: 'idle' });
    },
    [clearLongPress],
  );

  useEffect(() => {
    if (state.phase === 'idle') return;
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    return (): void => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
    };
  }, [state.phase, handlePointerMove, handlePointerUp, handlePointerCancel]);

  const onPointerDown = useCallback(
    (source: DragSource, e: React.PointerEvent<HTMLElement>): void => {
      if (e.button !== undefined && e.button !== 0) return;
      const grid = gridRef.current;
      if (!grid) return;
      const rect = grid.getBoundingClientRect();
      const yPx = e.clientY - rect.top;
      const minutesIntoDay = yPx / PIXELS_PER_MINUTE;
      const sourceMinutes = minutesSinceDayStart(source.start);
      const offset = Math.max(0, minutesIntoDay - sourceMinutes);
      pointerStartRef.current = {
        pointerId: e.pointerId,
        pointerType: e.pointerType,
        clientY: e.clientY,
        clientX: e.clientX,
        initialOffsetMin: offset,
        sourceId: source.id,
      };

      const beginActive = (): void => {
        setState({
          phase: 'active',
          sourceId: source.id,
          originStart: source.start,
          proposedStart: source.start,
          via: 'pointer',
        });
        announce(`Picked up ${source.id}. Drag to move.`);
      };

      if (e.pointerType === 'touch') {
        setState({ phase: 'pending', sourceId: source.id });
        longPressTimerRef.current = window.setTimeout(beginActive, LONG_PRESS_MS);
      } else {
        beginActive();
      }
    },
    [announce],
  );

  const onKeyDown = useCallback(
    (source: DragSource, e: React.KeyboardEvent<HTMLElement>): void => {
      const isActive = state.phase === 'active' && state.sourceId === source.id;
      if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        if (isActive) {
          finishActive(true);
        } else {
          setState({
            phase: 'active',
            sourceId: source.id,
            originStart: source.start,
            proposedStart: source.start,
            via: 'keyboard',
          });
          announce(`Picked up appointment. Use arrow keys to move, Enter to drop, Escape to cancel.`);
        }
        return;
      }
      if (!isActive) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        finishActive(true);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        finishActive(false);
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const dir = e.key === 'ArrowUp' ? -1 : 1;
        setState((s) => {
          if (s.phase !== 'active') return s;
          const next = new Date(s.proposedStart.getTime() + dir * SLOT_MINUTES * 60_000);
          return { ...s, proposedStart: next };
        });
      }
    },
    [announce, finishActive, state],
  );

  useEffect(() => (): void => clearLongPress(), [clearLongPress]);

  const blockHandlers = (source: DragSource): {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
    'aria-grabbed': boolean;
    'aria-roledescription': string;
    tabIndex: number;
  } => ({
    onPointerDown: (e) => onPointerDown(source, e),
    onKeyDown: (e) => onKeyDown(source, e),
    'aria-grabbed': state.phase === 'active' && state.sourceId === source.id,
    'aria-roledescription': 'draggable appointment',
    tabIndex: 0,
  });

  return { gridRef, dragState: state, blockHandlers };
}
