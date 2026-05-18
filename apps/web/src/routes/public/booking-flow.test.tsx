import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  PublicBookingStatusResponse,
  PublicBookingSubmitResponse,
  PublicTenantResponse,
} from '@mygroomtime/shared';
import PublicBookingDetailsRoute from './details';
import PublicBookedRoute from './booked';

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: React.ReactNode }) => children,
  PaymentElement: () => null,
  useStripe: () => null,
  useElements: () => null,
}));

const TOMORROW_AT_TEN = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  while (d.getDay() === 0) d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return d.toISOString();
})();

function tenantResponse(): PublicTenantResponse {
  return {
    slug: 'demo',
    businessName: 'Plano Pup Spa',
    phone: '+19725550199',
    readOnly: false,
    currentTime: new Date().toISOString(),
    services: [
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

function submitResponse(): PublicBookingSubmitResponse {
  return {
    bookingRequestId: 'bpr_1',
    paymentIntentId: 'pi_TWIN_1',
    clientSecret: 'pi_TWIN_1_secret_xyz',
    depositCents: 2000,
    twinMode: true,
  };
}

function statusResponse(
  overrides: Partial<PublicBookingStatusResponse> = {},
): PublicBookingStatusResponse {
  return {
    status: overrides.status ?? 'pending_payment',
    appointmentId: overrides.appointmentId ?? null,
    service: overrides.service ?? {
      name: 'Full Groom',
      durationMin: 90,
      color: '#2563eb',
    },
    start: overrides.start ?? TOMORROW_AT_TEN,
    addressLine: overrides.addressLine ?? '1234 Oak St, Plano, TX 75024',
  };
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

function renderDetails(): { user: ReturnType<typeof userEvent.setup> } {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const start = encodeURIComponent(TOMORROW_AT_TEN);
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter
        initialEntries={[`/public/demo/book/svc-full/details?start=${start}`]}
      >
        <Routes>
          <Route
            path="/public/:slug/book/:serviceId/details"
            element={<PublicBookingDetailsRoute />}
          />
          <Route
            path="/public/:slug/booked/:requestId"
            element={<div data-testid="booked-landed">booked</div>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user: userEvent.setup() };
}

function renderBooked(): void {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/public/demo/booked/bpr_1`]}>
        <Routes>
          <Route path="/public/:slug/booked/:requestId" element={<PublicBookedRoute />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Public booking — details + payment flow', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the form, submits, then shows the payment step (twin stub)', async () => {
    let submitted = false;
    mockFetch((url, init) => {
      if (url.endsWith('/public/demo')) return json(tenantResponse());
      if (url.endsWith('/public/demo/bookings') && init?.method === 'POST') {
        submitted = true;
        return json(submitResponse());
      }
      return json({}, 404);
    });
    const { user } = renderDetails();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Continue to payment/i })).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText(/First name/i), 'Carlos');
    await user.type(screen.getByLabelText(/Last name/i), 'Reyes');
    await user.type(screen.getByLabelText(/^Phone$/i), '9725550199');
    await user.type(screen.getByLabelText(/^Street$/i), '1234 Oak St');
    await user.type(screen.getByLabelText(/^City$/i), 'Plano');
    await user.type(screen.getByLabelText(/^Zip code$/i), '75024');
    await user.type(screen.getByLabelText(/^Name$/i), 'Bruno');
    await user.type(screen.getByLabelText(/^Breed$/i), 'Beagle');

    await user.click(screen.getByRole('button', { name: /Continue to payment/i }));

    await waitFor(() => expect(submitted).toBe(true));
    await waitFor(() => {
      expect(screen.getByTestId('twin-payment-stub')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /Pay \$20.00 deposit/i })).toBeInTheDocument();
  });

  it('shows a server error inline when submit fails', async () => {
    mockFetch((url, init) => {
      if (url.endsWith('/public/demo')) return json(tenantResponse());
      if (url.endsWith('/public/demo/bookings') && init?.method === 'POST') {
        return json(
          { error: 'slot_unavailable', message: 'That time was just taken.' },
          409,
        );
      }
      return json({}, 404);
    });
    const { user } = renderDetails();
    await waitFor(() => screen.getByRole('button', { name: /Continue to payment/i }));

    await user.type(screen.getByLabelText(/First name/i), 'A');
    await user.type(screen.getByLabelText(/Last name/i), 'B');
    await user.type(screen.getByLabelText(/^Phone$/i), '9725550100');
    await user.type(screen.getByLabelText(/^Street$/i), '1 Oak');
    await user.type(screen.getByLabelText(/^City$/i), 'Plano');
    await user.type(screen.getByLabelText(/^Zip code$/i), '75024');
    await user.type(screen.getByLabelText(/^Name$/i), 'Rex');
    await user.type(screen.getByLabelText(/^Breed$/i), 'Lab');
    await user.click(screen.getByRole('button', { name: /Continue to payment/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/just taken/i);
    });
  });
});

describe('Public booking — confirmation page polling', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows "You\'re all set" when status flips to promoted', async () => {
    let calls = 0;
    mockFetch((url) => {
      if (url.includes('/bookings/bpr_1/status')) {
        calls += 1;
        if (calls === 1) return json(statusResponse({ status: 'pending_payment' }));
        return json(statusResponse({ status: 'promoted', appointmentId: 'appt_1' }));
      }
      return json({}, 404);
    });
    renderBooked();
    await waitFor(
      () => {
        expect(screen.getByText(/You're all set/i)).toBeInTheDocument();
      },
      { timeout: 4000 },
    );
    expect(screen.getByText(/Full Groom/)).toBeInTheDocument();
  });

  it('shows the failed state if status is failed', async () => {
    mockFetch((url) => {
      if (url.includes('/bookings/bpr_1/status')) {
        return json(statusResponse({ status: 'failed' }));
      }
      return json({}, 404);
    });
    renderBooked();
    await waitFor(() => {
      expect(screen.getByText(/Payment failed/i)).toBeInTheDocument();
    });
  });
});
