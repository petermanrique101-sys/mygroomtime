import { Link } from 'react-router-dom';

export function TodayRouteCard(): JSX.Element {
  return (
    <Link
      to="/calendar"
      className="block min-h-[80px] rounded-xl border border-gray-200 bg-white p-4 active:bg-gray-50"
    >
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Today&apos;s route
        </h3>
        <span className="text-xs text-gray-400">→</span>
      </div>
      <p className="mt-2 text-sm text-gray-900">Open the calendar for your stop order.</p>
    </Link>
  );
}
