import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchDashboardNoShows } from '../../lib/dashboard-api';
import { formatDateShort } from './format';

const PAGE_SIZE = 25;

export default function DashboardNoShowsRoute(): JSX.Element {
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['dashboard-no-shows', page],
    staleTime: 60_000,
    queryFn: async () => {
      const res = await fetchDashboardNoShows(page, PAGE_SIZE);
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
            <h1 className="text-base font-semibold tracking-tight">No-shows</h1>
            <span className="w-20" />
          </div>
          <p className="mt-1 text-center text-xs text-gray-500">
            Last 30 days · {total} total
          </p>
        </header>

        <section className="flex-1 px-4 py-4">
          {query.isLoading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : rows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 bg-white p-6 text-center">
              <p className="text-sm font-medium text-gray-900">No no-shows in the last 30 days.</p>
              <p className="mt-1 text-xs text-gray-500">Keep that up.</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
              {rows.map((row) => (
                <li key={row.appointmentId} className="px-4 py-3">
                  <Link
                    to={`/clients/${row.clientId}`}
                    className="block min-h-[44px]"
                  >
                    <div className="flex items-baseline justify-between">
                      <span className="text-sm font-semibold text-gray-900">
                        {row.petName} ({row.clientName})
                      </span>
                      <span className="text-xs text-gray-500">
                        {row.noShowAt ? formatDateShort(row.noShowAt) : '—'}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {row.serviceName} · scheduled {formatDateShort(row.scheduledStart)}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {pageCount > 1 && (
            <Pagination
              page={page}
              pageCount={pageCount}
              onChange={setPage}
            />
          )}
        </section>
      </div>
    </main>
  );
}

function Pagination({
  page,
  pageCount,
  onChange,
}: {
  page: number;
  pageCount: number;
  onChange: (next: number) => void;
}): JSX.Element {
  return (
    <div className="mt-4 flex items-center justify-between">
      <button
        type="button"
        onClick={() => onChange(Math.max(1, page - 1))}
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
        onClick={() => onChange(Math.min(pageCount, page + 1))}
        disabled={page >= pageCount}
        className="min-h-[44px] rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-900 disabled:opacity-40"
      >
        Next →
      </button>
    </div>
  );
}
