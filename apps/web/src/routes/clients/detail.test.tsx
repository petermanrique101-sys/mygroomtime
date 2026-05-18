import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ClientDetailRoute from './detail';

type ClientFixture = {
  smsOptOut: boolean;
};

function fixtureBody(opts: ClientFixture): unknown {
  return {
    client: {
      id: 'client_1',
      name: 'Sarah Owner',
      phone: '+19725550199',
      email: null,
      street: '1 Main St',
      city: 'Plano',
      state: 'TX',
      zip: '75024',
      lat: null,
      lng: null,
      addressVerified: true,
      preferredGroomerId: null,
      notes: '',
      smsOptOut: opts.smsOptOut,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      pets: [],
    },
  };
}

function setupFetchMock(opts: ClientFixture): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    return new Response(JSON.stringify(fixtureBody(opts)), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

function renderApp(): void {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/clients/client_1']}>
        <Routes>
          <Route path="/clients/:id" element={<ClientDetailRoute />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ClientDetailRoute — SMS opt-out badge', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the badge when smsOptOut=true', async () => {
    setupFetchMock({ smsOptOut: true });
    renderApp();
    await waitFor(() => {
      expect(screen.getByText('Opted out of SMS')).toBeInTheDocument();
    });
  });

  it('omits the badge when smsOptOut=false', async () => {
    setupFetchMock({ smsOptOut: false });
    renderApp();
    await waitFor(() => {
      // page loaded — header is present
      expect(screen.getByText('Sarah Owner')).toBeInTheDocument();
    });
    expect(screen.queryByText('Opted out of SMS')).not.toBeInTheDocument();
  });
});
