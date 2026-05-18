import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  DashboardGapsListResponse,
  DashboardNoShowsListResponse,
  DashboardSummaryResponse,
  DashboardTopClientsListResponse,
} from '@mygroomtime/shared';
import DashboardRoute from './index';
import DashboardRevenueRoute from './revenue';
import DashboardNoShowsRoute from './no-shows';
import DashboardTopClientsRoute from './top-clients';
import DashboardGapsToFillRoute from './gaps-to-fill';
import { RevenueCard } from './widgets/revenue-card';
import { NoShowCard } from './widgets/no-show-card';
import { GapsCard } from './widgets/gaps-card';
import { TopClientsCard } from './widgets/top-clients-card';

function makeSummary(overrides: Partial<DashboardSummaryResponse> = {}): DashboardSummaryResponse {
  return {
    generatedAt: '2026-05-18T12:00:00.000Z',
    revenue: { dayCents: 12_000, weekCents: 50_000, monthCents: 200_000 },
    noShow: { rate: 0.1, sampleSize: 30, windowDays: 30 },
    duration: { avgMin: 75, sampleSize: 20, windowDays: 30 },
    topClients: {
      rows: [
        {
          clientId: 'cli-1',
          name: 'Sarah Johnson',
          totalCents: 100_000,
          appointmentCount: 4,
          isDeleted: false,
        },
      ],
      windowDays: 90,
    },
    gaps: {
      rows: [
        {
          seriesId: 'srs-1',
          clientId: 'cli-2',
          clientName: 'Maria Lopez',
          petName: 'Bella',
          lastGroomedAt: '2026-03-01T10:00:00.000Z',
          intervalWeeks: 6,
          daysOverdue: 30,
        },
      ],
      gated: false,
    },
    ...overrides,
  };
}

function mockFetch(handler: (url: string, init?: RequestInit) => unknown): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    const body = handler(url, init ?? undefined);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

function renderRoute(path: string, ui: JSX.Element): { user: ReturnType<typeof userEvent.setup> } {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={path} element={ui} />
          <Route path="*" element={<div data-testid="other-route" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user: userEvent.setup() };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Dashboard widgets', () => {
  it('RevenueCard renders dollar values and links to /dashboard/revenue', () => {
    render(
      <MemoryRouter>
        <RevenueCard
          data={{ dayCents: 12_000, weekCents: 80_000, monthCents: 250_000 }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('Revenue')).toBeTruthy();
    expect(screen.getByText('$120')).toBeTruthy();
    expect(screen.getByText('$800')).toBeTruthy();
    expect(screen.getByText('$2.5k')).toBeTruthy();
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/dashboard/revenue');
  });

  it('RevenueCard empty state when all zeros', () => {
    render(
      <MemoryRouter>
        <RevenueCard data={{ dayCents: 0, weekCents: 0, monthCents: 0 }} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/No completed appointments yet/i)).toBeTruthy();
  });

  it('NoShowCard renders rate and sample size', () => {
    render(
      <MemoryRouter>
        <NoShowCard data={{ rate: 0.12, sampleSize: 50, windowDays: 30 }} />
      </MemoryRouter>,
    );
    expect(screen.getByText('12%')).toBeTruthy();
    expect(screen.getByText(/50 resolved appts/i)).toBeTruthy();
  });

  it('NoShowCard empty state at sampleSize=0', () => {
    render(
      <MemoryRouter>
        <NoShowCard data={{ rate: 0, sampleSize: 0, windowDays: 30 }} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Not enough data yet/i)).toBeTruthy();
  });

  it('GapsCard gated: shows upgrade copy + link, no numbers', () => {
    render(
      <MemoryRouter>
        <GapsCard
          data={{ rows: [], gated: true, gatedReason: 'recurring_requires_pro' }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Recurring rebooks unlock on Pro/i)).toBeTruthy();
    const upgrade = screen.getByRole('link', { name: /Upgrade to Pro/i });
    expect(upgrade.getAttribute('href')).toBe('/settings/billing');
  });

  it('TopClientsCard tags soft-deleted client as (removed)', () => {
    render(
      <MemoryRouter>
        <TopClientsCard
          data={{
            rows: [
              {
                clientId: 'c1',
                name: 'Sarah',
                totalCents: 10_000,
                appointmentCount: 2,
                isDeleted: true,
              },
            ],
            windowDays: 90,
          }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('(removed)')).toBeTruthy();
  });
});

