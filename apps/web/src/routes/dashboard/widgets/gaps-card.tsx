import { Link } from 'react-router-dom';
import type { DashboardGapsSummary } from '@mygroomtime/shared';

type Props = { data: DashboardGapsSummary };

export function GapsCard({ data }: Props): JSX.Element {
  const unavailable = data.error === 'unavailable';
  const gated = data.gated;

  if (gated) {
    return (
      <div className="min-h-[120px] rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Gaps to fill
        </h3>
        <p className="mt-2 text-sm text-gray-700">Recurring rebooks unlock on Pro.</p>
        <Link
          to="/settings/billing"
          className="mt-3 inline-flex min-h-[44px] items-center rounded-lg bg-gray-900 px-4 text-sm font-semibold text-white"
        >
          Upgrade to Pro
        </Link>
      </div>
    );
  }

  const empty = !unavailable && data.rows.length === 0;

  return (
    <Link
      to="/dashboard/gaps-to-fill"
      className="block min-h-[120px] rounded-xl border border-gray-200 bg-white p-4 active:bg-gray-50"
    >
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Gaps to fill
        </h3>
        {unavailable ? (
          <span className="text-xs text-gray-400">unavailable</span>
        ) : (
          <span className="text-xs text-gray-400">→</span>
        )}
      </div>
      {empty ? (
        <div className="mt-3">
          <p className="text-sm text-gray-500">No overdue regulars.</p>
          <p className="mt-1 text-xs text-gray-400">Your recurring clients are on schedule.</p>
        </div>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {data.rows.slice(0, 4).map((row) => (
            <li key={row.seriesId} className="flex items-baseline justify-between gap-3">
              <span className="truncate text-sm text-gray-900">
                {row.petName} ({row.clientName})
              </span>
              <span className="shrink-0 text-xs font-semibold text-amber-700">
                {row.daysOverdue}d late
              </span>
            </li>
          ))}
        </ul>
      )}
    </Link>
  );
}
