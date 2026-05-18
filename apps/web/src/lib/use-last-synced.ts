import { useEffect, useMemo, useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';

// why: TanStack Query exposes `dataUpdatedAt` (ms epoch) on a query result, which is the
// timestamp of the most recent successful fetch. Combined with `isStale` + navigator.onLine
// we can render a "Last synced N min ago" hint when the day view is showing cached data
// because the user is offline. Hint is only shown when offline; online it's silent.

export function useLastSyncedLabel<T, E>(query: UseQueryResult<T, E>): string | null {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  return useMemo(() => {
    const updatedAt = query.dataUpdatedAt;
    if (!updatedAt) return null;
    const online = typeof navigator === 'undefined' || navigator.onLine !== false;
    if (online) return null;
    const ageMin = Math.max(0, Math.floor((now - updatedAt) / 60_000));
    if (ageMin <= 0) return 'Last synced just now';
    if (ageMin === 1) return 'Last synced 1 min ago';
    if (ageMin < 60) return `Last synced ${ageMin} min ago`;
    const hrs = Math.floor(ageMin / 60);
    return `Last synced ${hrs}h ago`;
  }, [query.dataUpdatedAt, now]);
}
