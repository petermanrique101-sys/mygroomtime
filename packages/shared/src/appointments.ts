import { z } from 'zod';

const PHONE_RE = /^[+0-9()\-\s.]{7,20}$/;
const ZIP_RE = /^\d{5}(-\d{4})?$/;

export const APPOINTMENT_STATUSES = [
  'scheduled',
  'on_the_way',
  'started',
  'completed',
  'canceled',
  'no_show',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const AppointmentAddressOverrideSchema = z.object({
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
export type AppointmentAddressOverride = z.infer<typeof AppointmentAddressOverrideSchema>;

export const AppointmentCreateRequestSchema = z.object({
  petId: z.string().min(1, 'Pick a pet.'),
  serviceId: z.string().min(1, 'Pick a service.'),
  start: z
    .string()
    .min(1, 'Start time is required.')
    .refine((s) => !Number.isNaN(Date.parse(s)), 'Start must be a valid ISO date-time.'),
  notes: z.string().max(2000).optional(),
  addressOverride: AppointmentAddressOverrideSchema.nullable().optional(),
  mutationUuid: z.string().uuid().optional(),
});
export type AppointmentCreateRequest = z.infer<typeof AppointmentCreateRequestSchema>;

export const AppointmentUpdateRequestSchema = z
  .object({
    notes: z.string().max(2000).optional(),
    addressOverride: AppointmentAddressOverrideSchema.nullable().optional(),
    start: z
      .string()
      .refine((s) => !Number.isNaN(Date.parse(s)), 'Start must be a valid ISO date-time.')
      .optional(),
  })
  .refine(
    (v) => v.notes !== undefined || v.addressOverride !== undefined || v.start !== undefined,
    'Provide at least one field to update.',
  );
export type AppointmentUpdateRequest = z.infer<typeof AppointmentUpdateRequestSchema>;

export const AppointmentBuffersQuerySchema = z.object({
  date: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), 'date must be a valid ISO date.'),
});
export type AppointmentBuffersQuery = z.infer<typeof AppointmentBuffersQuerySchema>;

export const AppointmentBufferEntrySchema = z.object({
  appointmentId: z.string(),
  beforeBufferMin: z.number().int().nonnegative(),
  afterBufferMin: z.number().int().nonnegative(),
});
export type AppointmentBufferEntry = z.infer<typeof AppointmentBufferEntrySchema>;

export const AppointmentBuffersResponseSchema = z.object({
  date: z.string(),
  defaultBufferMin: z.number().int().nonnegative(),
  buffers: z.array(AppointmentBufferEntrySchema),
});
export type AppointmentBuffersResponse = z.infer<typeof AppointmentBuffersResponseSchema>;

export const APPOINTMENT_CONFLICT_REASONS = ['overlap', 'buffer', 'past'] as const;
export type AppointmentConflictReason = (typeof APPOINTMENT_CONFLICT_REASONS)[number];

export const AppointmentConflictDetailSchema = z.object({
  neighborAppointmentId: z.string().nullable(),
  neighborPetName: z.string().nullable(),
  neighborStart: z.string().nullable(),
  bufferMin: z.number().int().nonnegative().nullable(),
});
export type AppointmentConflictDetail = z.infer<typeof AppointmentConflictDetailSchema>;

export const AppointmentConflictErrorSchema = z.object({
  error: z.literal('appointment_conflict'),
  message: z.string(),
  reason: z.enum(APPOINTMENT_CONFLICT_REASONS),
  detail: AppointmentConflictDetailSchema,
});
export type AppointmentConflictError = z.infer<typeof AppointmentConflictErrorSchema>;

export const AppointmentRangeQuerySchema = z
  .object({
    from: z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'Invalid from.'),
    to: z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'Invalid to.'),
  })
  .superRefine((v, ctx) => {
    const from = new Date(v.from).getTime();
    const to = new Date(v.to).getTime();
    if (to <= from) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to'],
        message: 'to must be after from.',
      });
    }
    const ONE_YEAR_MS = 366 * 24 * 60 * 60 * 1000;
    if (to - from > ONE_YEAR_MS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to'],
        message: 'Range must be within 1 year.',
      });
    }
  });

const PetSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  breed: z.string(),
});

const ClientSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string().regex(PHONE_RE).or(z.string()),
  street: z.string(),
  city: z.string(),
  state: z.string(),
  zip: z.string(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
});

export const AppointmentOutputSchema = z.object({
  id: z.string(),
  status: z.enum(APPOINTMENT_STATUSES),
  start: z.string(),
  end: z.string(),
  durationMin: z.number().int(),
  petId: z.string(),
  serviceId: z.string(),
  vehicleId: z.string().nullable(),
  groomerId: z.string().nullable(),
  serviceNameSnapshot: z.string(),
  servicePriceCentsSnapshot: z.number().int(),
  serviceDepositCentsSnapshot: z.number().int(),
  serviceColorSnapshot: z.string(),
  serviceDurationMinSnapshot: z.number().int(),
  addressOverride: AppointmentAddressOverrideSchema.extend({
    lat: z.number().nullable(),
    lng: z.number().nullable(),
    verified: z.boolean(),
  })
    .nullable(),
  notes: z.string(),
  canceledAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  pet: PetSummarySchema,
  client: ClientSummarySchema,
});
export type AppointmentOutput = z.infer<typeof AppointmentOutputSchema>;

export const AppointmentListResponseSchema = z.object({
  appointments: z.array(AppointmentOutputSchema),
});
export type AppointmentListResponse = z.infer<typeof AppointmentListResponseSchema>;

export const AppointmentMutationWarningSchema = z.object({
  code: z.literal('address_unverified'),
  message: z.string(),
});
export type AppointmentMutationWarning = z.infer<typeof AppointmentMutationWarningSchema>;

export const AppointmentMutationResponseSchema = z.object({
  appointment: AppointmentOutputSchema,
  warning: AppointmentMutationWarningSchema.nullable().optional(),
});
export type AppointmentMutationResponse = z.infer<typeof AppointmentMutationResponseSchema>;

export const AppointmentOverlapErrorSchema = z.object({
  error: z.literal('appointment_overlap'),
  message: z.string(),
  conflictingId: z.string(),
  conflictingStart: z.string(),
  conflictingEnd: z.string(),
});
export type AppointmentOverlapError = z.infer<typeof AppointmentOverlapErrorSchema>;
