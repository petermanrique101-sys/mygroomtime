import { z } from 'zod';

export const SettingsPaymentsStatusSchema = z.object({
  connectAccountId: z.string().nullable(),
  chargesEnabled: z.boolean(),
  payoutsEnabled: z.boolean(),
  detailsSubmitted: z.boolean(),
  needsOnboarding: z.boolean(),
  statusUpdatedAt: z.string().nullable(),
});
export type SettingsPaymentsStatus = z.infer<typeof SettingsPaymentsStatusSchema>;

export const SettingsPaymentsOnboardResponseSchema = z.object({
  url: z.string(),
});
export type SettingsPaymentsOnboardResponse = z.infer<
  typeof SettingsPaymentsOnboardResponseSchema
>;