describe('DashboardRoute index page', () => {
  beforeEach(() => {
    mockFetch((url) => {
      if (url.endsWith('/dashboard')) return makeSummary();
      return {};
    });
  });

  it('renders all six widgets with sensible numbers', async () => {
    renderRoute('/dashboard', <DashboardRoute />);
    await waitFor(() => {
      expect(screen.getByText('Revenue')).toBeTruthy();
    });
    expect(screen.getByText('No-show rate')).toBeTruthy();
    expect(screen.getByText('Avg service time')).toBeTruthy();
    expect(screen.getByText('Top clients')).toBeTruthy();
    expect(screen.getByText('Gaps to fill')).toBeTruthy();
    expect(screen.getByText(/Today.s route/i)).toBeTruthy();
    expect(screen.getByText('75 min')).toBeTruthy();
    expect(screen.getByText('10%')).toBeTruthy();
  });

  it('whole-tenant empty: shows onboarding CTAs', async () => {
    vi.restoreAllMocks();
    mockFetch((url) => {
      if (url.endsWith('/dashboard')) {
        return makeSummary({
          revenue: { dayCents: 0, weekCents: 0, monthCents: 0 },
          noShow: { rate: 0, sampleSize: 0, windowDays: 30 },
          duration: { avgMin: null, sampleSize: 0, windowDays: 30 },
          topClients: { rows: [], windowDays: 90 },
          gaps: { rows: [], gated: false },
        });
      }
      return {};
    });
    renderRoute('/dashboard', <DashboardRoute />);
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /Add your first client/i })).toBeTruthy();
    });
    const addLink = screen.getByRole('link', { name: /Add your first client/i });
    expect(addLink.getAttribute('href')).toBe('/clients/new');
    const payLink = screen.getByRole('link', { name: /Set up payments/i });
    expect(payLink.getAttribute('href')).toBe('/settings/payments');
  });

  it('Starter tenant: gaps widget shows gated copy, not numbers', async () => {
    vi.restoreAllMocks();
    mockFetch((url) => {
      if (url.endsWith('/dashboard')) {
        return makeSummary({
          gaps: { rows: [], gated: true, gatedReason: 'recurring_requires_pro' },
        });
      }
      return {};
    });
    renderRoute('/dashboard', <DashboardRoute />);
    await waitFor(() => {
      expect(screen.getByText(/Recurring rebooks unlock on Pro/i)).toBeTruthy();
    });
    // No daysOverdue badge anywhere on the gaps card
    expect(screen.queryByText(/30d late/i)).toBeNull();
  });
});

describe('No-shows drill-down', () => {
  it('paginates: page 2 fetched on Next, page indicator updates', async () => {
    const pages: Record<number, DashboardNoShowsListResponse> = {
      1: {
        rows: Array.from({ length: 25 }, (_, i) => ({
          appointmentId: `a${i}`,
          clientId: `c${i}`,
          clientName: `Client ${i}`,
          petName: `Pet ${i}`,
          serviceName: 'Full Groom',
          scheduledStart: '2026-05-10T10:00:00.000Z',
          noShowAt: '2026-05-10T10:00:00.000Z',
        })),
        pagination: { page: 1, pageSize: 25, total: 40 },
        windowDays: 30,
      },
      2: {
        rows: Array.from({ length: 15 }, (_, i) => ({
          appointmentId: `b${i}`,
          clientId: `c${i}`,
          clientName: `Other ${i}`,
          petName: `Pet ${i}`,
          serviceName: 'Bath & Brush',
          scheduledStart: '2026-04-20T10:00:00.000Z',
          noShowAt: '2026-04-20T10:00:00.000Z',
        })),
        pagination: { page: 2, pageSize: 25, total: 40 },
        windowDays: 30,
      },
    };
    mockFetch((url) => {
      const m = url.match(/page=(\d+)/);
      const p = m ? Number(m[1]) : 1;
      return pages[p] ?? pages[1];
    });
    const { user } = renderRoute('/dashboard/no-shows', <DashboardNoShowsRoute />);
    expect(await screen.findByText(/Pet 0 \(Client 0\)/)).toBeTruthy();
    expect(screen.getByText(/Page 1 of 2/i)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Next/i }));
    expect(await screen.findByText(/Pet 0 \(Other 0\)/)).toBeTruthy();
    expect(screen.getByText(/Page 2 of 2/i)).toBeTruthy();
  });
});

