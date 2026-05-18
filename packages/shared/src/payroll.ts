import { z } from 'zod';

export const PAYROLL_PERIOD_KINDS = ['weekly', 'biweekly'] as const;
export type PayrollPeriodKind = (typeof PAYROLL_PERIOD_KINDS)[number];

export const PayrollPeriodSchema = z.object({
  periodStart: z.string(),
  periodEnd: z.string(),
  kind: z.enum(PAYROLL_PERIOD_KINDS),
});
export type PayrollPeriod = z.infer<typeof PayrollPeriodSchema>;

export const PayrollPeriodsResponseSchema = z.object({
  kind: z.enum(PAYROLL_PERIOD_KINDS),
  periods: z.array(PayrollPeriodSchema),
});
export type PayrollPeriodsResponse = z.infer<typeof PayrollPeriodsResponseSchema>;

export const PayrollGroomerRowSchema = z.object({
  groomerId: z.string().nullable(),
  groomerEmail: z.string().nullable(),
  groomerName: z.string().nullable(),
  appointmentsCompleted: z.number().int().nonnegative(),
  revenueCents: z.number().int().nonnegative(),
  tipsCents: z.number().int().nonnegative(),
  totalCents: z.number().int().nonnegative(),
});
export type PayrollGroomerRow = z.infer<typeof PayrollGroomerRowSchema>;

export const PayrollSplitsResponseSchema = z.object({
  period: PayrollPeriodSchema,
  rows: z.array(PayrollGroomerRowSchema),
  totals: z.object({
    appointmentsCompleted: z.number().int().nonnegative(),
    revenueCents: z.number().int().nonnegative(),
    tipsCents: z.number().int().nonnegative(),
    totalCents: z.number().int().nonnegative(),
  }),
});
export type PayrollSplitsResponse = z.infer<typeof PayrollSplitsResponseSchema>;

export const PayrollPeriodsQuerySchema = z.object({
  from: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), 'from must be a valid ISO date.'),
  to: z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'to must be a valid ISO date.'),
});
export type PayrollPeriodsQuery = z.infer<typeof PayrollPeriodsQuerySchema>;

export const PayrollSplitsQuerySchema = z.object({
  periodStart: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), 'periodStart must be a valid ISO date.'),
  periodEnd: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), 'periodEnd must be a valid ISO date.'),
});
export type PayrollSplitsQuery = z.infer<typeof PayrollSplitsQuerySchema>;
