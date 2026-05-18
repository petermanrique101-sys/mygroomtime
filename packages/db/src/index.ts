export { db } from './client.js';
export type { Db, GlobalDb } from './client.js';
export { isUniqueViolation } from './errors.js';
export type {
  TenantScopedDb,
  ScopedAppointment,
  ScopedBookingPageRequest,
  ScopedClient,
  ScopedGoogleCalendarLink,
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
  GoogleCalendarLinkKind,
  MutationLogStatus,
  PayrollPeriodKind,
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
  GoogleCalendarLink,
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
