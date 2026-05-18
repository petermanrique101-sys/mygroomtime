import { Link } from 'react-router-dom';
import type { DashboardNoShowSummary } from '@mygroomtime/shared';
import { formatRate } from '../format';

type Props = { data: DashboardNoShowSummary };

export function NoShowCard({ data }: Props): JSX.Element {
  const unavailable = data.error === 'unavailable';
  const empty = !unavailable && data.sampleSize === 0;

  return (
    <Link
      to="/dashboard/no-shows"
      className="block min-h-[120px] rounded-xl border border-gray-200 bg-white p-4 active:bg-gray-50"
    >
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          No-show rate
        </h3>
        {unavailable ? (
          <span className="text-xs text-gray-400">unavailable</span>
        ) : (
          <span className="text-xs text-gray-400">→</span>
        )}
      </div>
      {empty ? (
        <div className="mt-3">
          <p className="text-sm text-gray-500">Not enough data yet.</p>
          <p className="mt-1 text-xs text-gray-400">Tracks the last {data.windowDays} days.</p>
        </div>
      ) : (
        <div className="mt-2">
          <div className="text-3xl font-semibold tabular-nums text-gray-900">
            {formatRate(data.rate)}
          </div>
          <p className="mt-1 text-xs text-gray-500">
            {data.sampleSize} resolved appts · last {data.windowDays} days
          </p>
        </div>
      )}
    </Link>
  );
}
