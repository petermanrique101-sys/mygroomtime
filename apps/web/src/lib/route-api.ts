import type {
  RouteApplyRequest,
  RouteApplyResponse,
  RouteOptimizeResponse,
} from '@mygroomtime/shared';
import { apiFetch, type ApiError } from './api.js';

type Result<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export async function getOptimizedRoute(
  dateIso: string,
  vehicleId?: string,
): Promise<Result<RouteOptimizeResponse>> {
  const params = new URLSearchParams({ date: dateIso });
  if (vehicleId) params.set('vehicleId', vehicleId);
  return apiFetch<RouteOptimizeResponse>(`/appointments/today/route?${params.toString()}`);
}

export async function applyOptimizedRoute(
  payload: RouteApplyRequest,
): Promise<Result<RouteApplyResponse>> {
  return apiFetch<RouteApplyResponse>('/appointments/today/route/apply', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
