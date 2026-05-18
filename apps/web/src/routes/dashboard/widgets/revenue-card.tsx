import { Link } from 'react-router-dom';
import type { DashboardRevenueSummary } from '@mygroomtime/shared';
import { centsToDollarsCompact } from '../format';

type Props = { data: DashboardRevenueSummary };

export function RevenueCard({ data }: Props): JSX.Element {
  const unavailable = data.error === 'unavailable';
  const empty = !unavailable && data.dayCents === 0 && data.weekCents === 0 && data.monthCents === 0;

  return (
    <Link
      to="/dashboard/revenue"
      className="block min-h-[120px] rounded-xl border border-gray-200 bg-white p-4 active:bg-gray-50"
    >
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Revenue</h3>
        {unavailable ? (
          <span className="text-xs text-gray-400">unavailable</span>
        ) : (
          <span className="text-xs text-gray-400">→</span>
        )}
      </div>
      {empty ? (
        <div className="mt-3">
          <p className="text-sm text-gray-500">No completed appointments yet.</p>
          <p className="mt-1 text-xs text-gray-400">Numbers appear after your first cut.</p>
        </div>
      ) : (
        <div className="mt-2 grid grid-cols-3 gap-3">
          <Metric label="Today" cents={data.dayCents} />
          <Metric label="This week" cents={data.weekCents} />
          <Metric label="This month" cents={data.monthCents} />
        </div>
      )}
    </Link>
  );
}

function Metric({ label, cents }: { label: string; cents: number }): JSX.Element {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums text-gray-900">
        {centsToDollarsCompact(cents)}
      </div>
    </div>
  );
}
