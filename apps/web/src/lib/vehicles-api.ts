import type {
  VehicleCreateRequest,
  VehicleListResponse,
  VehicleMutationResponse,
  VehicleUpdateRequest,
} from '@mygroomtime/shared';
import { apiFetch, type ApiError } from './api.js';

type Result<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export async function listVehicles(
  includeDeleted = false,
): Promise<Result<VehicleListResponse>> {
  const qs = includeDeleted ? '?includeDeleted=1' : '';
  return apiFetch<VehicleListResponse>(`/vehicles${qs}`);
}

export async function createVehicle(
  payload: VehicleCreateRequest,
): Promise<Result<VehicleMutationResponse>> {
  return apiFetch<VehicleMutationResponse>('/vehicles', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateVehicle(
  id: string,
  payload: VehicleUpdateRequest,
): Promise<Result<VehicleMutationResponse>> {
  return apiFetch<VehicleMutationResponse>(`/vehicles/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function deleteVehicle(id: string): Promise<Result<void>> {
  return apiFetch<void>(`/vehicles/${id}`, { method: 'DELETE' });
}
