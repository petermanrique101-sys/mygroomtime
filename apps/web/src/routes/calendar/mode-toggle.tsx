import { Link } from 'react-router-dom';

export type CalendarMode = 'calendar' | 'route' | 'dispatch';

type Props = {
  mode: CalendarMode;
  onChange: (m: CalendarMode) => void;
  isBusiness: boolean;
};

// why: chunk-21 split out of CalendarRoute to keep index.tsx under the 400-LOC
// constitution. Renders the Calendar/Route/Dispatch tab strip + the navigation links.
export function ModeToggle({ mode, onChange, isBusiness }: Props): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
      <div className="flex gap-2" role="tablist" aria-label="Calendar mode">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'calendar'}
          onClick={() => onChange('calendar')}
          className={`min-h-[36px] rounded-lg px-3 text-sm font-medium ${
            mode === 'calendar' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'
          }`}
        >
          Calendar
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'route'}
          onClick={() => onChange('route')}
          className={`min-h-[36px] rounded-lg px-3 text-sm font-medium ${
            mode === 'route' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'
          }`}
        >
          Today&rsquo;s Route
        </button>
        {isBusiness ? (
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'dispatch'}
            onClick={() => onChange('dispatch')}
            data-testid="dispatch-tab"
            className={`min-h-[36px] rounded-lg px-3 text-sm font-medium ${
              mode === 'dispatch' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'
            }`}
          >
            Dispatch
          </button>
        ) : null}
      </div>
      <div className="flex gap-3">
        <Link to="/dashboard" className="text-gray-600 underline">
          Dashboard
        </Link>
        <Link to="/clients" className="text-gray-600 underline">
          Clients
        </Link>
        <Link to="/settings/services" className="text-gray-600 underline">
          Settings
        </Link>
      </div>
    </div>
  );
}
