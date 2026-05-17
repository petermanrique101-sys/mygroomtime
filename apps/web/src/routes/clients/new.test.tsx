import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NewClientRoute from './new';

type Captured = { url: string; init?: RequestInit | undefined };

function setupFetchMock(opts: { status: number; body: unknown }): { captured: Captured[] } {
  const captured: Captured[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    captured.push({ url, init: init ?? undefined });
    return new Response(JSON.stringify(opts.body), {
      status: opts.status,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { captured };
}

function renderApp(): { user: ReturnType<typeof userEvent.setup>; root: HTMLElement } {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const { container } = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/clients/new']}>
        <Routes>
          <Route path="/clients/new" element={<NewClientRoute />} />
          <Route path="/clients/:id" element={<div>Client detail: created</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), root: container };
}

function input(root: HTMLElement, name: string): HTMLInputElement {
  const el = root.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (!el) throw new Error(`no input named ${name}`);
  return el;
}

async function fillAndSubmit(
  user: ReturnType<typeof userEvent.setup>,
  root: HTMLElement,
): Promise<void> {
  await user.type(input(root, 'name'), 'Pat Customer');
  await user.type(input(root, 'phone'), '9725550000');
  await user.type(input(root, 'street'), '123 Test Rd');
  await user.type(input(root, 'zip'), '75024');
  await user.type(input(root, 'pet-0-name'), 'Rex');
  await user.type(input(root, 'pet-0-breed'), 'Labrador');
  await user.click(screen.getByRole('button', { name: /Save client/i }));
}

describe('NewClientRoute', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('submits a filled form to POST /clients and navigates to the detail page', async () => {
    const { captured } = setupFetchMock({
      status: 201,
      body: {
        client: {
          id: 'new-client-id',
          name: 'Pat Customer',
          phone: '+19725550000',
          email: null,
          street: '123 Test Rd',
          city: 'Plano',
          state: 'TX',
          zip: '75024',
          lat: 33.08,
          lng: -96.81,
          addressVerified: true,
          preferredGroomerId: null,
          notes: '',
          smsOptOut: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          pets: [],
        },
        warning: null,
      },
    });

    const { user, root } = renderApp();
    await act(async () => {
      await fillAndSubmit(user, root);
    });

    await waitFor(() => {
      expect(captured.length).toBeGreaterThan(0);
    });
    const post = captured.find((c) => c.init?.method === 'POST');
    expect(post).toBeDefined();
    expect(post!.url).toContain('/clients');
    const body = JSON.parse(post!.init!.body as string);
    expect(body).toMatchObject({
      name: 'Pat Customer',
      street: '123 Test Rd',
      zip: '75024',
      pets: [expect.objectContaining({ name: 'Rex', breed: 'Labrador' })],
    });

    await waitFor(() => {
      expect(screen.getByText(/Client detail: created/)).toBeInTheDocument();
    });
  });

  it('does not POST when required fields are missing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { user } = renderApp();
    await user.click(screen.getByRole('button', { name: /Save client/i }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
