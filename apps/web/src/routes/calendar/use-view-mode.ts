import { useEffect, useState } from 'react';
import type { CalendarView } from './date-nav';

const STORAGE_KEY = 'mgt.calendar.view';

function readStored(): CalendarView | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'day' || v === 'week' || v === 'month') return v;
  } catch {
    /* localStorage may be unavailable in private modes — fall through to default */
  }
  return null;
}

function defaultForViewport(): CalendarView {
  if (typeof window === 'undefined') return 'day';
  return window.matchMedia('(min-width: 768px)').matches ? 'week' : 'day';
}

export function useViewMode(): {
  view: CalendarView;
  setView: (v: CalendarView) => void;
} {
  const [view, setViewState] = useState<CalendarView>(() => readStored() ?? defaultForViewport());

  function setView(v: CalendarView): void {
    setViewState(v);
    try {
      localStorage.setItem(STORAGE_KEY, v);
    } catch {
      /* swallow — see readStored */
    }
  }

  useEffect(() => {
    if (readStored() !== null) return;
    const mql = window.matchMedia('(min-width: 768px)');
    function onChange(): void {
      if (readStored() === null) {
        setViewState(mql.matches ? 'week' : 'day');
      }
    }
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return { view, setView };
}
