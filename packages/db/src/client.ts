import { PrismaClient } from '@prisma/client';
import { scopeDelegate, type DelegateWithWhere } from './scope.js';
import type {
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

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export interface GlobalDb {
  tenant: PrismaClient['tenant'];
  webhookEvent: PrismaClient['webhookEvent'];
  tenantPlanChange: PrismaClient['tenantPlanChange'];
  // why: cross-tenant access to RecurringSeries is needed for chunk-17's nightly
  // materialization walk. Application code MUST NOT use this delegate for tenant-scoped
  // reads — go through db.forTenant(tenantId).recurringSeries instead. The walker is the
  // only legitimate caller.
  recurringSeries: PrismaClient['recurringSeries'];
  // why: chunk-18 mutation-dedupe middleware looks up MutationLog by primary key BEFORE it
  // has resolved a request tenantId (it needs the row to short-circuit). Same justification
  // as recurringSeries above. Application code should not bypass this either —
  // db.forTenant(tenantId).mutationLog is the tenant-scoped surface.
  mutationLog: PrismaClient['mutationLog'];
  // why: chunk-20 Google Calendar inbound webhook arrives with X-Goog-Channel-Id only — we
  // resolve the link → user → tenant before any further DB touch. Same legitimate cross-
  // tenant access pattern. Application code goes through db.forTenant(...).googleCalendarLink.
  googleCalendarLink: PrismaClient['googleCalendarLink'];
  $transaction: PrismaClient['$transaction'];
  $disconnect: PrismaClient['$disconnect'];
}

const globalDb: GlobalDb = {
  tenant: prisma.tenant,
  webhookEvent: prisma.webhookEvent,
  tenantPlanChange: prisma.tenantPlanChange,
  recurringSeries: prisma.recurringSeries,
  mutationLog: prisma.mutationLog,
  googleCalendarLink: prisma.googleCalendarLink,
  $transaction: prisma.$transaction.bind(prisma),
  $disconnect: prisma.$disconnect.bind(prisma),
};

// why: Prisma's generated delegate types are much wider than scopeDelegate's structural
// contract (generic SelectSubset, GetFindResult, etc.). We narrow at the boundary, then
// cast the wrapped output back to the typed scoped surface declared in types.ts.
// Behavior is enforced at runtime by scopeDelegate.
function asDelegate(d: unknown): DelegateWithWhere {
  return d as DelegateWithWhere;
}

function forTenant(tenantId: string): TenantScopedDb {
  if (!tenantId) {
    throw new Error('db.forTenant(tenantId) requires a non-empty tenantId');
  }
  return {
    tenantId,
    client: scopeDelegate(asDelegate(prisma.client), tenantId) as unknown as ScopedClient,
    pet: scopeDelegate(asDelegate(prisma.pet), tenantId) as unknown as ScopedPet,
    service: scopeDelegate(asDelegate(prisma.service), tenantId) as unknown as ScopedService,
    vehicle: scopeDelegate(asDelegate(prisma.vehicle), tenantId) as unknown as ScopedVehicle,
    appointment: scopeDelegate(
      asDelegate(prisma.appointment),
      tenantId,
    ) as unknown as ScopedAppointment,
    recurringSeries: scopeDelegate(
      asDelegate(prisma.recurringSeries),
      tenantId,
    ) as unknown as ScopedRecurringSeries,
    bookingPageRequest: scopeDelegate(
      asDelegate(prisma.bookingPageRequest),
      tenantId,
    ) as unknown as ScopedBookingPageRequest,
    smsMessage: scopeDelegate(
      asDelegate(prisma.smsMessage),
      tenantId,
    ) as unknown as ScopedSmsMessage,
    user: scopeDelegate(asDelegate(prisma.user), tenantId) as unknown as ScopedUser,
    mutationLog: scopeDelegate(
      asDelegate(prisma.mutationLog),
      tenantId,
    ) as unknown as ScopedMutationLog,
    googleCalendarLink: scopeDelegate(
      asDelegate(prisma.googleCalendarLink),
      tenantId,
    ) as unknown as ScopedGoogleCalendarLink,
  };
}

export const db = {
  forTenant,
  global: globalDb,
};

export type Db = typeof db;
