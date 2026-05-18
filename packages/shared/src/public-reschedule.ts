import { z } from 'zod';
import { AppointmentOutputSchema } from './appointments.js';

export const RescheduleVerifyRequestSchema = z.object({
  token: z.string().min(10, 'token is required.'),
});
export type RescheduleVerifyRequest = z.infer<typeof RescheduleVerifyRequestSchema>;

export const RescheduleVerifyResponseSchema = z.object({
  tenantSlug: z.string(),
  tenantName: z.string(),
  service: z.object({
    id: z.string(),
    name: z.string(),
    durationMin: z.number().int().positive(),
    color: z.string(),
  }),
  source: z.object({
    appointmentId: z.string(),
    start: z.string(),
    status: z.string(),
  }),
});
export type RescheduleVerifyResponse = z.infer<typeof RescheduleVerifyResponseSchema>;

export const RescheduleCommitRequestSchema = z.object({
  token: z.string().min(10, 'token is required.'),
  newStart: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), 'newStart must be a valid ISO date-time.'),
});
export type RescheduleCommitRequest = z.infer<typeof RescheduleCommitRequestSchema>;

export const RescheduleCommitResponseSchema = z.object({
  newAppointment: AppointmentOutputSchema,
  canceledAppointmentId: z.string(),
});
export type RescheduleCommitResponse = z.infer<typeof RescheduleCommitResponseSchema>;

export const RescheduleAlreadyUsedSchema = z.object({
  error: z.literal('already_used'),
  message: z.string(),
  linkedAppointmentId: z.string().nullable(),
  linkedAppointmentStart: z.string().nullable(),
});
export type RescheduleAlreadyUsed = z.infer<typeof RescheduleAlreadyUsedSchema>;
