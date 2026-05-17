import { z } from 'zod';
import { PlanTierSchema, type PlanTier } from './auth.js';

export const PaidPlanTierSchema = z.enum(['starter', 'pro', 'business']);
export type PaidPlanTier = z.infer<typeof PaidPlanTierSchema>;

export const BillingCheckoutRequestSchema = z.object({
  tier: PaidPlanTierSchema,
});
export type BillingCheckoutRequest = z.infer<typeof BillingCheckoutRequestSchema>;

export const BillingCheckoutResponseSchema = z.object({
  url: z.string().url(),
  sessionId: z.string(),
});
export type BillingCheckoutResponse = z.infer<typeof BillingCheckoutResponseSchema>;

export const BillingStatusResponseSchema = z.object({
  plan: PlanTierSchema,
  stripeSubscriptionStatus: z.string().nullable(),
  currentPeriodEnd: z.string().nullable(),
  pastDueAt: z.string().nullable(),
});
export type BillingStatusResponse = z.infer<typeof BillingStatusResponseSchema>;

export type { PlanTier };
