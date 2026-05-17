import type { CalendarView } from './date-nav';

type Props = {
  view: CalendarView;
  label: string;
  onPrev: () => void;
  onToday: () => void;
  onNext: () => void;
  onViewChange: (v: CalendarView) => void;
  onNew: () => void;
};

const VIEWS: CalendarView[] = ['day', 'week', 'month'];

export function CalendarHeader({
  view,
  label,
  onPrev,
  onToday,
  onNext,
  onViewChange,
  onNew,
}: Props): JSX.Element {
  return (
    <header className="sticky top-0 z-10 border-b border-gray-100 bg-white">
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <button
          type="button"
          onClick={onPrev}
          aria-label="Previous"
          className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-gray-200 text-gray-700"
        >
          ‹
        </button>
        <button
          type="button"
          onClick={onToday}
          className="inline-flex h-11 items-center justify-center rounded-lg border border-gray-200 px-3 text-sm font-medium text-gray-700"
        >
          Today
        </button>
        <button
          type="button"
          onClick={onNext}
          aria-label="Next"
          className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-gray-200 text-gray-700"
        >
          ›
        </button>
        <span
          className="flex-1 truncate px-1 text-center text-base font-semibold tracking-tight"
          aria-live="polite"
        >
          {label}
        </span>
        <button
          type="button"
          onClick={onNew}
          className="inline-flex h-11 items-center justify-center rounded-lg bg-gray-900 px-3 text-sm font-semibold text-white"
        >
          + New
        </button>
      </div>
      <div role="tablist" aria-label="Calendar view" className="flex gap-1 px-3 pb-2">
        {VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => onViewChange(v)}
            className={`min-h-[44px] flex-1 rounded-lg px-3 text-sm font-medium capitalize ${
              view === v ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'
            }`}
          >
            {v}
          </button>
        ))}
      </div>
    </header>
  );
}
