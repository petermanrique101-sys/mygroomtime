import type { QueryClient } from '@tanstack/react-query';
import {
  attachConflictDetails,
  dequeue,
  markFailed,
  markPending,
  markSyncing,
  peekAll,
  type QueuedMutation,
} from './offline-queue';
import { notifyOfflineQueueChanged } from './offline-bus';
import { apiFetch } from './api';

const MAX_ATTEMPTS = 5;
// why: exponential backoff in seconds — 1, 2, 4, 8, 16. The 5th attempt waits 16s then if
// it still 5xxes we flip to conflict so the user sees it.
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000];

let running = false;
let queuedAnother = false;

function backoffFor(attempts: number): number {
  return BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)] ?? 16_000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function invalidateForResourceType(qc: QueryClient, resourceType: string): void {
  // why: don't be clever. After a successful replay just nuke the keys that could be
  // stale and let TanStack refetch when each consumer next mounts/focuses.
  if (resourceType === 'appointment' || resourceType === 'route_apply') {
    void qc.invalidateQueries({ queryKey: ['appointments'] });
    void qc.invalidateQueries({ queryKey: ['appointment-buffers'] });
  } else if (resourceType === 'client' || resourceType === 'pet') {
    void qc.invalidateQueries({ queryKey: ['clients'] });
  } else if (resourceType === 'service') {
    void qc.invalidateQueries({ queryKey: ['services'] });
  } else if (resourceType === 'recurring_series') {
    void qc.invalidateQueries({ queryKey: ['appointments'] });
  }
}

async function attemptOne(qc: QueryClient, m: QueuedMutation): Promise<void> {
  await markSyncing(m.id);
  notifyOfflineQueueChanged();
  const init: RequestInit = {
    method: m.method,
    headers: m.headers,
  };
  if (m.body !== null && m.body !== undefined) {
    init.body = typeof m.body === 'string' ? m.body : JSON.stringify(m.body);
  }
  const result = await apiFetch<unknown>(m.endpoint, init);
  if (result.ok) {
    await dequeue(m.id);
    invalidateForResourceType(qc, m.resourceType);
    return;
  }
  const status = result.error.status;
  if (status >= 400 && status < 500) {
    await attachConflictDetails(m.id, status, result.error);
    return;
  }
  // why: 5xx or network error → backoff + retry. We bump attempts immediately so the next
  // pass through the queue accounts for the failed try. After MAX_ATTEMPTS we surface as
  // conflict so it doesn't loop forever.
  const nextAttempts = m.attempts + 1;
  if (nextAttempts >= MAX_ATTEMPTS) {
    await markFailed(m.id, result.error.message);
    return;
  }
  await markPending(m.id, nextAttempts, result.error.message);
  await sleep(backoffFor(nextAttempts));
}

export async function drainOfflineQueue(qc: QueryClient): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  if (running) {
    queuedAnother = true;
    return;
  }
  running = true;
  try {
    let didWork = true;
    while (didWork) {
      didWork = false;
      const all = await peekAll();
      // why: peekAll is index-by-createdAt order = UUIDv7 timestamp prefix order = the
      // order the user made the changes. Server-side this matters because mutations on
      // the same appointment are causally linked (started before completed). We process
      // sequentially, not in parallel, to keep cause-and-effect intact on the wire.
      for (const m of all) {
        if (m.status === 'conflict') continue;
        await attemptOne(qc, m);
        didWork = true;
        notifyOfflineQueueChanged();
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          // why: went offline mid-drain. Abort and let the next online event resume.
          return;
        }
      }
      if (queuedAnother) {
        queuedAnother = false;
        didWork = true;
      }
    }
  } finally {
    running = false;
  }
}

let bound = false;

export function startOfflineReplay(qc: QueryClient): void {
  if (bound) return;
  bound = true;
  if (typeof window === 'undefined') return;
  window.addEventListener('online', () => {
    void drainOfflineQueue(qc);
  });
  // why: also trigger on initial mount in case a refresh landed offline and the queue
  // accumulated work that hasn't been replayed.
  void drainOfflineQueue(qc);
}
