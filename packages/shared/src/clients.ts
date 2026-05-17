import { z } from 'zod';
import { PetInputSchema, PetOutputSchema } from './pets.js';

const PHONE_RE = /^[+0-9()\-\s.]{7,20}$/;
const ZIP_RE = /^\d{5}(-\d{4})?$/;

export const ClientAddressSchema = z.object({
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
export type ClientAddress = z.infer<typeof ClientAddressSchema>;

export const ClientContactSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(120),
  phone: z
    .string()
    .trim()
    .regex(PHONE_RE, 'Enter a valid phone number (digits, spaces, dashes ok).'),
  email: z
    .string()
    .trim()
    .email('Enter a valid email address.')
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
  notes: z.string().max(2000).optional().default(''),
  preferredGroomerId: z.string().nullable().optional(),
});

export const ClientInputSchema = ClientContactSchema.merge(ClientAddressSchema);
export type ClientInput = z.infer<typeof ClientInputSchema>;

export const ClientCreateRequestSchema = ClientInputSchema.extend({
  pets: z.array(PetInputSchema).min(1, 'Add at least one pet for this client.'),
});
export type ClientCreateRequest = z.infer<typeof ClientCreateRequestSchema>;

export const ClientUpdateSchema = ClientInputSchema.partial();
export type ClientUpdate = z.infer<typeof ClientUpdateSchema>;

export const ClientOutputSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
  email: z.string().nullable(),
  street: z.string(),
  city: z.string(),
  state: z.string(),
  zip: z.string(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  addressVerified: z.boolean(),
  preferredGroomerId: z.string().nullable(),
  notes: z.string(),
  smsOptOut: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ClientOutput = z.infer<typeof ClientOutputSchema>;

export const ClientWithPetsOutputSchema = ClientOutputSchema.extend({
  pets: z.array(PetOutputSchema),
});
export type ClientWithPetsOutput = z.infer<typeof ClientWithPetsOutputSchema>;

export const ClientListResponseSchema = z.object({
  clients: z.array(ClientOutputSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});
export type ClientListResponse = z.infer<typeof ClientListResponseSchema>;

export const AddressUnverifiedWarning = z.object({
  code: z.literal('address_unverified'),
  message: z.string(),
});
export type AddressUnverifiedWarning = z.infer<typeof AddressUnverifiedWarning>;

export const ClientMutationResponseSchema = z.object({
  client: ClientWithPetsOutputSchema,
  warning: AddressUnverifiedWarning.nullable().optional(),
});
export type ClientMutationResponse = z.infer<typeof ClientMutationResponseSchema>;
