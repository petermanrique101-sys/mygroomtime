import { useQuery } from '@tanstack/react-query';
import type { PublicTenantResponse } from '@mygroomtime/shared';
import { fetchPublicTenant } from '../../lib/public-booking-api';

export const PUBLIC_TENANT_QUERY_KEY = (slug: string) => ['public-tenant', slug] as const;

export type PublicTenantQuery = ReturnType<typeof usePublicTenant>;

export function usePublicTenant(slug: string) {
  return useQuery<PublicTenantResponse, Error>({
    queryKey: PUBLIC_TENANT_QUERY_KEY(slug),
    queryFn: async () => {
      const res = await fetchPublicTenant(slug);
      if (!res.ok) {
        const err = new Error(res.error.message) as Error & { status?: number };
        err.status = res.error.status;
        throw err;
      }
      return res.data;
    },
    retry: (failureCount, err) => {
      const status = (err as Error & { status?: number }).status;
      if (status === 404) return false;
      return failureCount < 1;
    },
    staleTime: 60_000,
  });
}
