import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { act } from 'react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ServicesSettingsRoute from './services';

type Captured = { url: string; init?: RequestInit | undefined };

function makeService(overrides: Partial<{ id: string; name: string; active: boolean }> = {}): {
  id: string;
  name: string;
  durationMin: number;
  basePriceCents: number;
  depositCents: number;
  color: string;
  active: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
} {
  return {
    id: overrides.id ?? 'srv-1',
    name: overrides.name ?? 'Full Groom',
    durationMin: 90,
    basePriceCents: 8500,
    depositCents: 2000,
    color: '#2563eb',
    active: overrides.active ?? true,
    deletedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function setupFetchMock(handlers: {
  initialServices: ReturnType<typeof makeService>[];
  onCreate?: (body: Record<string, unknown>) => ReturnType<typeof makeService>;
}): { captured: Captured[]; servicesRef: { current: ReturnType<typeof makeService>[] } } {
  const captured: Captured[] = [];
  const servicesRef = { current: [...handlers.initialServices] };

  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    captured.push({ url, init: init ?? undefined });

    if (url.includes('/services') && (init?.method === undefined || init.method === 'GET')) {
      return new Response(JSON.stringify({ services: servicesRef.current }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.endsWith('/services') && init?.method === 'POST') {
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      const created = handlers.onCreate
        ? handlers.onCreate(body)
        : makeService({ id: 'srv-new', name: String(body.name) });
      servicesRef.current = [...servicesRef.current, created];
      return new Response(JSON.stringify({ service: created }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  return { captured, servicesRef };
}

function renderApp(): { user: ReturnType<typeof userEvent.setup> } {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/settings/services']}>
        <Routes>
          <Route path="/settings/services" element={<ServicesSettingsRoute />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user: userEvent.setup() };
}

describe('ServicesSettingsRoute', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders existing services and creates a new one via the form', async () => {
    const { captured } = setupFetchMock({
      initialServices: [makeService({ id: 'srv-existing', name: 'Bath & Brush' })],
      onCreate: (body) =>
        makeService({ id: 'srv-new', name: String(body.name) }),
    });

    const { user } = renderApp();

    await waitFor(() => {
      expect(screen.getByText('Bath & Brush')).toBeInTheDocument();
    });

    await act(async () => {
      await user.click(screen.getByRole('button', { name: /Add service/i }));
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /New service/i })).toBeInTheDocument();
    });

    const form = screen.getByRole('heading', { name: /New service/i }).closest('div')!
      .parentElement as HTMLElement;
    await act(async () => {
      await user.type(within(form).getByRole('textbox', { name: /Name/i }), 'Nail Trim');
      const priceInput = form.querySelector(
        'input[name="basePriceDollars"]',
      ) as HTMLInputElement;
      await user.type(priceInput, '20.00');
      await user.click(screen.getByRole('button', { name: /Save/i }));
    });

    await waitFor(() => {
      const post = captured.find((c) => c.init?.method === 'POST');
      expect(post).toBeDefined();
      const body = JSON.parse(post!.init!.body as string) as Record<string, unknown>;
      expect(body.name).toBe('Nail Trim');
      expect(body.basePriceCents).toBe(2000);
    });

    await waitFor(() => {
      expect(screen.getByText('Nail Trim')).toBeInTheDocument();
    });
  });
});
