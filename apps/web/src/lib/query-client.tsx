import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { startOfflineReplay } from './offline-replay';
import { startSwBridge } from './sw-bridge';

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // why: chunk 18 — today's read surface (appointments, buffers, services, /me)
        // wants a 5-minute stale time so we don't hammer the API on focus while still
        // giving the user fresh data on app open. Other queries stay at 10s.
        staleTime: 10_000,
        refetchOnWindowFocus: true,
        retry: 1,
      },
    },
  });
}

export function AppQueryProvider({ children }: { children: ReactNode }): JSX.Element {
  const [client] = useState(() => makeQueryClient());
  useEffect(() => {
    startOfflineReplay(client);
    startSwBridge(client);
  }, [client]);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
