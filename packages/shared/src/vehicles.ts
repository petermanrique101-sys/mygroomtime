import { z } from 'zod';

export const VehicleOutputSchema = z.object({
  id: z.string(),
  name: z.string(),
  assignedGroomerId: z.string().nullable(),
  assignedGroomerName: z.string().nullable(),
  assignedGroomerEmail: z.string().nullable(),
  active: z.boolean(),
  deletedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type VehicleOutput = z.infer<typeof VehicleOutputSchema>;

export const VehicleListResponseSchema = z.object({
  vehicles: z.array(VehicleOutputSchema),
});
export type VehicleListResponse = z.infer<typeof VehicleListResponseSchema>;

export const VehicleCreateRequestSchema = z.object({
  name: z.string().trim().min(1, 'Vehicle name is required.').max(60),
  assignedGroomerId: z.string().min(1).nullable().optional(),
});
export type VehicleCreateRequest = z.infer<typeof VehicleCreateRequestSchema>;

export const VehicleUpdateRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    assignedGroomerId: z.string().min(1).nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined || v.assignedGroomerId !== undefined || v.active !== undefined,
    'Provide at least one field to update.',
  );
export type VehicleUpdateRequest = z.infer<typeof VehicleUpdateRequestSchema>;

export const VehicleMutationResponseSchema = z.object({
  vehicle: VehicleOutputSchema,
});
export type VehicleMutationResponse = z.infer<typeof VehicleMutationResponseSchema>;

export const VehicleDeleteConflictErrorSchema = z.object({
  error: z.literal('vehicle_delete_blocked'),
  reason: z.enum(['future_appointments', 'last_active_vehicle']),
  message: z.string(),
  futureAppointmentCount: z.number().int().nonnegative().optional(),
});
export type VehicleDeleteConflictError = z.infer<typeof VehicleDeleteConflictErrorSchema>;
