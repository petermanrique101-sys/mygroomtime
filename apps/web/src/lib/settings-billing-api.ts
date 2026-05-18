import type {
  ChangePlanResponse,
  PaidPlanTier,
  PortalSessionResponse,
  PreviewPlanChangeResponse,
  SettingsBillingResponse,
} from '@mygroomtime/shared';
import { apiFetch, type ApiError } from './api.js';

type Result<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export async function fetchSettingsBilling(): Promise<Result<SettingsBillingResponse>> {
  return apiFetch<SettingsBillingResponse>('/settings/billing');
}

export async function previewPlanChange(
  targetPlan: PaidPlanTier,
): Promise<Result<PreviewPlanChangeResponse>> {
  return apiFetch<PreviewPlanChangeResponse>('/settings/billing/preview-plan-change', {
    method: 'POST',
    body: JSON.stringify({ targetPlan }),
  });
}

export async function confirmPlanChange(
  targetPlan: PaidPlanTier,
): Promise<Result<ChangePlanResponse>> {
  return apiFetch<ChangePlanResponse>('/settings/billing/change-plan', {
    method: 'POST',
    body: JSON.stringify({ targetPlan }),
  });
}

export async function openPortalSession(): Promise<Result<PortalSessionResponse>> {
  return apiFetch<PortalSessionResponse>('/settings/billing/portal-session', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}
