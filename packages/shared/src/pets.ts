import { z } from 'zod';

export const COAT_TYPES = ['short', 'medium', 'long', 'curly', 'double', 'wire'] as const;
export const CoatTypeSchema = z.enum(COAT_TYPES);
export type CoatType = z.infer<typeof CoatTypeSchema>;

const isoDateString = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), { message: 'Enter a valid date.' });

export const PetInputSchema = z.object({
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
  preferredCutStyle: z.string().max(500).optional().default(''),
  vaccinationExpiry: isoDateString.nullable().optional(),
  photoUrl: z.string().url('Photo URL must be a valid URL.').nullable().optional(),
});
export type PetInput = z.infer<typeof PetInputSchema>;

export const PetUpdateSchema = PetInputSchema.partial();
export type PetUpdate = z.infer<typeof PetUpdateSchema>;

export const PetOutputSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  name: z.string(),
  breed: z.string(),
  weightLb: z.number().nullable(),
  coatType: CoatTypeSchema,
  temperamentNotes: z.string(),
  preferredCutStyle: z.string(),
  vaccinationExpiry: z.string().nullable(),
  photoUrl: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PetOutput = z.infer<typeof PetOutputSchema>;
