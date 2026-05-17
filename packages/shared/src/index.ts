import { z } from 'zod';

export const HealthCheckSchema = z.object({
  status: z.literal('ok'),
});

export type HealthCheck = z.infer<typeof HealthCheckSchema>;

export * from './auth.js';
export * from './pets.js';
export * from './clients.js';
export * from './colors.js';
export * from './services.js';
export * from './appointments.js';
export * from './billing.js';
export * from './public-booking.js';
