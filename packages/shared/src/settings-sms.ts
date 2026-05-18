import { z } from 'zod';

export const SettingsSmsStatusSchema = z.object({
  remindersEnabled: z.boolean(),
  tierAllowsReminders: z.boolean(),
});
export type SettingsSmsStatus = z.infer<typeof SettingsSmsStatusSchema>;

export const SettingsSmsUpdateRequestSchema = z.object({
  remindersEnabled: z.boolean(),
});
export type SettingsSmsUpdateRequest = z.infer<typeof SettingsSmsUpdateRequestSchema>;
