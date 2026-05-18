import type { DashboardDurationSummary } from '@mygroomtime/shared';

type Props = { data: DashboardDurationSummary };

export function DurationCard({ data }: Props): JSX.Element {
  const unavailable = data.error === 'unavailable';
  const empty = !unavailable && (data.avgMin === null || data.sampleSize === 0);

  return (
    <div className="min-h-[120px] rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Avg service time
        </h3>
        {unavailable && <span className="text-xs text-gray-400">unavailable</span>}
      </div>
      {empty ? (
        <div className="mt-3">
          <p className="text-sm text-gray-500">No completed groomings yet.</p>
          <p className="mt-1 text-xs text-gray-400">Tracks the last {data.windowDays} days.</p>
        </div>
      ) : (
        <div className="mt-2">
          <div className="text-3xl font-semibold tabular-nums text-gray-900">
            {data.avgMin} min
          </div>
          <p className="mt-1 text-xs text-gray-500">
            {data.sampleSize} groomings · last {data.windowDays} days
          </p>
        </div>
      )}
    </div>
  );
}
