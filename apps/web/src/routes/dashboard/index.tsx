import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchDashboardSummary } from '../../lib/dashboard-api';
import { useAuthOptional } from '../../lib/auth-context';
import { RevenueCard } from './widgets/revenue-card';
import { NoShowCard } from './widgets/no-show-card';
import { DurationCard } from './widgets/duration-card';
import { TopClientsCard } from './widgets/top-clients-card';
import { GapsCard } from './widgets/gaps-card';
import { TodayRouteCard } from './widgets/today-route-card';

const DASHBOARD_KEY = ['dashboard-summary'] as const;

export default function DashboardRoute(): JSX.Element {
  const auth = useAuthOptional();
  const businessName = auth?.session?.tenant.businessName ?? '';
  const query = useQuery({
    queryKey: DASHBOARD_KEY,
    // why: 60s stale + refresh-on-focus per chunk spec. The server also sets
    // Cache-Control: private, max-age=30, but the client-side stale window is the real
    // gate on duplicate fetches.
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const res = await fetchDashboardSummary();
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
  });

  const summary = query.data;
  const wholeDashboardEmpty =
    !!summary &&
    summary.revenue.dayCents === 0 &&
    summary.revenue.weekCents === 0 &&
    summary.revenue.monthCents === 0 &&
    summary.noShow.sampleSize === 0 &&
    summary.duration.sampleSize === 0 &&
    summary.topClients.rows.length === 0 &&
    (summary.gaps.gated || summary.gaps.rows.length === 0);

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <div className="mx-auto flex min-h-screen max-w-md flex-col lg:max-w-5xl">
        <header className="sticky top-0 z-10 border-b border-gray-200 bg-white px-4 pb-3 pt-5">
          <div className="flex items-center justify-between">
            <Link to="/calendar" className="min-h-[44px] text-sm text-gray-600 underline">
              Calendar
            </Link>
            <h1 className="text-base font-semibold tracking-tight">Dashboard</h1>
            <Link to="/settings" className="min-h-[44px] text-sm text-gray-600 underline">
              Settings
            </Link>
          </div>
          {businessName && (
            <p className="mt-1 text-center text-xs text-gray-500">{businessName}</p>
          )}
        </header>

        <section className="flex-1 px-4 py-4">
          {query.isLoading && <SkeletonGrid />}
          {query.isError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              Couldn&apos;t load the dashboard. Pull to refresh, or try again in a moment.
            </div>
          )}
          {summary && wholeDashboardEmpty && <WholeEmptyState />}
          {summary && !wholeDashboardEmpty && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <TodayRouteCard />
              <RevenueCard data={summary.revenue} />
              <NoShowCard data={summary.noShow} />
              <DurationCard data={summary.duration} />
              <TopClientsCard data={summary.topClients} />
              <GapsCard data={summary.gaps} />
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function SkeletonGrid(): JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="dashboard-skeleton">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className="min-h-[120px] animate-pulse rounded-xl border border-gray-200 bg-white p-4"
        >
          <div className="h-3 w-24 rounded bg-gray-100" />
          <div className="mt-4 h-6 w-16 rounded bg-gray-100" />
        </div>
      ))}
    </div>
  );
}

function WholeEmptyState(): JSX.Element {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 bg-white p-6 text-center">
      <h2 className="text-base font-semibold text-gray-900">
        Add your first client to start seeing your numbers.
      </h2>
      <p className="mt-1 text-sm text-gray-500">
        Revenue, no-shows, and top regulars appear here after your first cut.
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Link
          to="/clients/new"
          className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-gray-900 px-4 text-sm font-semibold text-white"
        >
          Add your first client
        </Link>
        <Link
          to="/settings/payments"
          className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-gray-300 px-4 text-sm font-semibold text-gray-900"
        >
          Set up payments
        </Link>
      </div>
    </div>
  );
}
