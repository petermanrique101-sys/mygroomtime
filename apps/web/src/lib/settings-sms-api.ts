import type { SettingsSmsStatus } from '@mygroomtime/shared';
import { apiFetch, type ApiError } from './api.js';

type Result<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export async function fetchSettingsSms(): Promise<Result<SettingsSmsStatus>> {
  return apiFetch<SettingsSmsStatus>('/settings/sms');
}

export async function updateSettingsSms(
  remindersEnabled: boolean,
): Promise<Result<SettingsSmsStatus>> {
  return apiFetch<SettingsSmsStatus>('/settings/sms', {
    method: 'POST',
    body: JSON.stringify({ remindersEnabled }),
  });
}
