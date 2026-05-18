import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthSession } from '@mygroomtime/shared';
import PayrollRoute from './index';
import { AuthProvider } from '../../lib/auth-context';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeSession(plan: 'starter' | 'business'): AuthSession {
  return {
    user: { id: 'u1', email: 'owner@test', name: 'Owner', role: 'owner', tenantId: 't1' },
    tenant: {
      id: 't1',
      slug: 'plano-pup-spa',
      businessName: 'Plano Pup Spa',
      plan,
    },
  } as AuthSession;
}

function mockFetch(handler: (url: string) => unknown): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    const body = handler(url);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

function renderRoute(plan: 'starter' | 'business'): void {
  mockFetch((url) => {
    if (url.endsWith('/me')) return makeSession(plan);
    if (url.includes('/payroll/periods')) {
      return {
        kind: 'biweekly',
        periods: [
          {
            periodStart: '2026-05-04T00:00:00.000Z',
            periodEnd: '2026-05-18T00:00:00.000Z',
            kind: 'biweekly',
          },
          {
            periodStart: '2026-05-18T00:00:00.000Z',
            periodEnd: '2026-06-01T00:00:00.000Z',
            kind: 'biweekly',
          },
        ],
      };
    }
    if (url.includes('/payroll/splits')) {
      return {
        period: {
          periodStart: '2026-05-18T00:00:00.000Z',
          periodEnd: '2026-06-01T00:00:00.000Z',
          kind: 'biweekly',
        },
        rows: [
          {
            groomerId: 'u1',
            groomerEmail: 'maria@test',
            groomerName: 'Maria',
            appointmentsCompleted: 4,
            revenueCents: 30_000,
            tipsCents: 4_000,
            totalCents: 34_000,
          },
        ],
        totals: {
          appointmentsCompleted: 4,
          revenueCents: 30_000,
          tipsCents: 4_000,
          totalCents: 34_000,
        },
      };
    }
    return {};
  });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/payroll']}>
          <Routes>
            <Route path="/payroll" element={<PayrollRoute />} />
            <Route path="*" element={<div />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('Payroll route', () => {
  it('Business tenant: renders the table and a CSV download link', async () => {
    renderRoute('business');
    await waitFor(() => {
      expect(screen.getByTestId('payroll-table')).toBeTruthy();
    });
    expect(screen.getByText('Maria')).toBeTruthy();
    // why: $340.00 appears twice — once in the row, once in the totals footer
    expect(screen.getAllByText('$340.00').length).toBe(2);
    const link = screen.getByTestId('payroll-csv-download') as HTMLAnchorElement;
    expect(link.href).toContain('/payroll/splits.csv');
    expect(link.href).toContain('periodStart=');
  });

  it('Starter tenant: renders the upgrade upsell, not the table', async () => {
    renderRoute('starter');
    await waitFor(() => {
      expect(screen.getByText(/Business-tier feature/i)).toBeTruthy();
    });
    expect(screen.queryByTestId('payroll-table')).toBeNull();
  });
});
