type DatePickerProps = {
  selected: string | null;
  onSelect: (iso: string) => void;
  daysAhead?: number;
};

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function startOfTodayLocal(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function shortDay(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: 'short' });
}

function shortMonthDay(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function DatePicker({ selected, onSelect, daysAhead = 30 }: DatePickerProps): JSX.Element {
  const today = startOfTodayLocal();
  const days: Date[] = [];
  for (let i = 0; i < daysAhead; i += 1) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    days.push(d);
  }
  return (
    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2" role="listbox" aria-label="Pick a date">
      {days.map((d) => {
        const iso = isoDate(d);
        const isSun = d.getDay() === 0;
        const isSelected = iso === selected;
        return (
          <button
            key={iso}
            type="button"
            role="option"
            aria-selected={isSelected}
            disabled={isSun}
            onClick={() => onSelect(iso)}
            className={
              'flex min-h-[60px] min-w-[64px] shrink-0 flex-col items-center justify-center rounded-lg border px-2 py-2 text-center ' +
              (isSelected
                ? 'border-gray-900 bg-gray-900 text-white'
                : isSun
                  ? 'cursor-not-allowed border-gray-100 bg-gray-50 text-gray-300'
                  : 'border-gray-200 bg-white text-gray-900')
            }
          >
            <span className="text-[10px] font-medium uppercase tracking-wide opacity-70">
              {shortDay(d)}
            </span>
            <span className="mt-0.5 text-sm font-semibold">{shortMonthDay(d)}</span>
          </button>
        );
      })}
    </div>
  );
}
