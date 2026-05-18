import { z } from 'zod';

export const RouteOptimizeQuerySchema = z.object({
  date: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), 'date must be a valid ISO date.')
    .optional(),
  vehicleId: z.string().min(1).optional(),
});
export type RouteOptimizeQuery = z.infer<typeof RouteOptimizeQuerySchema>;

export const RouteOptimizedStopSchema = z.object({
  appointmentId: z.string(),
  startSuggested: z.string(),
  scheduledStart: z.string(),
  durationMin: z.number().int().nonnegative(),
  driveFromPrevMin: z.number().int().nonnegative(),
  timeLocked: z.boolean(),
  pet: z.object({ id: z.string(), name: z.string() }),
  client: z.object({
    id: z.string(),
    name: z.string(),
    street: z.string(),
    city: z.string(),
    zip: z.string(),
    lat: z.number().nullable(),
    lng: z.number().nullable(),
  }),
  serviceName: z.string(),
});
export type RouteOptimizedStop = z.infer<typeof RouteOptimizedStopSchema>;

export const RouteOptimizeResponseSchema = z.object({
  date: z.string(),
  vehicleId: z.string(),
  depotUsed: z.boolean(),
  depot: z
    .object({ lat: z.number(), lng: z.number() })
    .nullable(),
  totalDriveMin: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
  stops: z.array(RouteOptimizedStopSchema),
});
export type RouteOptimizeResponse = z.infer<typeof RouteOptimizeResponseSchema>;

export const RouteApplyStopSchema = z.object({
  appointmentId: z.string().min(1),
  startSuggested: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), 'startSuggested must be a valid ISO date-time.'),
});
export type RouteApplyStop = z.infer<typeof RouteApplyStopSchema>;

export const RouteApplyRequestSchema = z.object({
  date: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), 'date must be a valid ISO date.'),
  vehicleId: z.string().min(1),
  stops: z.array(RouteApplyStopSchema).min(1, 'At least one stop is required.'),
});
export type RouteApplyRequest = z.infer<typeof RouteApplyRequestSchema>;

export const RouteApplyResponseSchema = z.object({
  applied: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
});
export type RouteApplyResponse = z.infer<typeof RouteApplyResponseSchema>;

export const RouteApplyConflictSchema = z.object({
  error: z.literal('route_apply_conflict'),
  reason: z.literal('concurrent_modification'),
  message: z.string(),
});
export type RouteApplyConflict = z.infer<typeof RouteApplyConflictSchema>;

export const RouteTierGatedSchema = z.object({
  error: z.literal('plan_required'),
  reason: z.literal('tier_gated'),
  message: z.string(),
  currentPlan: z.string(),
});
export type RouteTierGated = z.infer<typeof RouteTierGatedSchema>;
