import { z } from 'zod';

export const DashboardRevenueSummarySchema = z.object({
  dayCents: z.number().int().nonnegative(),
  weekCents: z.number().int().nonnegative(),
  monthCents: z.number().int().nonnegative(),
  error: z.literal('unavailable').optional(),
});
export type DashboardRevenueSummary = z.infer<typeof DashboardRevenueSummarySchema>;

export const DashboardNoShowSummarySchema = z.object({
  rate: z.number().min(0).max(1),
  sampleSize: z.number().int().nonnegative(),
  windowDays: z.number().int().positive(),
  error: z.literal('unavailable').optional(),
});
export type DashboardNoShowSummary = z.infer<typeof DashboardNoShowSummarySchema>;

export const DashboardDurationSummarySchema = z.object({
  avgMin: z.number().nullable(),
  sampleSize: z.number().int().nonnegative(),
  windowDays: z.number().int().positive(),
  error: z.literal('unavailable').optional(),
});
export type DashboardDurationSummary = z.infer<typeof DashboardDurationSummarySchema>;

export const DashboardTopClientRowSchema = z.object({
  clientId: z.string(),
  name: z.string(),
  totalCents: z.number().int().nonnegative(),
  appointmentCount: z.number().int().nonnegative(),
  isDeleted: z.boolean(),
});
export type DashboardTopClientRow = z.infer<typeof DashboardTopClientRowSchema>;

export const DashboardTopClientsSummarySchema = z.object({
  rows: z.array(DashboardTopClientRowSchema),
  windowDays: z.number().int().positive(),
  error: z.literal('unavailable').optional(),
});
export type DashboardTopClientsSummary = z.infer<typeof DashboardTopClientsSummarySchema>;

export const DashboardGapRowSchema = z.object({
  seriesId: z.string(),
  clientId: z.string(),
  clientName: z.string(),
  petName: z.string(),
  lastGroomedAt: z.string().nullable(),
  intervalWeeks: z.number().int().positive(),
  daysOverdue: z.number().int().nonnegative(),
});
export type DashboardGapRow = z.infer<typeof DashboardGapRowSchema>;

export const DashboardGapsSummarySchema = z.object({
  rows: z.array(DashboardGapRowSchema),
  gated: z.boolean(),
  gatedReason: z.literal('recurring_requires_pro').optional(),
  error: z.literal('unavailable').optional(),
});
export type DashboardGapsSummary = z.infer<typeof DashboardGapsSummarySchema>;

export const DashboardSummaryResponseSchema = z.object({
  generatedAt: z.string(),
  revenue: DashboardRevenueSummarySchema,
  noShow: DashboardNoShowSummarySchema,
  duration: DashboardDurationSummarySchema,
  topClients: DashboardTopClientsSummarySchema,
  gaps: DashboardGapsSummarySchema,
});
export type DashboardSummaryResponse = z.infer<typeof DashboardSummaryResponseSchema>;

export const DashboardRevenuePeriodSchema = z.enum(['day', 'week', 'month']);
export type DashboardRevenuePeriod = z.infer<typeof DashboardRevenuePeriodSchema>;

export const DashboardRevenueBucketSchema = z.object({
  dateIso: z.string(),
  revenueCents: z.number().int().nonnegative(),
  appointmentCount: z.number().int().nonnegative(),
});
export type DashboardRevenueBucket = z.infer<typeof DashboardRevenueBucketSchema>;

export const DashboardRevenueDetailResponseSchema = z.object({
  period: DashboardRevenuePeriodSchema,
  buckets: z.array(DashboardRevenueBucketSchema),
});
export type DashboardRevenueDetailResponse = z.infer<typeof DashboardRevenueDetailResponseSchema>;

export const DashboardNoShowRowSchema = z.object({
  appointmentId: z.string(),
  clientId: z.string(),
  clientName: z.string(),
  petName: z.string(),
  serviceName: z.string(),
  scheduledStart: z.string(),
  noShowAt: z.string().nullable(),
});
export type DashboardNoShowRow = z.infer<typeof DashboardNoShowRowSchema>;

export const DashboardPaginationSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});
export type DashboardPagination = z.infer<typeof DashboardPaginationSchema>;

export const DashboardNoShowsListResponseSchema = z.object({
  rows: z.array(DashboardNoShowRowSchema),
  pagination: DashboardPaginationSchema,
  windowDays: z.number().int().positive(),
});
export type DashboardNoShowsListResponse = z.infer<typeof DashboardNoShowsListResponseSchema>;

export const DashboardTopClientsListResponseSchema = z.object({
  rows: z.array(DashboardTopClientRowSchema),
  pagination: DashboardPaginationSchema,
  windowDays: z.number().int().positive(),
});
export type DashboardTopClientsListResponse = z.infer<typeof DashboardTopClientsListResponseSchema>;

export const DashboardGapsListResponseSchema = z.object({
  rows: z.array(DashboardGapRowSchema),
  gated: z.boolean(),
  gatedReason: z.literal('recurring_requires_pro').optional(),
});
export type DashboardGapsListResponse = z.infer<typeof DashboardGapsListResponseSchema>;