describe('Top clients drill-down', () => {
  it('renders ranked list with appointment count', async () => {
    const list: DashboardTopClientsListResponse = {
      rows: [
        {
          clientId: 'c1',
          name: 'Sarah Johnson',
          totalCents: 100_000,
          appointmentCount: 5,
          isDeleted: false,
        },
        {
          clientId: 'c2',
          name: 'Maria Lopez',
          totalCents: 60_000,
          appointmentCount: 3,
          isDeleted: true,
        },
      ],
      pagination: { page: 1, pageSize: 25, total: 2 },
      windowDays: 90,
    };
    mockFetch(() => list);
    renderRoute('/dashboard/top-clients', <DashboardTopClientsRoute />);
    await waitFor(() => {
      expect(screen.getByText('Sarah Johnson')).toBeTruthy();
    });
    expect(screen.getByText('Maria Lopez')).toBeTruthy();
    expect(screen.getByText('(removed)')).toBeTruthy();
    expect(screen.getByText('$1,000')).toBeTruthy();
    expect(screen.getByText('$600')).toBeTruthy();
  });
});

describe('Gaps drill-down', () => {
  it('starter (gated): shows upgrade screen with link to billing', async () => {
    const data: DashboardGapsListResponse = {
      rows: [],
      gated: true,
      gatedReason: 'recurring_requires_pro',
    };
    mockFetch(() => data);
    renderRoute('/dashboard/gaps-to-fill', <DashboardGapsToFillRoute />);
    await waitFor(() => {
      expect(screen.getByText(/Gaps to fill is a Pro feature/i)).toBeTruthy();
    });
    const link = screen.getByRole('link', { name: /Upgrade to Pro/i });
    expect(link.getAttribute('href')).toBe('/settings/billing');
  });

  it('pro tenant with overdue regulars: rows render with daysOverdue badge and link to client', async () => {
    const data: DashboardGapsListResponse = {
      rows: [
        {
          seriesId: 's1',
          clientId: 'cli-123',
          clientName: 'Maria Lopez',
          petName: 'Bella',
          lastGroomedAt: '2026-03-15T10:00:00.000Z',
          intervalWeeks: 4,
          daysOverdue: 22,
        },
      ],
      gated: false,
    };
    mockFetch(() => data);
    renderRoute('/dashboard/gaps-to-fill', <DashboardGapsToFillRoute />);
    await waitFor(() => {
      expect(screen.getByText(/Bella \(Maria Lopez\)/)).toBeTruthy();
    });
    expect(screen.getByText('22d overdue')).toBeTruthy();
    const link = screen.getByRole('link', { name: /Bella/i });
    expect(link.getAttribute('href')).toBe('/clients/cli-123');
  });
});

describe('Revenue drill-down', () => {
  it('renders bucket list and total', async () => {
    mockFetch(() => ({
      period: 'week',
      buckets: [
        { dateIso: '2026-05-10', revenueCents: 5_000, appointmentCount: 1 },
        { dateIso: '2026-05-11', revenueCents: 10_000, appointmentCount: 2 },
      ],
    }));
    renderRoute('/dashboard/revenue', <DashboardRevenueRoute />);
    expect(await screen.findByText('$150')).toBeTruthy();
    expect(screen.getByText('3 completed')).toBeTruthy();
  });
});
