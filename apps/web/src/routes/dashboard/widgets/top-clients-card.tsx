import { Link } from 'react-router-dom';
import type { DashboardTopClientsSummary } from '@mygroomtime/shared';
import { centsToDollarsCompact } from '../format';

type Props = { data: DashboardTopClientsSummary };

export function TopClientsCard({ data }: Props): JSX.Element {
  const unavailable = data.error === 'unavailable';
  const empty = !unavailable && data.rows.length === 0;

  return (
    <Link
      to="/dashboard/top-clients"
      className="block min-h-[120px] rounded-xl border border-gray-200 bg-white p-4 active:bg-gray-50"
    >
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Top clients
        </h3>
        {unavailable ? (
          <span className="text-xs text-gray-400">unavailable</span>
        ) : (
          <span className="text-xs text-gray-400">→</span>
        )}
      </div>
      {empty ? (
        <div className="mt-3">
          <p className="text-sm text-gray-500">No revenue tracked yet.</p>
          <p className="mt-1 text-xs text-gray-400">Last {data.windowDays} days.</p>
        </div>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {data.rows.slice(0, 5).map((row) => (
            <li key={row.clientId} className="flex items-baseline justify-between gap-3">
              <span className="truncate text-sm text-gray-900">
                {row.name}
                {row.isDeleted && (
                  <span className="ml-1 text-xs text-gray-400">(removed)</span>
                )}
              </span>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-gray-900">
                {centsToDollarsCompact(row.totalCents)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Link>
  );
}
