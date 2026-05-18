import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CalendarRoute from './index';

type Captured = { url: string; init?: RequestInit | undefined };

const FIXED_NOW = new Date(2026, 4, 17, 8, 0, 0, 0);

function makeAppt(overrides: Partial<{ id: string; petName: string; serviceName: string; start: Date; durationMin: number; color: string }> = {}): Record<string, unknown> {
  const start = overrides.start ?? new Date(2026, 4, 17, 10, 0, 0, 0);
  const duration = overrides.durationMin ?? 90;
  return {
    id: overrides.id ?? 'appt-1',
    status: 'scheduled',
    start: start.toISOString(),
    end: new Date(start.getTime() + duration * 60_000).toISOString(),
    durationMin: duration,
    petId: 'pet-1',
    serviceId: 'svc-1',
    vehicleId: 'veh-1',
    groomerId: 'u-1',
    recurringSeriesId: null,
    recurringSeriesActive: null,
    serviceNameSnapshot: overrides.serviceName ?? 'Full Groom',
    servicePriceCentsSnapshot: 8500,
    serviceDepositCentsSnapshot: 2000,
    serviceColorSnapshot: overrides.color ?? '#2563eb',
    serviceDurationMinSnapshot: duration,
    addressOverride: null,
    notes: '',
    canceledAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    pet: { id: 'pet-1', name: overrides.petName ?? 'Buddy', breed: 'Golden Retriever' },
    client: {
      id: 'cli-1',
      name: 'Sarah Johnson',
      phone: '+19725550101',
      street: '3201 Coit Rd',
      city: 'Plano',
      state: 'TX',
      zip: '75093',
      lat: 33.0357,
      lng: -96.7894,
    },
  };
}

function makeClient(id: string, name: string, pets: { id: string; name: string }[]): Record<string, unknown> {
  return {
    id,
    name,
    phone: '+19725550101',
    email: null,
    street: '1 Test Rd',
    city: 'Plano',
    state: 'TX',
    zip: '75024',
    lat: 33.0,
    lng: -96.8,
    addressVerified: true,
    preferredGroomerId: null,
    notes: '',
    smsOptOut: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    pets: pets.map((p) => ({
      id: p.id,
      clientId: id,
      name: p.name,
      breed: 'Mix',
      weightLb: 40,
      coatType: 'short',
      temperamentNotes: '',
      preferredCutStyle: '',
      vaccinationExpiry: null,
      photoUrl: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })),
  };
}

