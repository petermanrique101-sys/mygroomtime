import type {
  RescheduleCommitRequest,
  RescheduleCommitResponse,
  RescheduleVerifyRequest,
  RescheduleVerifyResponse,
} from '@mygroomtime/shared';
import { apiFetch, type ApiError } from './api.js';

type Result<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export async function verifyRescheduleToken(
  payload: RescheduleVerifyRequest,
): Promise<Result<RescheduleVerifyResponse>> {
  return apiFetch<RescheduleVerifyResponse>('/public/reschedule/verify', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function commitReschedule(
  payload: RescheduleCommitRequest,
): Promise<Result<RescheduleCommitResponse>> {
  return apiFetch<RescheduleCommitResponse>('/public/reschedule/commit', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
