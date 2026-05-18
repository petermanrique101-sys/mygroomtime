import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { drainOfflineQueue } from './offline-replay';
import {
  __resetOfflineDbForTest,
  clear,
  enqueue,
  peekAll,
  type QueuedMutation,
} from './offline-queue';

const origFetch = globalThis.fetch;

function setOnline(value: boolean): void {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    get: () => value,
  });
}

function makeRow(overrides: Partial<QueuedMutation> = {}): QueuedMutation {
  return {
    id: overrides.id ?? '01900000-0000-7000-8000-000000000001',
    endpoint: overrides.endpoint ?? '/appointments/apt_1/status',
    method: overrides.method ?? 'PATCH',
    body: overrides.body ?? { status: 'started' },
    headers: overrides.headers ?? { 'x-mutation-id': overrides.id ?? 'na' },
    resourceType: overrides.resourceType ?? 'appointment',
    resourceId: null,
    createdAt: overrides.createdAt ?? Date.now(),
    attempts: overrides.attempts ?? 0,
    status: overrides.status ?? 'pending',
    lastError: null,
    conflictServerStatus: null,
    conflictServerBody: null,
    label: 'Mark started',
  };
}

describe('offline-replay.drainOfflineQueue', () => {
  beforeEach(() => {
    setOnline(true);
  });

  afterEach(async () => {
    globalThis.fetch = origFetch;
    await clear();
    __resetOfflineDbForTest();
    vi.useRealTimers();
  });

  it('200 → dequeues + invalidates the right TanStack queries', async () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({ appointment: { id: 'apt_1', status: 'started' } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    await enqueue(makeRow());
    await drainOfflineQueue(qc);

    expect(await peekAll()).toHaveLength(0);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['appointments'] });
  });

  it('4xx → marks the row as conflict with the server response', async () => {
    const qc = new QueryClient();
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({ error: 'invalid_transition', message: 'cannot start a completed appt' }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    await enqueue(makeRow());
    await drainOfflineQueue(qc);

    const after = await peekAll();
    expect(after).toHaveLength(1);
    expect(after[0]!.status).toBe('conflict');
    expect(after[0]!.conflictServerStatus).toBe(409);
  });

  it('5xx → bumps attempts and stays pending (eventually flips to conflict after 5)', async () => {
    const qc = new QueryClient();
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ error: 'gw', message: 'bad gateway' }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    // why: pre-seed at attempts=4 so a single failed retry tips it to MAX_ATTEMPTS (5)
    // and flips to conflict. We don't want to spin through 5 real backoffs in a unit
    // test — that's what the integration test is for.
    await enqueue(makeRow({ attempts: 4 }));
    await drainOfflineQueue(qc);

    const after = await peekAll();
    expect(after).toHaveLength(1);
    expect(after[0]!.status).toBe('conflict');
    expect(after[0]!.lastError).toContain('bad gateway');
  });

  it('processes in createdAt order (sortable UUIDv7)', async () => {
    const qc = new QueryClient();
    const order: string[] = [];
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      order.push(String(url));
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    await enqueue(makeRow({ id: '01900000-0000-7000-8000-000000000002', endpoint: '/b', createdAt: 200 }));
    await enqueue(makeRow({ id: '01900000-0000-7000-8000-000000000001', endpoint: '/a', createdAt: 100 }));
    await enqueue(makeRow({ id: '01900000-0000-7000-8000-000000000003', endpoint: '/c', createdAt: 300 }));

    await drainOfflineQueue(qc);

    expect(order.map((u) => new URL(u, 'http://x').pathname)).toEqual(['/a', '/b', '/c']);
  });
});
