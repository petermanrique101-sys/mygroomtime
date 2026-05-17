import type {
  ServiceInput,
  ServiceListResponse,
  ServiceMutationResponse,
  ServiceUpdate,
} from '@mygroomtime/shared';
import { apiFetch, type ApiError } from './api.js';

type Result<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export async function listServices(
  opts: { includeDeleted?: boolean } = {},
): Promise<Result<ServiceListResponse>> {
  const qs = opts.includeDeleted ? '?includeDeleted=true' : '';
  return apiFetch<ServiceListResponse>(`/services${qs}`);
}

export async function createService(
  payload: ServiceInput,
): Promise<Result<ServiceMutationResponse>> {
  return apiFetch<ServiceMutationResponse>('/services', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateService(
  id: string,
  payload: ServiceUpdate,
): Promise<Result<ServiceMutationResponse>> {
  return apiFetch<ServiceMutationResponse>(`/services/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function deleteService(id: string): Promise<Result<void>> {
  return apiFetch<void>(`/services/${id}`, { method: 'DELETE' });
}

export async function restoreService(
  id: string,
): Promise<Result<ServiceMutationResponse>> {
  return apiFetch<ServiceMutationResponse>(`/services/${id}/restore`, {
    method: 'POST',
  });
}
