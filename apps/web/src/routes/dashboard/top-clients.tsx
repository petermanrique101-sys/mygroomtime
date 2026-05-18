import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchDashboardTopClients } from '../../lib/dashboard-api';
import { centsToDollars } from './format';

const PAGE_SIZE = 25;

export default function DashboardTopClientsRoute(): JSX.Element {
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['dashboard-top-clients', page],
    staleTime: 60_000,
    queryFn: async () => {
      const res = await fetchDashboardTopClients(page, PAGE_SIZE);
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
  });

  const rows = query.data?.rows ?? [];
  const total = query.data?.pagination.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <div className="mx-auto flex min-h-screen max-w-md flex-col lg:max-w-3xl">
        <header className="sticky top-0 z-10 border-b border-gray-200 bg-white px-4 pb-3 pt-5">
          <div className="flex items-center justify-between">
            <Link to="/dashboard" className="min-h-[44px] text-sm text-gray-600 underline">
              ← Dashboard
            </Link>
            <h1 className="text-base font-semibold tracking-tight">Top clients</h1>
            <span className="w-20" />
          </div>
          <p className="mt-1 text-center text-xs text-gray-500">
            Last 90 days · {total} clients with revenue
          </p>
        </header>

        <section className="flex-1 px-4 py-4">
          {query.isLoading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : rows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 bg-white p-6 text-center">
              <p className="text-sm font-medium text-gray-900">No revenue tracked yet.</p>
              <p className="mt-1 text-xs text-gray-500">Complete an appointment to see your top clients.</p>
            </div>
          ) : (
            <ol className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
              {rows.map((row, idx) => (
                <li key={row.clientId}>
                  <Link
                    to={`/clients/${row.clientId}`}
                    className="flex min-h-[56px] items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="flex items-baseline gap-3">
                      <span className="w-6 text-sm font-semibold text-gray-400">
                        {(page - 1) * PAGE_SIZE + idx + 1}
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-gray-900">
                          {row.name}
                          {row.isDeleted && (
                            <span className="ml-1 text-xs font-normal text-gray-400">
                              (removed)
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-gray-500">
                          {row.appointmentCount} appts
                        </p>
                      </div>
                    </div>
                    <span className="text-sm font-semibold tabular-nums text-gray-900">
                      {centsToDollars(row.totalCents)}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}

          {pageCount > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page <= 1}
                className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-900 disabled:opacity-40"
              >
                ← Prev
              </button>
              <span className="text-xs text-gray-500">
                Page {page} of {pageCount}
              </span>
              <button
                type="button"
                onClick={() => setPage(Math.min(pageCount, page + 1))}
                disabled={page >= pageCount}
                className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-900 disabled:opacity-40"
              >
                Next →
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
