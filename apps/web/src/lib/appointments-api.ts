import type {
  AppointmentBuffersResponse,
  AppointmentCompleteRequest,
  AppointmentCompleteResponse,
  AppointmentCreateRequest,
  AppointmentListResponse,
  AppointmentMutationResponse,
  AppointmentOutput,
  AppointmentRebookRequest,
  AppointmentRebookResponse,
  AppointmentStatusUpdateRequest,
  AppointmentUpdateRequest,
} from '@mygroomtime/shared';
import { apiFetch, type ApiError } from './api.js';

type Result<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export async function listAppointments(
  fromIso: string,
  toIso: string,
): Promise<Result<AppointmentListResponse>> {
  const qs = `?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`;
  return apiFetch<AppointmentListResponse>(`/appointments${qs}`);
}

export async function getAppointment(
  id: string,
): Promise<Result<{ appointment: AppointmentOutput }>> {
  return apiFetch<{ appointment: AppointmentOutput }>(`/appointments/${id}`);
}

export async function createAppointment(
  payload: AppointmentCreateRequest,
): Promise<Result<AppointmentMutationResponse>> {
  return apiFetch<AppointmentMutationResponse>('/appointments', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateAppointment(
  id: string,
  payload: AppointmentUpdateRequest,
): Promise<Result<AppointmentMutationResponse>> {
  return apiFetch<AppointmentMutationResponse>(`/appointments/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function cancelAppointment(id: string): Promise<Result<void>> {
  return apiFetch<void>(`/appointments/${id}`, { method: 'DELETE' });
}

export async function getDayBuffers(
  dateIso: string,
): Promise<Result<AppointmentBuffersResponse>> {
  const qs = `?date=${encodeURIComponent(dateIso)}`;
  return apiFetch<AppointmentBuffersResponse>(`/appointments/buffers${qs}`);
}

export async function patchAppointmentStatus(
  id: string,
  payload: AppointmentStatusUpdateRequest,
): Promise<Result<AppointmentMutationResponse>> {
  return apiFetch<AppointmentMutationResponse>(`/appointments/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function completeAppointmentApi(
  id: string,
  payload: AppointmentCompleteRequest,
): Promise<Result<AppointmentCompleteResponse>> {
  return apiFetch<AppointmentCompleteResponse>(`/appointments/${id}/complete`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function rebookAppointment(
  id: string,
  payload: AppointmentRebookRequest,
): Promise<Result<AppointmentRebookResponse>> {
  return apiFetch<AppointmentRebookResponse>(`/appointments/${id}/rebook`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
