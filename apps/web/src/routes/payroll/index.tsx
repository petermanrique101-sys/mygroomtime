import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuthOptional } from '../../lib/auth-context';
import {
  getPayrollPeriods,
  getPayrollSplits,
  payrollSplitsCsvUrl,
} from '../../lib/payroll-api';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:3000';

function formatDateRange(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${start.toLocaleDateString([], opts)} – ${new Date(end.getTime() - 1).toLocaleDateString([], opts)}`;
}

function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  });
}

export default function PayrollRoute(): JSX.Element {
  const auth = useAuthOptional();
  const plan = auth?.session?.tenant.plan ?? 'starter';
  const isBusiness = plan === 'business';

  const { from, to } = useMemo(() => {
    const now = new Date();
    const from = new Date(now);
    from.setUTCMonth(from.getUTCMonth() - 2);
    const to = new Date(now);
    to.setUTCMonth(to.getUTCMonth() + 1);
    return { from: from.toISOString(), to: to.toISOString() };
  }, []);

  const periodsQuery = useQuery({
    queryKey: ['payroll', 'periods', from, to],
    enabled: isBusiness,
    queryFn: async () => {
      const res = await getPayrollPeriods(from, to);
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
  });

  const periods = periodsQuery.data?.periods ?? [];
  const [pickedIdx, setPickedIdx] = useState<number>(-1);

  const effectiveIdx = useMemo(() => {
    if (pickedIdx >= 0 && pickedIdx < periods.length) return pickedIdx;
    const nowMs = Date.now();
    const idx = periods.findIndex(
      (p) =>
        new Date(p.periodStart).getTime() <= nowMs &&
        new Date(p.periodEnd).getTime() > nowMs,
    );
    return idx >= 0 ? idx : Math.max(0, periods.length - 1);
  }, [pickedIdx, periods]);

  const period = periods[effectiveIdx] ?? null;

  const splitsQuery = useQuery({
    queryKey: ['payroll', 'splits', period?.periodStart, period?.periodEnd],
    enabled: isBusiness && !!period,
    queryFn: async () => {
      if (!period) throw new Error('No period selected');
      const res = await getPayrollSplits(period.periodStart, period.periodEnd);
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    },
  });

  if (!isBusiness) {
    return (
      <main className="min-h-screen bg-white px-4 py-6 text-gray-900">
        <div className="mx-auto max-w-md">
          <Link to="/dashboard" className="text-sm text-gray-600 underline">
            ← Dashboard
          </Link>
          <h1 className="mt-3 text-lg font-semibold">Payroll</h1>
          <p className="mt-2 text-sm text-gray-600">
            Payroll splits are a Business-tier feature.
          </p>
          <Link
            to="/settings/billing"
            className="mt-4 inline-block rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white"
          >
            Upgrade to Business
          </Link>
        </div>
      </main>
    );
  }

  const splits = splitsQuery.data;
  const csvHref = period
    ? payrollSplitsCsvUrl(API_BASE, period.periodStart, period.periodEnd)
    : '#';

  return (
    <main className="min-h-screen bg-white text-gray-900">
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col">
        <header className="sticky top-0 z-10 border-b border-gray-100 bg-white px-4 pb-3 pt-5">
          <Link to="/dashboard" className="text-sm text-gray-600 underline">
            ← Dashboard
          </Link>
          <h1 className="mt-1 text-base font-semibold">Payroll splits</h1>
        </header>
        <section className="flex-1 px-4 py-4">
          <div className="mb-4 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPickedIdx(Math.max(0, effectiveIdx - 1))}
              disabled={effectiveIdx <= 0}
              className="rounded-md border border-gray-300 px-3 py-1 text-sm disabled:opacity-40"
              aria-label="Previous period"
            >
              ←
            </button>
            <div className="flex-1 text-center text-sm font-medium" data-testid="period-label">
              {period
                ? formatDateRange(period.periodStart, period.periodEnd)
                : 'No periods'}
            </div>
            <button
              type="button"
              onClick={() => setPickedIdx(Math.min(periods.length - 1, effectiveIdx + 1))}
              disabled={effectiveIdx >= periods.length - 1}
              className="rounded-md border border-gray-300 px-3 py-1 text-sm disabled:opacity-40"
              aria-label="Next period"
            >
              →
            </button>
          </div>

          {splitsQuery.isLoading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : splits && splits.rows.length === 0 ? (
            <p className="text-sm text-gray-500">No completed appointments in this period.</p>
          ) : splits ? (
            <PayrollTable splits={splits} />
          ) : null}

          {splits && splits.rows.length > 0 ? (
            <a
              href={csvHref}
              download
              data-testid="payroll-csv-download"
              className="mt-4 inline-block rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white"
            >
              Export CSV
            </a>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function PayrollTable(props: {
  splits: NonNullable<ReturnType<typeof useQuery>['data']> extends infer T ? T : never;
}): JSX.Element {
  const s = props.splits as {
    rows: Array<{
      groomerId: string | null;
      groomerEmail: string | null;
      groomerName: string | null;
      appointmentsCompleted: number;
      revenueCents: number;
      tipsCents: number;
      totalCents: number;
    }>;
    totals: {
      appointmentsCompleted: number;
      revenueCents: number;
      tipsCents: number;
      totalCents: number;
    };
  };
  return (
    <table className="w-full border-collapse text-sm" data-testid="payroll-table">
      <thead>
        <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
          <th className="py-2">Groomer</th>
          <th className="py-2 text-right">Appts</th>
          <th className="py-2 text-right">Revenue</th>
          <th className="py-2 text-right">Tips</th>
          <th className="py-2 text-right">Total</th>
        </tr>
      </thead>
      <tbody>
        {s.rows.map((r) => (
          <tr
            key={r.groomerId ?? '__unassigned__'}
            className="border-b border-gray-100"
            data-testid={`payroll-row-${r.groomerId ?? 'unassigned'}`}
          >
            <td className="py-2">
              <div className="font-medium">
                {r.groomerName ?? r.groomerEmail ?? 'Unassigned'}
              </div>
              {r.groomerEmail ? (
                <div className="text-xs text-gray-500">{r.groomerEmail}</div>
              ) : null}
            </td>
            <td className="py-2 text-right">{r.appointmentsCompleted}</td>
            <td className="py-2 text-right">{formatMoney(r.revenueCents)}</td>
            <td className="py-2 text-right">{formatMoney(r.tipsCents)}</td>
            <td className="py-2 text-right font-semibold">{formatMoney(r.totalCents)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="text-sm font-semibold">
          <td className="py-2">Totals</td>
          <td className="py-2 text-right">{s.totals.appointmentsCompleted}</td>
          <td className="py-2 text-right">{formatMoney(s.totals.revenueCents)}</td>
          <td className="py-2 text-right">{formatMoney(s.totals.tipsCents)}</td>
          <td className="py-2 text-right">{formatMoney(s.totals.totalCents)}</td>
        </tr>
      </tfoot>
    </table>
  );
}
