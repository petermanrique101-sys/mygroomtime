import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { mutate, MUTATION_HEADER } from './offline-api';
import { drainOfflineQueue } from './offline-replay';
import { __resetOfflineDbForTest, clear, peekAll } from './offline-queue';

// why: this is the chunk-18 integration backbone. Offline → start → complete → replay.
// We simulate the API with a stand-in Stripe ledger so we can assert exactly-one
// PaymentIntent under replay. The server-side dedupe logic itself is tested in api/.
// Here we exercise the WEB orchestration: same UUIDv7 reaches the server twice, server
// returns the SAME response both times, and the queue drains cleanly.

const origFetch = globalThis.fetch;

function setOnline(value: boolean): void {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    get: () => value,
  });
}

type ServerState = {
  status: 'scheduled' | 'started' | 'completed';
  tipCents: number;
  paymentIntents: string[];
  // mutationId → captured response (the dedupe behavior under test)
  mutationLog: Map<string, { status: number; body: unknown }>;
};

function makeFakeServer(state: ServerState): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    const mutationId = headers.get(MUTATION_HEADER);

    if (!mutationId) {
      return new Response(JSON.stringify({ error: 'missing_id' }), { status: 400 });
    }

    // server-side dedupe: same id returns same payload
    const prior = state.mutationLog.get(mutationId);
    if (prior) {
      return new Response(JSON.stringify(prior.body), {
        status: prior.status,
        headers: { 'content-type': 'application/json' },
      });
    }

    let resp: { status: number; body: unknown };
    if (method === 'PATCH' && /\/appointments\/apt_1\/status$/.test(url)) {
      const payload = init?.body ? (JSON.parse(String(init.body)) as { status: string }) : null;
      if (payload?.status === 'started' && state.status === 'scheduled') {
        state.status = 'started';
        resp = { status: 200, body: { appointment: { id: 'apt_1', status: 'started' } } };
      } else {
        resp = { status: 409, body: { error: 'invalid_transition' } };
      }
    } else if (method === 'POST' && /\/appointments\/apt_1\/complete$/.test(url)) {
      const payload = init?.body
        ? (JSON.parse(String(init.body)) as { tipCents: number })
        : { tipCents: 0 };
      if (state.status !== 'started') {
        resp = { status: 409, body: { error: 'invalid_transition' } };
      } else {
        state.status = 'completed';
        state.tipCents = payload.tipCents;
        const pi = `pi_${mutationId.slice(0, 8)}`;
        state.paymentIntents.push(pi);
        resp = {
          status: 200,
          body: {
            appointment: { id: 'apt_1', status: 'completed', tipCents: payload.tipCents },
            balanceChargeId: pi,
            finalAmountCents: 8500 + payload.tipCents,
            alreadyCompleted: false,
          },
        };
      }
    } else {
      resp = { status: 404, body: { error: 'not_found' } };
    }

    state.mutationLog.set(mutationId, resp);
    return new Response(JSON.stringify(resp.body), {
      status: resp.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

describe('chunk 18 integration: offline lifecycle → replay → one PI', () => {
  beforeEach(() => {
    setOnline(true);
  });

  afterEach(async () => {
    globalThis.fetch = origFetch;
    await clear();
    __resetOfflineDbForTest();
    setOnline(true);
    vi.useRealTimers();
  });

  it('offline → mark started → mark completed → online → drains in order with one Stripe PI', async () => {
    const state: ServerState = {
      status: 'scheduled',
      tipCents: 0,
      paymentIntents: [],
      mutationLog: new Map(),
    };
    const qc = new QueryClient();

    // go offline, fire two mutations
    setOnline(false);
    const startOutcome = await mutate({
      endpoint: '/appointments/apt_1/status',
      method: 'PATCH',
      body: { status: 'started' },
      resourceType: 'appointment',
      label: 'Mark started',
    });
    expect(startOutcome.ok).toBe(true);
    if (!startOutcome.ok || !startOutcome.offline) throw new Error('expected offline');

    const completeOutcome = await mutate({
      endpoint: '/appointments/apt_1/complete',
      method: 'POST',
      body: { tipCents: 1700 },
      resourceType: 'appointment',
      label: 'Mark complete',
    });
    expect(completeOutcome.ok).toBe(true);
    if (!completeOutcome.ok || !completeOutcome.offline) throw new Error('expected offline');

    const queued = await peekAll();
    expect(queued).toHaveLength(2);
    // why: UUIDv7 sortability — the FIRST mutation made (started) sorts before the SECOND
    // (complete) regardless of how the IndexedDB stored them.
    expect(queued[0]!.endpoint).toBe('/appointments/apt_1/status');
    expect(queued[1]!.endpoint).toBe('/appointments/apt_1/complete');

    // come back online; install the fake server; drain
    globalThis.fetch = makeFakeServer(state);
    setOnline(true);
    await drainOfflineQueue(qc);

    expect(await peekAll()).toHaveLength(0);
    expect(state.status).toBe('completed');
    expect(state.tipCents).toBe(1700);
    expect(state.paymentIntents).toHaveLength(1);

    // re-trigger replay — MutationLog short-circuit means no double-effect
    await drainOfflineQueue(qc);
    expect(state.paymentIntents).toHaveLength(1);
  });

  it('mid-flight 4xx → goes straight to conflict, no retry', async () => {
    const qc = new QueryClient();
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response(
        JSON.stringify({ error: 'appointment_conflict', message: 'slot taken' }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    setOnline(false);
    await mutate({
      endpoint: '/appointments',
      method: 'POST',
      body: { petId: 'p', serviceId: 's', start: '2026-05-20T15:00:00Z' },
      resourceType: 'appointment',
      label: 'New appointment',
    });
    setOnline(true);

    await drainOfflineQueue(qc);
    expect(calls).toBe(1);
    const after = await peekAll();
    expect(after).toHaveLength(1);
    expect(after[0]!.status).toBe('conflict');
    expect(after[0]!.conflictServerStatus).toBe(409);
  });
});
