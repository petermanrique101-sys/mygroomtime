import { z } from 'zod';
import { SERVICE_COLOR_PALETTE } from './colors.js';

const ColorSchema = z
  .string()
  .refine(
    (v): v is (typeof SERVICE_COLOR_PALETTE)[number] =>
      (SERVICE_COLOR_PALETTE as readonly string[]).includes(v),
    { message: 'Pick a color from the palette.' },
  );

const ServiceFieldsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required.')
    .max(80, 'Keep the name under 80 characters.'),
  durationMin: z
    .number({ invalid_type_error: 'Duration must be a number.' })
    .int('Duration must be a whole number of minutes.')
    .min(5, 'Duration must be at least 5 minutes.')
    .max(480, 'Duration must be at most 480 minutes (8 hours).'),
  basePriceCents: z
    .number({ invalid_type_error: 'Base price must be a number.' })
    .int('Base price must be in whole cents.')
    .positive('Base price must be greater than 0.'),
  depositCents: z
    .number({ invalid_type_error: 'Deposit must be a number.' })
    .int('Deposit must be in whole cents.')
    .min(0, 'Deposit cannot be negative.'),
  color: ColorSchema,
  active: z.boolean(),
});

export const ServiceInputSchema = ServiceFieldsSchema.superRefine((val, ctx) => {
  if (val.depositCents > val.basePriceCents) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Deposit cannot exceed the base price.',
      path: ['depositCents'],
    });
  }
});
export type ServiceInput = z.infer<typeof ServiceInputSchema>;

export const ServiceUpdateSchema = ServiceFieldsSchema.partial().superRefine((val, ctx) => {
  if (
    val.depositCents !== undefined &&
    val.basePriceCents !== undefined &&
    val.depositCents > val.basePriceCents
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Deposit cannot exceed the base price.',
      path: ['depositCents'],
    });
  }
});
export type ServiceUpdate = z.infer<typeof ServiceUpdateSchema>;

export const ServiceOutputSchema = z.object({
  id: z.string(),
  name: z.string(),
  durationMin: z.number(),
  basePriceCents: z.number(),
  depositCents: z.number(),
  color: z.string(),
  active: z.boolean(),
  deletedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ServiceOutput = z.infer<typeof ServiceOutputSchema>;

export const ServiceListResponseSchema = z.object({
  services: z.array(ServiceOutputSchema),
});
export type ServiceListResponse = z.infer<typeof ServiceListResponseSchema>;

export const ServiceMutationResponseSchema = z.object({
  service: ServiceOutputSchema,
});
export type ServiceMutationResponse = z.infer<typeof ServiceMutationResponseSchema>;
