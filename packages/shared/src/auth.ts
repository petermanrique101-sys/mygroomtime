import { z } from 'zod';

export const SignupRequestSchema = z.object({
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(10, 'Password must be at least 10 characters.'),
  businessName: z.string().trim().min(2, 'Business name must be at least 2 characters.'),
});
export type SignupRequest = z.infer<typeof SignupRequestSchema>;

export const LoginRequestSchema = z.object({
  email: z.string().email('Enter a valid email address.'),
  password: z.string().min(1, 'Password is required.'),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const MagicLinkRequestSchema = z.object({
  email: z.string().email('Enter a valid email address.'),
});
export type MagicLinkRequest = z.infer<typeof MagicLinkRequestSchema>;

export const MagicLinkConsumeSchema = z.object({
  token: z.string().min(1, 'Token is required.'),
});
export type MagicLinkConsume = z.infer<typeof MagicLinkConsumeSchema>;

export const AuthUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  role: z.enum(['owner', 'groomer', 'dispatcher']),
});
export type AuthUser = z.infer<typeof AuthUserSchema>;

export const PlanTierSchema = z.enum([
  'unpaid',
  'starter',
  'pro',
  'business',
  'past_due',
  'canceled',
]);
export type PlanTier = z.infer<typeof PlanTierSchema>;

export const PAID_PLAN_TIERS: ReadonlyArray<PlanTier> = ['starter', 'pro', 'business'];

export const AuthTenantSchema = z.object({
  id: z.string(),
  slug: z.string(),
  businessName: z.string(),
  plan: PlanTierSchema,
  stripeSubscriptionStatus: z.string().nullable().optional(),
  currentPeriodEnd: z.string().nullable().optional(),
  pastDueAt: z.string().nullable().optional(),
});
export type AuthTenant = z.infer<typeof AuthTenantSchema>;

export const AuthSessionSchema = z.object({
  user: AuthUserSchema,
  tenant: AuthTenantSchema,
});
export type AuthSession = z.infer<typeof AuthSessionSchema>;
