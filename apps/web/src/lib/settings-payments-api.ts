import type {
  SettingsPaymentsOnboardResponse,
  SettingsPaymentsStatus,
} from '@mygroomtime/shared';
import { apiFetch, type ApiError } from './api.js';

type Result<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export async function fetchSettingsPayments(): Promise<Result<SettingsPaymentsStatus>> {
  return apiFetch<SettingsPaymentsStatus>('/settings/payments');
}

export async function onboardSettingsPayments(): Promise<
  Result<SettingsPaymentsOnboardResponse>
> {
  return apiFetch<SettingsPaymentsOnboardResponse>('/settings/payments/onboard', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}
