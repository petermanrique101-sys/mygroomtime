import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SettingsBillingRoute from './billing';

type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mockFetch(handler: FetchHandler): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    return handler(url, init ?? undefined);
  });
}

function renderApp(): { user: ReturnType<typeof userEvent.setup> } {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/settings/billing']}>
        <Routes>
          <Route path="/settings/billing" element={<SettingsBillingRoute />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user: userEvent.setup() };
}

const baseGet = {
  plan: 'starter',
  currentPeriodEnd: new Date('2026-06-15T00:00:00Z').toISOString(),
  hasPaymentMethod: true,
  available: [
    { tier: 'starter', priceMonthlyCents: 4900 },
    { tier: 'pro', priceMonthlyCents: 9900 },
    { tier: 'business', priceMonthlyCents: 14900 },
  ],
};

describe('SettingsBillingRoute', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  async function tierCard(tier: 'starter' | 'pro' | 'business'): Promise<HTMLElement> {
    return await waitFor(() => {
      const el = document.querySelector(`[data-tier="${tier}"]`);
      if (!el) throw new Error(`tier card ${tier} not found`);
      return el as HTMLElement;
    });
  }

  it('renders current plan card + tier matrix', async () => {
    mockFetch((url) => {
      if (url.endsWith('/settings/billing')) return json(200, baseGet);
      return json(404, {});
    });
    renderApp();
    expect(
      await screen.findByRole('heading', { name: /Billing/i, level: 1 }),
    ).toBeInTheDocument();
    const starterCard = await tierCard('starter');
    expect(within(starterCard).getByText(/Current plan/i)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Switch to/ })).toHaveLength(2);
    expect(screen.getByRole('button', { name: /Update card/i })).toBeInTheDocument();
  });

  it('clicking Switch shows preview modal with charge copy for upgrade', async () => {
    mockFetch((url, init) => {
      if (url.endsWith('/settings/billing') && (!init || init.method === undefined)) {
        return json(200, baseGet);
      }
      if (url.endsWith('/settings/billing/preview-plan-change')) {
        return json(200, {
          targetPlan: 'pro',
          amountDueCents: 4900,
          creditCents: 0,
          chargeCents: 4900,
          currentPeriodEndIso: new Date('2026-06-15T00:00:00Z').toISOString(),
          nextChargeCents: 9900,
        });
      }
      return json(404, {});
    });
    const { user } = renderApp();
    const card = await tierCard('pro');
    await user.click(within(card).getByRole('button', { name: /Switch to Pro/i }));
    const dialog = await screen.findByRole('dialog', { name: /Switch to Pro/i });
    expect(within(dialog).getByText(/Switch to Pro — \$99\.00\/mo/)).toBeInTheDocument();
    expect(within(dialog).getByText(/We'll charge \$49\.00 today/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Public booking page goes live/i)).toBeInTheDocument();
  });

  it('confirming an upgrade calls change-plan and shows in-progress toast', async () => {
    const calls: string[] = [];
    mockFetch((url, init) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.endsWith('/settings/billing') && (!init || init.method === undefined)) {
        return json(200, baseGet);
      }
      if (url.endsWith('/settings/billing/preview-plan-change')) {
        return json(200, {
          targetPlan: 'pro',
          amountDueCents: 4900,
          creditCents: 0,
          chargeCents: 4900,
          currentPeriodEndIso: new Date('2026-06-15T00:00:00Z').toISOString(),
          nextChargeCents: 9900,
        });
      }
      if (url.endsWith('/settings/billing/change-plan')) {
        return json(202, { pending: true, willTakeEffect: 'webhook' });
      }
      return json(404, {});
    });
    const { user } = renderApp();
    const card = await tierCard('pro');
    await user.click(within(card).getByRole('button', { name: /Switch to Pro/i }));
    const dialog = await screen.findByRole('dialog', { name: /Switch to Pro/i });
    await user.click(within(dialog).getByRole('button', { name: /Confirm switch to Pro/i }));
    await waitFor(() => {
      expect(
        calls.some((c) => c.startsWith('POST ') && c.endsWith('/settings/billing/change-plan')),
      ).toBe(true);
    });
    expect(await screen.findByText(/Plan change in progress/i)).toBeInTheDocument();
  });

  it('downgrade preview shows credit copy + downgrade bullets', async () => {
    mockFetch((url, init) => {
      if (url.endsWith('/settings/billing') && (!init || init.method === undefined)) {
        return json(200, { ...baseGet, plan: 'pro' });
      }
      if (url.endsWith('/settings/billing/preview-plan-change')) {
        return json(200, {
          targetPlan: 'starter',
          amountDueCents: 0,
          creditCents: 1234,
          chargeCents: 0,
          currentPeriodEndIso: new Date('2026-06-15T00:00:00Z').toISOString(),
          nextChargeCents: 4900,
        });
      }
      return json(404, {});
    });
    const { user } = renderApp();
    const card = await tierCard('starter');
    await user.click(within(card).getByRole('button', { name: /Switch to Starter/i }));
    const dialog = await screen.findByRole('dialog', { name: /Switch to Starter/i });
    expect(
      within(dialog).getByText(/We'll credit \$12\.34 to your next invoice/),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/Public booking page will no longer be available/i),
    ).toBeInTheDocument();
  });

  it('Update card button calls portal-session API', async () => {
    const calls: string[] = [];
    mockFetch((url, init) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.endsWith('/settings/billing') && (!init || init.method === undefined)) {
        return json(200, baseGet);
      }
      if (url.endsWith('/settings/billing/portal-session')) {
        return json(200, { url: 'http://portal.test/sess' });
      }
      return json(404, {});
    });
    const { user } = renderApp();
    await tierCard('starter');
    await user.click(await screen.findByRole('button', { name: /Update card/i }));
    await waitFor(() => {
      expect(
        calls.some((c) => c.startsWith('POST ') && c.endsWith('/settings/billing/portal-session')),
      ).toBe(true);
    });
  });
});
