import { z } from 'zod';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const PublicTenantServiceSchema = z.object({
  id: z.string(),
  name: z.string(),
  durationMin: z.number().int().positive(),
  basePriceCents: z.number().int().nonnegative(),
  depositCents: z.number().int().nonnegative(),
  color: z.string(),
});
export type PublicTenantService = z.infer<typeof PublicTenantServiceSchema>;

export const PublicTenantResponseSchema = z.object({
  slug: z.string(),
  businessName: z.string(),
  phone: z.string().nullable(),
  readOnly: z.boolean(),
  currentTime: z.string(),
  services: z.array(PublicTenantServiceSchema),
});
export type PublicTenantResponse = z.infer<typeof PublicTenantResponseSchema>;

export const PublicAvailabilityQuerySchema = z.object({
  serviceId: z.string().min(1, 'serviceId is required.'),
  date: z.string().regex(ISO_DATE_RE, 'date must be YYYY-MM-DD.'),
});
export type PublicAvailabilityQuery = z.infer<typeof PublicAvailabilityQuerySchema>;

export const PublicAvailabilitySlotSchema = z.object({
  start: z.string(),
  durationMin: z.number().int().positive(),
});
export type PublicAvailabilitySlot = z.infer<typeof PublicAvailabilitySlotSchema>;

export const PublicAvailabilityResponseSchema = z.object({
  serviceId: z.string(),
  date: z.string(),
  slots: z.array(PublicAvailabilitySlotSchema),
});
export type PublicAvailabilityResponse = z.infer<typeof PublicAvailabilityResponseSchema>;

export const PUBLIC_BOOKING_LEAD_TIME_MIN = 24 * 60;
export const PUBLIC_BOOKING_SLOT_STEP_MIN = 15;
export const PUBLIC_BOOKING_OPEN_HOUR = 8;
export const PUBLIC_BOOKING_CLOSE_HOUR = 17;
