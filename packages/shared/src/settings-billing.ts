import { z } from 'zod';
import { PaidPlanTierSchema, type PaidPlanTier } from './billing.js';
import { PlanTierSchema, type PlanTier } from './auth.js';

export const SettingsBillingTierMatrixRowSchema = z.object({
  tier: PaidPlanTierSchema,
  priceMonthlyCents: z.number().int().nonnegative(),
});
export type SettingsBillingTierMatrixRow = z.infer<typeof SettingsBillingTierMatrixRowSchema>;

export const SettingsBillingResponseSchema = z.object({
  plan: PlanTierSchema,
  currentPeriodEnd: z.string().nullable(),
  hasPaymentMethod: z.boolean(),
  available: z.array(SettingsBillingTierMatrixRowSchema),
});
export type SettingsBillingResponse = z.infer<typeof SettingsBillingResponseSchema>;

export const PreviewPlanChangeRequestSchema = z.object({
  targetPlan: PaidPlanTierSchema,
});
export type PreviewPlanChangeRequest = z.infer<typeof PreviewPlanChangeRequestSchema>;

export const PreviewPlanChangeResponseSchema = z.object({
  targetPlan: PaidPlanTierSchema,
  amountDueCents: z.number().int().nonnegative(),
  creditCents: z.number().int().nonnegative(),
  chargeCents: z.number().int().nonnegative(),
  currentPeriodEndIso: z.string(),
  nextChargeCents: z.number().int().nonnegative(),
});
export type PreviewPlanChangeResponse = z.infer<typeof PreviewPlanChangeResponseSchema>;

export const ChangePlanRequestSchema = z.object({
  targetPlan: PaidPlanTierSchema,
});
export type ChangePlanRequest = z.infer<typeof ChangePlanRequestSchema>;

export const ChangePlanResponseSchema = z.object({
  pending: z.literal(true),
  willTakeEffect: z.literal('webhook'),
});
export type ChangePlanResponse = z.infer<typeof ChangePlanResponseSchema>;

export const PortalSessionResponseSchema = z.object({
  url: z.string(),
});
export type PortalSessionResponse = z.infer<typeof PortalSessionResponseSchema>;

export const TIER_PRICE_CENTS: Record<PaidPlanTier, number> = {
  starter: 4900,
  pro: 9900,
  business: 14900,
};

export type { PaidPlanTier, PlanTier };
