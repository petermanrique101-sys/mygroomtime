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
  RecurringSeriesOutput,
} from '@mygroomtime/shared';
import { apiFetch, type ApiError } from './api.js';
import { mutate } from './offline-api';

type Result<T> = { ok: true; data: T } | { ok: false; error: ApiError };

// why: offline-aware wrapper. When online (and the request succeeds or returns 4xx) we
// behave exactly like apiFetch did before. When offline OR the network 5xxes, we enqueue
// and return an "optimistic" Result that the caller can treat as ok. The mutationId is
// surfaced on the data so TanStack mutations can hold the ID for follow-up correlation
// (e.g., to replace optimistic IDs once the real row lands after replay).
async function offlineAwareMutate<T>(opts: {
  endpoint: string;
  method: 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  resourceType: string;
  label: string;
  optimistic?: T;
}): Promise<Result<T>> {
  const outcome = await mutate<T>({
    endpoint: opts.endpoint,
    method: opts.method,
    body: opts.body,
    resourceType: opts.resourceType,
    label: opts.label,
    optimisticResponse: opts.optimistic,
  });
  if (outcome.ok) return { ok: true, data: outcome.data };
  return { ok: false, error: outcome.error };
}

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
  return offlineAwareMutate<AppointmentMutationResponse>({
    endpoint: '/appointments',
    method: 'POST',
    body: payload,
    resourceType: 'appointment',
    label: 'New appointment',
  });
}

export async function updateAppointment(
  id: string,
  payload: AppointmentUpdateRequest,
): Promise<Result<AppointmentMutationResponse>> {
  return offlineAwareMutate<AppointmentMutationResponse>({
    endpoint: `/appointments/${id}`,
    method: 'PATCH',
    body: payload,
    resourceType: 'appointment',
    label: 'Update appointment',
  });
}

export async function cancelAppointment(id: string): Promise<Result<void>> {
  return offlineAwareMutate<void>({
    endpoint: `/appointments/${id}`,
    method: 'DELETE',
    resourceType: 'appointment',
    label: 'Cancel appointment',
  });
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
  return offlineAwareMutate<AppointmentMutationResponse>({
    endpoint: `/appointments/${id}/status`,
    method: 'PATCH',
    body: payload,
    resourceType: 'appointment',
    label: `Mark ${payload.status.replace('_', ' ')}`,
  });
}

export async function completeAppointmentApi(
  id: string,
  payload: AppointmentCompleteRequest,
): Promise<Result<AppointmentCompleteResponse>> {
  return offlineAwareMutate<AppointmentCompleteResponse>({
    endpoint: `/appointments/${id}/complete`,
    method: 'POST',
    body: payload,
    resourceType: 'appointment',
    label: 'Mark complete',
  });
}

export async function rebookAppointment(
  id: string,
  payload: AppointmentRebookRequest,
): Promise<Result<AppointmentRebookResponse>> {
  return offlineAwareMutate<AppointmentRebookResponse>({
    endpoint: `/appointments/${id}/rebook`,
    method: 'POST',
    body: payload,
    resourceType: 'appointment',
    label: 'Rebook',
  });
}

export async function pauseRecurringSeries(
  seriesId: string,
): Promise<Result<{ series: RecurringSeriesOutput }>> {
  return offlineAwareMutate<{ series: RecurringSeriesOutput }>({
    endpoint: `/recurring-series/${seriesId}/pause`,
    method: 'POST',
    resourceType: 'recurring_series',
    label: 'Pause series',
  });
}

export async function resumeRecurringSeries(
  seriesId: string,
): Promise<Result<{ series: RecurringSeriesOutput }>> {
  return offlineAwareMutate<{ series: RecurringSeriesOutput }>({
    endpoint: `/recurring-series/${seriesId}/resume`,
    method: 'POST',
    resourceType: 'recurring_series',
    label: 'Resume series',
  });
}
