import type {
  DashboardSummaryResponse,
  DashboardRevenueSummary,
  DashboardNoShowSummary,
  DashboardDurationSummary,
  DashboardTopClientsSummary,
  DashboardGapsSummary,
} from '@mygroomtime/shared';
import { getRevenue } from './revenue.js';
import { getNoShowRate } from './no-show-rate.js';
import { getAvgDuration } from './duration.js';
import { getTopClients } from './top-clients.js';
import { getGapsToFill } from './gaps-to-fill.js';

export type DashboardSummaryInput = {
  tenantId: string;
  plan: 'starter' | 'pro' | 'business' | 'past_due' | 'canceled' | 'unpaid';
  now?: Date;
  log?: { warn: (obj: unknown, msg?: string) => void };
};

// why: 5 widgets fan out in parallel. Per-widget errors do not black-screen the dashboard —
// a slow / failing metric returns `{ ...zeros, error: 'unavailable' }` and the other four
// still render. The widget UI renders a "couldn't load" pill when error is present.
export async function getDashboardSummary(
  input: DashboardSummaryInput,
): Promise<DashboardSummaryResponse> {
  const now = input.now ?? new Date();
  const log = input.log;
  const tenantId = input.tenantId;
  const starter = input.plan === 'starter';

  async function safeRevenue(): Promise<DashboardRevenueSummary> {
    try {
      const r = await getRevenue({ tenantId, now });
      return r;
    } catch (err) {
      log?.warn({ err, metric: 'revenue', tenantId }, 'dashboard metric failed');
      return { dayCents: 0, weekCents: 0, monthCents: 0, error: 'unavailable' };
    }
  }
  async function safeNoShow(): Promise<DashboardNoShowSummary> {
    try {
      return await getNoShowRate({ tenantId, now });
    } catch (err) {
      log?.warn({ err, metric: 'noShow', tenantId }, 'dashboard metric failed');
      return { rate: 0, sampleSize: 0, windowDays: 30, error: 'unavailable' };
    }
  }
  async function safeDuration(): Promise<DashboardDurationSummary> {
    try {
      return await getAvgDuration({ tenantId, now });
    } catch (err) {
      log?.warn({ err, metric: 'duration', tenantId }, 'dashboard metric failed');
      return { avgMin: null, sampleSize: 0, windowDays: 30, error: 'unavailable' };
    }
  }
  async function safeTopClients(): Promise<DashboardTopClientsSummary> {
    try {
      const top = await getTopClients({ tenantId, now });
      return { rows: top.rows, windowDays: top.windowDays };
    } catch (err) {
      log?.warn({ err, metric: 'topClients', tenantId }, 'dashboard metric failed');
      return { rows: [], windowDays: 90, error: 'unavailable' };
    }
  }
  async function safeGaps(): Promise<DashboardGapsSummary> {
    if (starter) return { rows: [], gated: true, gatedReason: 'recurring_requires_pro' };
    try {
      const rows = await getGapsToFill({ tenantId, now });
      return {
        rows: rows.map((r) => ({
          seriesId: r.seriesId,
          clientId: r.clientId,
          clientName: r.clientName,
          petName: r.petName,
          lastGroomedAt: r.lastGroomedAt ? r.lastGroomedAt.toISOString() : null,
          intervalWeeks: r.intervalWeeks,
          daysOverdue: r.daysOverdue,
        })),
        gated: false,
      };
    } catch (err) {
      log?.warn({ err, metric: 'gaps', tenantId }, 'dashboard metric failed');
      return { rows: [], gated: false, error: 'unavailable' };
    }
  }

  const [revenue, noShow, duration, topClients, gaps] = await Promise.all([
    safeRevenue(),
    safeNoShow(),
    safeDuration(),
    safeTopClients(),
    safeGaps(),
  ]);

  return {
    generatedAt: now.toISOString(),
    revenue,
    noShow,
    duration,
    topClients,
    gaps,
  };
}
