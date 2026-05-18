/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ revision: string | null; url: string }>;
};

// why: workbox-injectManifest replaces this manifest at build time with the actual app
// shell. Precaching the shell keeps the day view openable from a homescreen icon while
// fully offline.
precacheAndRoute(self.__WB_MANIFEST);

const API_BASE = self.location.origin.replace(/:\d+$/, ':3000');

// why: runtime cache for today's READ surface. Chunk 18 spec limits this to:
//   /me, /appointments?date=today, /appointments/buffers?date=today, /services, /clients
// Each query is NetworkFirst (try the wire, fall back to cached) with a 5-minute fresh
// window. We don't cache arbitrary date-range queries — only the day view is the offline
// target, per the chunk-18 spec.
const FIVE_MIN = 5 * 60;

registerRoute(
  ({ url, request }) =>
    request.method === 'GET' &&
    (url.origin === API_BASE || url.origin === self.location.origin) &&
    /^\/(appointments|services|clients|me)(\/|\?|$)/.test(url.pathname),
  new NetworkFirst({
    cacheName: 'mgt-today-api-v1',
    networkTimeoutSeconds: 4,
    plugins: [
      new ExpirationPlugin({
        maxEntries: 50,
        maxAgeSeconds: FIVE_MIN,
      }),
    ],
  }),
);

registerRoute(
  ({ url, request }) =>
    request.method === 'GET' &&
    (url.origin === self.location.origin) &&
    /\.(?:css|js|woff2?)$/.test(url.pathname),
  new StaleWhileRevalidate({
    cacheName: 'mgt-static-v1',
  }),
);

// why: Background Sync registration on Chrome/Edge. The app posts a 'replay-offline-queue'
// tag whenever it queues a mutation while offline. When the device comes back online the
// browser wakes our SW to re-fire the tag — we forward it to clients so the app's replay
// runner does the actual draining (it owns the IndexedDB + TanStack QueryClient).
self.addEventListener('sync', (event: Event) => {
  const e = event as ExtendableEvent & { tag?: string };
  if (e.tag === 'replay-offline-queue') {
    e.waitUntil(broadcastReplay());
  }
});

async function broadcastReplay(): Promise<void> {
  const clientsList = await self.clients.matchAll({ includeUncontrolled: true });
  for (const client of clientsList) {
    client.postMessage({ type: 'replay-offline-queue' });
  }
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
