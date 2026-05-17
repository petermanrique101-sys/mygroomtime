import type {
  PublicAvailabilityResponse,
  PublicTenantResponse,
} from '@mygroomtime/shared';
import { apiFetch, type ApiError } from './api.js';

type Result<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export async function fetchPublicTenant(slug: string): Promise<Result<PublicTenantResponse>> {
  return apiFetch<PublicTenantResponse>(`/public/${encodeURIComponent(slug)}`);
}

export async function fetchPublicAvailability(
  slug: string,
  args: { serviceId: string; date: string },
): Promise<Result<PublicAvailabilityResponse>> {
  const qs = new URLSearchParams({
    serviceId: args.serviceId,
    date: args.date,
  });
  return apiFetch<PublicAvailabilityResponse>(
    `/public/${encodeURIComponent(slug)}/availability?${qs.toString()}`,
  );
}
