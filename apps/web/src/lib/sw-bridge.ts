// why: the service worker's Background Sync event handler posts a message back to all
// open clients when it fires. We listen for that message in the main thread and trigger a
// drain. This way the IndexedDB queue + TanStack invalidation stay in the main thread
// where they belong; the SW just plays the "wake the app" role.

import type { QueryClient } from '@tanstack/react-query';
import { drainOfflineQueue } from './offline-replay';

let bound = false;

export function startSwBridge(qc: QueryClient): void {
  if (bound) return;
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) return;
  bound = true;
  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event.data as { type?: string } | undefined;
    if (data?.type === 'replay-offline-queue') {
      void drainOfflineQueue(qc);
    }
  });
}

// why: opportunistic Background Sync registration. Chromium-based browsers expose this on
// ServiceWorkerRegistration. Safari + Firefox don't; we silently no-op and fall back to
// the foreground 'online' event in offline-replay.ts.
export async function requestBackgroundSync(): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const r = reg as ServiceWorkerRegistration & {
      sync?: { register: (tag: string) => Promise<void> };
    };
    if (r.sync) await r.sync.register('replay-offline-queue');
  } catch {
    // why: feature-detection failure path. Safari throws; ignore and fall back.
  }
}
