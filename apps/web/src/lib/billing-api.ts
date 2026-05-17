import type { BillingCheckoutResponse, BillingStatusResponse, PaidPlanTier } from '@mygroomtime/shared';
import { apiFetch, type ApiError } from './api.js';

export type BillingResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export async function fetchBilling(): Promise<BillingResult<BillingStatusResponse>> {
  const res = await apiFetch<BillingStatusResponse>('/billing');
  return res;
}

export async function startCheckout(tier: PaidPlanTier): Promise<BillingResult<BillingCheckoutResponse>> {
  return apiFetch<BillingCheckoutResponse>('/billing/checkout', {
    method: 'POST',
    body: JSON.stringify({ tier }),
  });
}
