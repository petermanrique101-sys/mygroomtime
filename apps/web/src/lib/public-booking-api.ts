import type {
  PublicAvailabilityResponse,
  PublicBookingStatusResponse,
  PublicBookingSubmitRequest,
  PublicBookingSubmitResponse,
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

export async function submitPublicBooking(
  slug: string,
  payload: PublicBookingSubmitRequest,
): Promise<Result<PublicBookingSubmitResponse>> {
  return apiFetch<PublicBookingSubmitResponse>(
    `/public/${encodeURIComponent(slug)}/bookings`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
}

export async function fetchPublicBookingStatus(
  slug: string,
  requestId: string,
): Promise<Result<PublicBookingStatusResponse>> {
  return apiFetch<PublicBookingStatusResponse>(
    `/public/${encodeURIComponent(slug)}/bookings/${encodeURIComponent(requestId)}/status`,
  );
}

export async function twinConfirmPublicBooking(
  slug: string,
  requestId: string,
): Promise<Result<{ status: string }>> {
  return apiFetch<{ status: string }>(
    `/public/${encodeURIComponent(slug)}/bookings/${encodeURIComponent(requestId)}/twin-confirm`,
    { method: 'POST', body: JSON.stringify({}) },
  );
}