function makeService(id: string, name: string): Record<string, unknown> {
  return {
    id,
    name,
    durationMin: 90,
    basePriceCents: 8500,
    depositCents: 2000,
    color: '#2563eb',
    active: true,
    deletedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

type Handlers = {
  appointments: Record<string, unknown>[];
  clients: Record<string, unknown>[];
  services: Record<string, unknown>[];
  buffers?: { appointmentId: string; beforeBufferMin: number; afterBufferMin: number }[];
  defaultBufferMin?: number;
  onPost?: (
    body: Record<string, unknown>,
  ) =>
    | { status: 201; data: Record<string, unknown> }
    | { status: 409; body: Record<string, unknown> };
  onPatch?: (
    id: string,
    body: Record<string, unknown>,
  ) =>
    | { status: 200; data: Record<string, unknown> }
    | { status: 409; body: Record<string, unknown> };
};

function setupFetchMock(h: Handlers): { captured: Captured[] } {
  const captured: Captured[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    captured.push({ url, init: init ?? undefined });
    const method = init?.method ?? 'GET';

    if (url.includes('/appointments/buffers') && method === 'GET') {
      return new Response(
        JSON.stringify({
          date: new Date(FIXED_NOW.getFullYear(), FIXED_NOW.getMonth(), FIXED_NOW.getDate()).toISOString(),
          defaultBufferMin: h.defaultBufferMin ?? 15,
          buffers: h.buffers ?? [],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url.includes('/appointments') && method === 'GET' && !url.match(/\/appointments\/[^?]+$/)) {
      return new Response(JSON.stringify({ appointments: h.appointments }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.endsWith('/clients') && method === 'GET') {
      return new Response(
        JSON.stringify({ clients: h.clients, total: h.clients.length, limit: 50, offset: 0 }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    const clientMatch = url.match(/\/clients\/([^/?]+)$/);
    if (clientMatch && method === 'GET') {
      const id = clientMatch[1]!;
      const full = h.clients.find((c) => (c as { id: string }).id === id);
      return new Response(JSON.stringify({ client: full ?? h.clients[0] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes('/services') && method === 'GET') {
      return new Response(JSON.stringify({ services: h.services }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.endsWith('/appointments') && method === 'POST') {
      const body = JSON.parse(init!.body as string) as Record<string, unknown>;
      const outcome = h.onPost
        ? h.onPost(body)
        : { status: 201 as const, data: makeAppt({ id: 'appt-new' }) };
      if (outcome.status === 409) {
        return new Response(JSON.stringify(outcome.body), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        });
      }
      h.appointments.push(outcome.data);
      return new Response(JSON.stringify({ appointment: outcome.data, warning: null }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    }
    const patchMatch = url.match(/\/appointments\/([^/?]+)$/);
    if (patchMatch && method === 'PATCH') {
      const id = patchMatch[1]!;
      const body = JSON.parse(init!.body as string) as Record<string, unknown>;
      const outcome = h.onPatch
        ? h.onPatch(id, body)
        : (() => {
            const existing = h.appointments.find(
              (a) => (a as { id: string }).id === id,
            ) as Record<string, unknown> | undefined;
            if (!existing) {
              return {
                status: 200 as const,
                data: makeAppt({ id }),
              };
            }
            const next = {
              ...existing,
              ...(typeof body.start === 'string' ? { start: body.start } : {}),
              ...(typeof body.notes === 'string' ? { notes: body.notes } : {}),
            };
            const idx = h.appointments.indexOf(existing);
            h.appointments[idx] = next;
            return { status: 200 as const, data: next };
          })();
      if (outcome.status === 409) {
        return new Response(JSON.stringify(outcome.body), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ appointment: outcome.data, warning: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  });
  return { captured };
}

function renderApp(): { user: ReturnType<typeof userEvent.setup> } {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/calendar']}>
        <Routes>
          <Route path="/calendar" element={<CalendarRoute />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user: userEvent.setup() };
}

describe('CalendarRoute drag-to-reschedule (day view)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(FIXED_NOW);
    vi.restoreAllMocks();
    localStorage.clear();
    localStorage.setItem('mgt.calendar.view', 'day');
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
    localStorage.clear();
  });

  async function lift(user: ReturnType<typeof userEvent.setup>, name: RegExp): Promise<void> {
    const block = await screen.findByRole('button', { name });
    block.focus();
    await act(async () => {
      await user.keyboard(' ');
    });
  }

  it('keyboard drag — 4 ArrowDowns moves the block 1 hour later, PATCH persists', async () => {
    const tenAm = new Date(2026, 4, 17, 10, 0, 0, 0);
    const appts = [makeAppt({ id: 'a1', petName: 'Buddy', start: tenAm })];
    const { captured } = setupFetchMock({
      appointments: appts,
      clients: [makeClient('cli-1', 'Sarah', [{ id: 'pet-1', name: 'Buddy' }])],
      services: [makeService('svc-1', 'Full Groom')],
      buffers: [{ appointmentId: 'a1', beforeBufferMin: 15, afterBufferMin: 15 }],
    });
    const { user } = renderApp();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Buddy.*Full Groom/i })).toBeInTheDocument();
    });

    await lift(user, /Buddy.*Full Groom/i);
    await act(async () => {
      await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}');
      await user.keyboard('{Enter}');
    });

    await waitFor(() => {
      const patch = captured.find(
        (c) => c.init?.method === 'PATCH' && /\/appointments\/a1$/.test(c.url),
      );
      expect(patch).toBeDefined();
      const body = JSON.parse(patch!.init!.body as string) as { start: string };
      const expected = new Date(tenAm.getTime() + 60 * 60_000).toISOString();
      expect(body.start).toBe(expected);
    });
  });

  it('drag into past — Escape after going up many slots; PATCH does NOT fire', async () => {
    const tenAm = new Date(2026, 4, 17, 10, 0, 0, 0);
    const appts = [makeAppt({ id: 'a1', petName: 'Buddy', start: tenAm })];
    const { captured } = setupFetchMock({
      appointments: appts,
      clients: [makeClient('cli-1', 'Sarah', [{ id: 'pet-1', name: 'Buddy' }])],
      services: [makeService('svc-1', 'Full Groom')],
      buffers: [{ appointmentId: 'a1', beforeBufferMin: 15, afterBufferMin: 15 }],
    });
    const { user } = renderApp();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Buddy.*Full Groom/i })).toBeInTheDocument(),
    );
    await lift(user, /Buddy.*Full Groom/i);
    await act(async () => {
      for (let i = 0; i < 20; i += 1) await user.keyboard('{ArrowUp}');
      await user.keyboard('{Enter}');
    });

    await waitFor(() => {
      expect(screen.getByText(/Can't move appointments into the past/i)).toBeInTheDocument();
    });
    const patch = captured.find((c) => c.init?.method === 'PATCH');
    expect(patch).toBeUndefined();
  });

  it('drop into a buffer zone — PATCH does NOT fire, toast names the neighbor', async () => {
    const tenAm = new Date(2026, 4, 17, 10, 0, 0, 0);
    const elevenAm = new Date(2026, 4, 17, 11, 0, 0, 0);
    const appts = [
      makeAppt({ id: 'a1', petName: 'Buddy', start: tenAm, durationMin: 30 }),
      makeAppt({ id: 'a2', petName: 'Daisy', start: elevenAm, durationMin: 30 }),
    ];
    const { captured } = setupFetchMock({
      appointments: appts,
      clients: [makeClient('cli-1', 'Sarah', [{ id: 'pet-1', name: 'Buddy' }])],
      services: [makeService('svc-1', 'Full Groom')],
      buffers: [
        { appointmentId: 'a1', beforeBufferMin: 15, afterBufferMin: 15 },
        { appointmentId: 'a2', beforeBufferMin: 30, afterBufferMin: 30 },
      ],
    });
    const { user } = renderApp();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Buddy.*Full Groom/i })).toBeInTheDocument(),
    );
    await lift(user, /Buddy.*Full Groom/i);
    await act(async () => {
      await user.keyboard('{ArrowDown}{ArrowDown}');
      await user.keyboard('{Enter}');
    });

    await waitFor(() => {
      expect(screen.getByText(/drive time from Daisy/i)).toBeInTheDocument();
    });
    expect(captured.find((c) => c.init?.method === 'PATCH')).toBeUndefined();
  });

  it('409 from API on a slot the client thought valid — block reverts, toast shows server reason', async () => {
    const tenAm = new Date(2026, 4, 17, 10, 0, 0, 0);
    const appts = [makeAppt({ id: 'a1', petName: 'Buddy', start: tenAm })];
    setupFetchMock({
      appointments: appts,
      clients: [makeClient('cli-1', 'Sarah', [{ id: 'pet-1', name: 'Buddy' }])],
      services: [makeService('svc-1', 'Full Groom')],
      buffers: [{ appointmentId: 'a1', beforeBufferMin: 15, afterBufferMin: 15 }],
      onPatch: () => ({
        status: 409,
        body: {
          error: 'appointment_conflict',
          message: "Can't move there — overlaps with another van's appointment.",
          reason: 'overlap',
          detail: {
            neighborAppointmentId: 'other',
            neighborPetName: 'Cooper',
            neighborStart: null,
            bufferMin: null,
          },
        },
      }),
    });
    const { user } = renderApp();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Buddy.*Full Groom/i })).toBeInTheDocument(),
    );
    await lift(user, /Buddy.*Full Groom/i);
    await act(async () => {
      await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}');
      await user.keyboard('{Enter}');
    });

    await waitFor(() => {
      expect(screen.getByText(/overlaps with another van's appointment/i)).toBeInTheDocument();
    });
  });

  it('renders existing block (smoke — non-drag behavior preserved)', async () => {
    setupFetchMock({
      appointments: [makeAppt({ petName: 'Buddy', serviceName: 'Full Groom' })],
      clients: [makeClient('cli-1', 'Sarah Johnson', [{ id: 'pet-1', name: 'Buddy' }])],
      services: [makeService('svc-1', 'Full Groom')],
      buffers: [{ appointmentId: 'appt-1', beforeBufferMin: 15, afterBufferMin: 15 }],
    });
    renderApp();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Buddy.*Full Groom/i })).toBeInTheDocument(),
    );
  });
});
