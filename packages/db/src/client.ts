import { PrismaClient } from '@prisma/client';
import { scopeDelegate, type DelegateWithWhere } from './scope.js';
import type {
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
  $transaction: PrismaClient['$transaction'];
  $disconnect: PrismaClient['$disconnect'];
}

const globalDb: GlobalDb = {
  tenant: prisma.tenant,
  webhookEvent: prisma.webhookEvent,
  tenantPlanChange: prisma.tenantPlanChange,
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
  };
}

export const db = {
  forTenant,
  global: globalDb,
};

export type Db = typeof db;
