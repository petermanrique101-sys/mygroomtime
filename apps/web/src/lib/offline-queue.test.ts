import { afterEach, describe, expect, it } from 'vitest';
import {
  __resetOfflineDbForTest,
  attachConflictDetails,
  clear,
  dequeue,
  enqueue,
  markFailed,
  markPending,
  markSyncing,
  peekAll,
  type QueuedMutation,
} from './offline-queue';
import { uuidv7 } from './uuid-v7';

function makeRow(overrides: Partial<QueuedMutation> = {}): QueuedMutation {
  return {
    id: overrides.id ?? uuidv7(),
    endpoint: overrides.endpoint ?? '/appointments',
    method: overrides.method ?? 'POST',
    body: overrides.body ?? { petId: 'p1', serviceId: 's1', start: '2026-05-20T15:00:00Z' },
    headers: overrides.headers ?? { 'x-mutation-id': overrides.id ?? 'na' },
    resourceType: overrides.resourceType ?? 'appointment',
    resourceId: overrides.resourceId ?? null,
    createdAt: overrides.createdAt ?? Date.now(),
    attempts: overrides.attempts ?? 0,
    status: overrides.status ?? 'pending',
    lastError: overrides.lastError ?? null,
    conflictServerStatus: overrides.conflictServerStatus ?? null,
    conflictServerBody: overrides.conflictServerBody ?? null,
    label: overrides.label ?? 'New appointment',
  };
}

describe('offline-queue', () => {
  afterEach(async () => {
    await clear();
    __resetOfflineDbForTest();
  });

  it('enqueue then peekAll returns the row', async () => {
    const row = makeRow();
    await enqueue(row);
    const all = await peekAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.id).toBe(row.id);
    expect(all[0]!.endpoint).toBe('/appointments');
  });

  it('peekAll returns rows in createdAt order', async () => {
    const a = makeRow({ createdAt: 100 });
    const b = makeRow({ createdAt: 200 });
    const c = makeRow({ createdAt: 150 });
    await enqueue(b);
    await enqueue(a);
    await enqueue(c);
    const all = await peekAll();
    expect(all.map((r) => r.createdAt)).toEqual([100, 150, 200]);
  });

  it('dequeue removes the row', async () => {
    const row = makeRow();
    await enqueue(row);
    await dequeue(row.id);
    expect(await peekAll()).toHaveLength(0);
  });

  it('markFailed flips status to conflict and records reason', async () => {
    const row = makeRow();
    await enqueue(row);
    await markFailed(row.id, 'gateway timed out');
    const all = await peekAll();
    expect(all[0]!.status).toBe('conflict');
    expect(all[0]!.lastError).toBe('gateway timed out');
  });

  it('markSyncing then markPending tracks attempts', async () => {
    const row = makeRow();
    await enqueue(row);
    await markSyncing(row.id);
    expect((await peekAll())[0]!.status).toBe('syncing');
    await markPending(row.id, 2, '502 bad gateway');
    const after = (await peekAll())[0]!;
    expect(after.status).toBe('pending');
    expect(after.attempts).toBe(2);
    expect(after.lastError).toBe('502 bad gateway');
  });

  it('attachConflictDetails stores the server snapshot', async () => {
    const row = makeRow();
    await enqueue(row);
    await attachConflictDetails(row.id, 409, { error: 'appointment_conflict', message: 'slot taken' });
    const after = (await peekAll())[0]!;
    expect(after.status).toBe('conflict');
    expect(after.conflictServerStatus).toBe(409);
    expect(after.conflictServerBody).toEqual({
      error: 'appointment_conflict',
      message: 'slot taken',
    });
  });

  it('survives a fresh DB connection (simulates app restart)', async () => {
    const row = makeRow();
    await enqueue(row);
    __resetOfflineDbForTest();
    const all = await peekAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.id).toBe(row.id);
  });
});
