import { z } from 'zod';
import { CoatTypeSchema } from './pets.js';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PHONE_RE = /^[+0-9()\-\s.]{7,20}$/;
const ZIP_RE = /^\d{5}(-\d{4})?$/;

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
export const PUBLIC_BOOKING_REQUEST_TTL_MIN = 30;

export const PublicBookingCustomerSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required.').max(80),
  lastName: z.string().trim().min(1, 'Last name is required.').max(80),
  phone: z
    .string()
    .trim()
    .regex(PHONE_RE, 'Enter a valid phone number.'),
  email: z
    .string()
    .trim()
    .email('Enter a valid email address.')
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
  street: z.string().trim().min(1, 'Street is required.').max(160),
  city: z.string().trim().min(1, 'City is required.').max(80),
  state: z
    .string()
    .trim()
    .min(2, 'State is required (2 letters).')
    .max(2, 'State must be a 2-letter code.')
    .transform((s) => s.toUpperCase()),
  zip: z.string().trim().regex(ZIP_RE, 'Enter a 5-digit zip code.'),
});
export type PublicBookingCustomer = z.infer<typeof PublicBookingCustomerSchema>;

export const PublicBookingPetSchema = z.object({
  name: z.string().trim().min(1, "Pet's name is required.").max(80),
  breed: z.string().trim().min(1, 'Breed is required.').max(80),
  weightLb: z
    .number({ invalid_type_error: 'Weight must be a number in pounds.' })
    .positive('Weight must be greater than 0.')
    .max(500, 'Weight must be under 500 lb.')
    .nullable()
    .optional(),
  coatType: CoatTypeSchema,
  temperamentNotes: z.string().max(2000).optional().default(''),
  vaccinationExpiry: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), { message: 'Enter a valid date.' })
    .nullable()
    .optional(),
});
export type PublicBookingPet = z.infer<typeof PublicBookingPetSchema>;

export const PublicBookingSubmitRequestSchema = z.object({
  serviceId: z.string().min(1, 'serviceId is required.'),
  start: z.string().refine((s) => !Number.isNaN(Date.parse(s)), {
    message: 'Pick a valid start time.',
  }),
  customer: PublicBookingCustomerSchema,
  pet: PublicBookingPetSchema,
});
export type PublicBookingSubmitRequest = z.infer<typeof PublicBookingSubmitRequestSchema>;

export const PublicBookingSubmitResponseSchema = z.object({
  bookingRequestId: z.string(),
  paymentIntentId: z.string(),
  clientSecret: z.string(),
  depositCents: z.number().int().nonnegative(),
  twinMode: z.boolean(),
});
export type PublicBookingSubmitResponse = z.infer<typeof PublicBookingSubmitResponseSchema>;

export const PUBLIC_BOOKING_STATUSES = [
  'pending_payment',
  'succeeded',
  'failed',
  'expired',
  'promoted',
] as const;
export type PublicBookingStatus = (typeof PUBLIC_BOOKING_STATUSES)[number];

export const PublicBookingStatusResponseSchema = z.object({
  status: z.enum(PUBLIC_BOOKING_STATUSES),
  appointmentId: z.string().nullable(),
  service: z.object({
    name: z.string(),
    durationMin: z.number().int().positive(),
    color: z.string(),
  }),
  start: z.string(),
  addressLine: z.string(),
});
export type PublicBookingStatusResponse = z.infer<typeof PublicBookingStatusResponseSchema>;
