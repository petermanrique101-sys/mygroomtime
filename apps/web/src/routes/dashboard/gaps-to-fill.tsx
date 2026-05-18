import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchDashboardGaps } from '../../lib/dashboard-api';
import { formatDateShort } from './format';

export default function DashboardGapsToFillRoute(): JSX.Element {
  const query = useQuery({
    queryKey: ['dashboard-gaps'],
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const res = await fetchDashboardGaps();
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
  });

  const data = query.data;
  const rows = data?.rows ?? [];

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <div className="mx-auto flex min-h-screen max-w-md flex-col lg:max-w-3xl">
        <header className="sticky top-0 z-10 border-b border-gray-200 bg-white px-4 pb-3 pt-5">
          <div className="flex items-center justify-between">
            <Link to="/dashboard" className="min-h-[44px] text-sm text-gray-600 underline">
              ← Dashboard
            </Link>
            <h1 className="text-base font-semibold tracking-tight">Gaps to fill</h1>
            <span className="w-20" />
          </div>
        </header>

        <section className="flex-1 px-4 py-4">
          {query.isLoading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : data?.gated ? (
            <div className="rounded-xl border border-dashed border-gray-300 bg-white p-6 text-center">
              <p className="text-sm font-medium text-gray-900">
                Gaps to fill is a Pro feature.
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Track regulars who are overdue for their next groom.
              </p>
              <Link
                to="/settings/billing"
                className="mt-4 inline-flex min-h-[44px] items-center rounded-lg bg-gray-900 px-4 text-sm font-semibold text-white"
              >
                Upgrade to Pro
              </Link>
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 bg-white p-6 text-center">
              <p className="text-sm font-medium text-gray-900">No overdue regulars.</p>
              <p className="mt-1 text-xs text-gray-500">Your recurring clients are on schedule.</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
              {rows.map((row) => (
                <li key={row.seriesId}>
                  <Link
                    to={`/clients/${row.clientId}`}
                    className="block min-h-[44px] px-4 py-3"
                  >
                    <div className="flex items-baseline justify-between">
                      <span className="text-sm font-semibold text-gray-900">
                        {row.petName} ({row.clientName})
                      </span>
                      <span className="shrink-0 text-xs font-semibold text-amber-700">
                        {row.daysOverdue}d overdue
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500">
                      Last groomed{' '}
                      {row.lastGroomedAt ? formatDateShort(row.lastGroomedAt) : '—'} ·
                      normally every {row.intervalWeeks} weeks
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
