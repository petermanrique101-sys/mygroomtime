import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mutate, MUTATION_HEADER } from './offline-api';
import { __resetOfflineDbForTest, clear, peekAll } from './offline-queue';

const origFetch = globalThis.fetch;

function setOnline(value: boolean): void {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    get: () => value,
  });
}

describe('offline-api.mutate', () => {
  beforeEach(() => {
    setOnline(true);
  });

  afterEach(async () => {
    globalThis.fetch = origFetch;
    await clear();
    __resetOfflineDbForTest();
    setOnline(true);
  });

  it('online path sends with X-Mutation-Id header and returns server data', async () => {
    let capturedHeaders: Headers | null = null;
    globalThis.fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({ appointment: { id: 'apt_1' } }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const outcome = await mutate<{ appointment: { id: string } }>({
      endpoint: '/appointments',
      method: 'POST',
      body: { petId: 'p', serviceId: 's', start: '2026-05-20T10:00:00Z' },
      resourceType: 'appointment',
      label: 'New appointment',
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.offline).toBe(false);
    expect(outcome.data.appointment.id).toBe('apt_1');
    expect(capturedHeaders).not.toBeNull();
    expect(capturedHeaders!.get(MUTATION_HEADER)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    expect(await peekAll()).toHaveLength(0);
  });

  it('offline path enqueues and returns the optimistic ack without calling fetch', async () => {
    setOnline(false);
    const f = vi.fn();
    globalThis.fetch = f as unknown as typeof fetch;

    const outcome = await mutate({
      endpoint: '/appointments/apt_2/status',
      method: 'PATCH',
      body: { status: 'started' },
      resourceType: 'appointment',
      label: 'Mark started',
      optimisticResponse: { ok: true },
    });

    expect(f).not.toHaveBeenCalled();
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.offline).toBe(true);
    if (!outcome.offline) return;
    const queued = await peekAll();
    expect(queued).toHaveLength(1);
    expect(queued[0]!.method).toBe('PATCH');
    expect(queued[0]!.endpoint).toBe('/appointments/apt_2/status');
    expect(queued[0]!.headers[MUTATION_HEADER]).toBe(outcome.mutationId);
    expect(queued[0]!.label).toBe('Mark started');
  });

  it('5xx response queues for retry instead of returning the error', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ error: 'internal', message: 'boom' }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const outcome = await mutate({
      endpoint: '/appointments',
      method: 'POST',
      body: { petId: 'p', serviceId: 's', start: '2026-05-20T10:00:00Z' },
      resourceType: 'appointment',
      label: 'New appointment',
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.offline).toBe(true);
    expect((await peekAll())).toHaveLength(1);
  });

  it('4xx response propagates to caller without queueing', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({ error: 'invalid_request', message: 'bad start' }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const outcome = await mutate({
      endpoint: '/appointments',
      method: 'POST',
      body: { petId: 'p', serviceId: 's', start: 'nope' },
      resourceType: 'appointment',
      label: 'New appointment',
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.status).toBe(400);
    expect(await peekAll()).toHaveLength(0);
  });
});
