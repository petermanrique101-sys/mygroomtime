import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PublicTenantResponse, PublicAvailabilityResponse } from '@mygroomtime/shared';
import PublicLandingRoute from './landing';
import PublicBookRoute from './book';

function makeTenant(overrides: Partial<PublicTenantResponse> = {}): PublicTenantResponse {
  return {
    slug: overrides.slug ?? 'demo',
    businessName: overrides.businessName ?? 'Plano Pup Spa',
    phone: overrides.phone ?? '+19725550199',
    readOnly: overrides.readOnly ?? false,
    currentTime: new Date().toISOString(),
    services: overrides.services ?? [
      {
        id: 'svc-full',
        name: 'Full Groom',
        durationMin: 90,
        basePriceCents: 8500,
        depositCents: 2000,
        color: '#2563eb',
      },
    ],
  };
}

function tomorrowIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  while (d.getDay() === 0) d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return d.toISOString();
}

type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function mockFetch(handler: FetchHandler): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    return handler(url, init ?? undefined);
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function renderLanding(slug = 'demo'): { user: ReturnType<typeof userEvent.setup> } {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/public/${slug}`]}>
        <Routes>
          <Route path="/public/:slug" element={<PublicLandingRoute />} />
          <Route path="/public/:slug/book/:serviceId" element={<PublicBookRoute />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user: userEvent.setup() };
}

describe('Public landing', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the service menu for a normal tenant', async () => {
    mockFetch((url) => {
      if (url.includes('/public/demo') && !url.includes('availability')) {
        return json(makeTenant());
      }
      return json({}, 404);
    });
    renderLanding();
    await waitFor(() => {
      expect(screen.getByText(/Plano Pup Spa/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Full Groom/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Book$/i })).toBeInTheDocument();
  });

  it('renders the past_due read-only banner and disables Book', async () => {
    mockFetch((url) => {
      if (url.includes('/public/demo') && !url.includes('availability')) {
        return json(makeTenant({ readOnly: true }));
      }
      return json({}, 404);
    });
    renderLanding();
    await waitFor(() => {
      expect(screen.getByText(/Online booking is paused/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Please contact this groomer directly/i)).toBeInTheDocument();
    const disabledBtn = screen.getByRole('button', { name: /Bookings paused/i });
    expect(disabledBtn).toBeDisabled();
  });

  it('shows the not-found screen for a 404 tenant', async () => {
    mockFetch(() => json({ error: 'not_found', message: 'gone' }, 404));
    renderLanding();
    await waitFor(() => {
      expect(screen.getByText(/Booking page not found/i)).toBeInTheDocument();
    });
  });
});

describe('Public booking — date + slot picker', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('fetches availability after a date is picked and renders slot pills', async () => {
    const slotStart = tomorrowIso();
    mockFetch((url) => {
      if (url.includes('/availability')) {
        const body: PublicAvailabilityResponse = {
          serviceId: 'svc-full',
          date: '2099-01-01',
          slots: [{ start: slotStart, durationMin: 90 }],
        };
        return json(body);
      }
      if (url.includes('/public/demo')) {
        return json(makeTenant());
      }
      return json({}, 404);
    });

    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/public/demo/book/svc-full']}>
          <Routes>
            <Route path="/public/:slug/book/:serviceId" element={<PublicBookRoute />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.getByText(/Full Groom/)).toBeInTheDocument();
    });

    const dateList = screen.getByRole('listbox', { name: /Pick a date/i });
    const dayButtons = within(dateList)
      .getAllByRole('option')
      .filter((b) => !(b as HTMLButtonElement).disabled);
    await user.click(dayButtons[2]!);

    await waitFor(() => {
      const time = new Date(slotStart).toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
      });
      expect(screen.getByRole('button', { name: time })).toBeInTheDocument();
    });
  });

  it('disables Sunday tiles in the date picker', async () => {
    mockFetch((url) => {
      if (url.includes('/public/demo')) return json(makeTenant());
      return json({}, 404);
    });
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/public/demo/book/svc-full']}>
          <Routes>
            <Route path="/public/:slug/book/:serviceId" element={<PublicBookRoute />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(screen.getByRole('listbox', { name: /Pick a date/i })).toBeInTheDocument();
    });
    const dateList = screen.getByRole('listbox', { name: /Pick a date/i });
    const days = within(dateList).getAllByRole('option');
    const sundays = days.filter((b) => (b as HTMLButtonElement).disabled);
    expect(sundays.length).toBeGreaterThan(0);
  });
});
