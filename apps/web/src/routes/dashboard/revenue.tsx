import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { DashboardRevenueBucket, DashboardRevenuePeriod } from '@mygroomtime/shared';
import { fetchDashboardRevenue } from '../../lib/dashboard-api';
import { centsToDollars, formatDateShort } from './format';

const PERIODS: DashboardRevenuePeriod[] = ['day', 'week', 'month'];

export default function DashboardRevenueRoute(): JSX.Element {
  const [period, setPeriod] = useState<DashboardRevenuePeriod>('week');
  const query = useQuery({
    queryKey: ['dashboard-revenue', period],
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const res = await fetchDashboardRevenue(period);
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
  });

  const buckets = query.data?.buckets ?? [];
  const total = buckets.reduce((s, b) => s + b.revenueCents, 0);
  const totalAppts = buckets.reduce((s, b) => s + b.appointmentCount, 0);

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <div className="mx-auto flex min-h-screen max-w-md flex-col lg:max-w-3xl">
        <header className="sticky top-0 z-10 border-b border-gray-200 bg-white px-4 pb-3 pt-5">
          <div className="flex items-center justify-between">
            <Link to="/dashboard" className="min-h-[44px] text-sm text-gray-600 underline">
              ← Dashboard
            </Link>
            <h1 className="text-base font-semibold tracking-tight">Revenue</h1>
            <span className="w-20" />
          </div>
        </header>

        <section className="flex-1 px-4 py-4">
          <div className="mb-3 inline-flex rounded-lg border border-gray-200 bg-white p-1">
            {PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={`min-h-[36px] rounded-md px-3 text-sm font-medium ${
                  period === p ? 'bg-gray-900 text-white' : 'text-gray-700'
                }`}
              >
                {p === 'day' ? 'Today' : p === 'week' ? 'This week' : 'This month'}
              </button>
            ))}
          </div>

          <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-gray-500">Total</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums">
              {centsToDollars(total)}
            </p>
            <p className="mt-1 text-xs text-gray-500">{totalAppts} completed</p>
          </div>

          {query.isLoading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : buckets.length === 0 ? (
            <p className="text-sm text-gray-500">No revenue in this window.</p>
          ) : (
            <RevenueChart buckets={buckets} />
          )}

          <ul className="mt-4 divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
            {buckets.map((b) => (
              <li key={b.dateIso} className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-gray-700">{formatDateShort(b.dateIso)}</span>
                <div className="text-right">
                  <div className="text-sm font-semibold tabular-nums text-gray-900">
                    {centsToDollars(b.revenueCents)}
                  </div>
                  <div className="text-xs text-gray-500">{b.appointmentCount} appts</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}

function RevenueChart({ buckets }: { buckets: DashboardRevenueBucket[] }): JSX.Element {
  // why: hand-rolled SVG line chart keeps zero dependencies. Width grows with bucket
  // count; container scrolls on narrow viewports.
  const width = Math.max(320, buckets.length * 48);
  const height = 140;
  const padding = { top: 12, right: 16, bottom: 24, left: 36 };
  const max = Math.max(1, ...buckets.map((b) => b.revenueCents));
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const stepX = buckets.length > 1 ? innerW / (buckets.length - 1) : 0;

  const points = buckets.map((b, i) => {
    const x = padding.left + i * stepX;
    const y = padding.top + innerH - (b.revenueCents / max) * innerH;
    return { x, y, b };
  });
  const linePath = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ');
  const yMidCents = Math.round(max / 2);

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white p-2">
      <svg width={width} height={height} role="img" aria-label="Revenue line chart">
        <line
          x1={padding.left}
          x2={width - padding.right}
          y1={padding.top + innerH}
          y2={padding.top + innerH}
          stroke="#e5e7eb"
        />
        <line
          x1={padding.left}
          x2={width - padding.right}
          y1={padding.top + innerH / 2}
          y2={padding.top + innerH / 2}
          stroke="#f3f4f6"
        />
        <text x={4} y={padding.top + 4} fontSize="10" fill="#9ca3af">
          {centsToDollars(max)}
        </text>
        <text x={4} y={padding.top + innerH / 2 + 4} fontSize="10" fill="#9ca3af">
          {centsToDollars(yMidCents)}
        </text>
        {points.length > 1 && (
          <path d={linePath} fill="none" stroke="#111827" strokeWidth={2} />
        )}
        {points.map((p) => (
          <circle key={p.b.dateIso} cx={p.x} cy={p.y} r={3} fill="#111827" />
        ))}
      </svg>
    </div>
  );
}
