import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SettingsSmsRoute from './sms';

type Captured = { url: string; init?: RequestInit | undefined };

function setupFetchMock(initial: { remindersEnabled: boolean; tierAllowsReminders: boolean }): {
  captured: Captured[];
  state: { remindersEnabled: boolean; tierAllowsReminders: boolean };
} {
  const captured: Captured[] = [];
  const state = { ...initial };

  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    captured.push({ url, init: init ?? undefined });
    if (url.includes('/settings/sms') && (init?.method === undefined || init.method === 'GET')) {
      return new Response(JSON.stringify(state), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes('/settings/sms') && init?.method === 'POST') {
      const body = JSON.parse(init.body as string) as { remindersEnabled: boolean };
      if (body.remindersEnabled && !state.tierAllowsReminders) {
        return new Response(
          JSON.stringify({ error: 'tier_gated', reason: 'tier_gated', message: 'Upgrade.' }),
          { status: 403, headers: { 'content-type': 'application/json' } },
        );
      }
      state.remindersEnabled = body.remindersEnabled;
      return new Response(JSON.stringify(state), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  return { captured, state };
}

function renderApp(): { user: ReturnType<typeof userEvent.setup> } {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/settings/sms']}>
        <Routes>
          <Route path="/settings/sms" element={<SettingsSmsRoute />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user: userEvent.setup() };
}

describe('SettingsSmsRoute', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders with the current toggle state from the API', async () => {
    setupFetchMock({ remindersEnabled: true, tierAllowsReminders: true });
    renderApp();
    await waitFor(() => {
      expect(screen.getByRole('switch')).toBeInTheDocument();
    });
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
  });

  it('toggling posts to the API and reflects the new state', async () => {
    const { captured } = setupFetchMock({
      remindersEnabled: false,
      tierAllowsReminders: true,
    });
    const { user } = renderApp();
    await waitFor(() => {
      expect(screen.getByRole('switch')).toBeInTheDocument();
    });

    await act(async () => {
      await user.click(screen.getByRole('switch'));
    });

    await waitFor(() => {
      const post = captured.find((c) => c.init?.method === 'POST');
      expect(post).toBeDefined();
      const body = JSON.parse(post!.init!.body as string) as { remindersEnabled: boolean };
      expect(body.remindersEnabled).toBe(true);
    });
    await waitFor(() => {
      expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
    });
  });

  it('Starter shows upgrade nudge and the switch is disabled', async () => {
    setupFetchMock({ remindersEnabled: false, tierAllowsReminders: false });
    renderApp();
    await waitFor(() => {
      expect(screen.getByText(/Upgrade to Pro to enable SMS reminders\./i)).toBeInTheDocument();
    });
    expect(screen.getByRole('switch')).toBeDisabled();
  });
});
