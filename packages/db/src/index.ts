export { db } from './client.js';
export type { Db, GlobalDb } from './client.js';
export { isUniqueViolation } from './errors.js';
export type {
  TenantScopedDb,
  ScopedAppointment,
  ScopedBookingPageRequest,
  ScopedClient,
  ScopedPet,
  ScopedRecurringSeries,
  ScopedService,
  ScopedSmsMessage,
  ScopedUser,
  ScopedVehicle,
} from './types.js';

export {
  AppointmentStatus,
  BookingRequestStatus,
  CoatType,
  PlanTier,
  SmsDirection,
  SmsStatus,
  UserRole,
  WebhookProcessingStatus,
  WebhookSource,
} from '@prisma/client';

export type {
  Appointment,
  BookingPageRequest,
  Client,
  Pet,
  Prisma,
  RecurringSeries,
  Service,
  SmsMessage,
  Tenant,
  TenantPlanChange,
  User,
  Vehicle,
  WebhookEvent,
} from '@prisma/client';
