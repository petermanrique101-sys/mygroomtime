import type {
  DashboardGapsListResponse,
  DashboardNoShowsListResponse,
  DashboardRevenueDetailResponse,
  DashboardRevenuePeriod,
  DashboardSummaryResponse,
  DashboardTopClientsListResponse,
} from '@mygroomtime/shared';
import { apiFetch, type ApiError } from './api.js';

type Result<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export async function fetchDashboardSummary(): Promise<Result<DashboardSummaryResponse>> {
  return apiFetch<DashboardSummaryResponse>('/dashboard');
}

export async function fetchDashboardRevenue(
  period: DashboardRevenuePeriod,
): Promise<Result<DashboardRevenueDetailResponse>> {
  return apiFetch<DashboardRevenueDetailResponse>(`/dashboard/revenue?period=${period}`);
}

export async function fetchDashboardNoShows(
  page: number,
  pageSize = 25,
): Promise<Result<DashboardNoShowsListResponse>> {
  const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  return apiFetch<DashboardNoShowsListResponse>(`/dashboard/no-shows?${qs.toString()}`);
}

export async function fetchDashboardTopClients(
  page: number,
  pageSize = 25,
): Promise<Result<DashboardTopClientsListResponse>> {
  const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  return apiFetch<DashboardTopClientsListResponse>(`/dashboard/top-clients?${qs.toString()}`);
}

export async function fetchDashboardGaps(): Promise<Result<DashboardGapsListResponse>> {
  return apiFetch<DashboardGapsListResponse>('/dashboard/gaps-to-fill');
}
