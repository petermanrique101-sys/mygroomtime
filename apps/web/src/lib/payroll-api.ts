import type {
  PayrollPeriodsResponse,
  PayrollSplitsResponse,
} from '@mygroomtime/shared';
import { apiFetch, type ApiError } from './api.js';

type Result<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export async function getPayrollPeriods(
  fromIso: string,
  toIso: string,
): Promise<Result<PayrollPeriodsResponse>> {
  const qs = `?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`;
  return apiFetch<PayrollPeriodsResponse>(`/payroll/periods${qs}`);
}

export async function getPayrollSplits(
  periodStartIso: string,
  periodEndIso: string,
): Promise<Result<PayrollSplitsResponse>> {
  const qs =
    `?periodStart=${encodeURIComponent(periodStartIso)}` +
    `&periodEnd=${encodeURIComponent(periodEndIso)}`;
  return apiFetch<PayrollSplitsResponse>(`/payroll/splits${qs}`);
}

export function payrollSplitsCsvUrl(
  apiBase: string,
  periodStartIso: string,
  periodEndIso: string,
): string {
  const qs =
    `?periodStart=${encodeURIComponent(periodStartIso)}` +
    `&periodEnd=${encodeURIComponent(periodEndIso)}`;
  return `${apiBase}/payroll/splits.csv${qs}`;
}
