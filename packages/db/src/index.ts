export { db } from './client.js';
export type { Db, GlobalDb } from './client.js';
export { isUniqueViolation } from './errors.js';
export type {
  TenantScopedDb,
  ScopedAppointment,
  ScopedBookingPageRequest,
  ScopedClient,
  ScopedMutationLog,
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
  MutationLogStatus,
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
  MutationLog,
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
