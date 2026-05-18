-- CreateEnum
CREATE TYPE "PayrollPeriodKind" AS ENUM ('weekly', 'biweekly');

-- CreateEnum
CREATE TYPE "GoogleCalendarLinkKind" AS ENUM ('user', 'tenant_operations');

-- Tenant: payroll config
ALTER TABLE "Tenant"
  ADD COLUMN "payrollPeriodKind" "PayrollPeriodKind" NOT NULL DEFAULT 'biweekly',
  ADD COLUMN "payrollPeriodAnchorDate" TIMESTAMP(3);

-- Vehicle: soft-delete + active toggle
ALTER TABLE "Vehicle"
  ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "Vehicle_tenantId_active_deletedAt_idx"
  ON "Vehicle"("tenantId", "active", "deletedAt");

-- Appointment: ops calendar event id + dispatch + payroll indexes
ALTER TABLE "Appointment"
  ADD COLUMN "opsGoogleEventId" TEXT;

CREATE INDEX "Appointment_tenantId_vehicleId_scheduledStart_idx"
  ON "Appointment"("tenantId", "vehicleId", "scheduledStart");

CREATE INDEX "Appointment_tenantId_groomerId_completedAt_idx"
  ON "Appointment"("tenantId", "groomerId", "completedAt");

-- GoogleCalendarLink: link kind discriminator. Drop the old single-column unique
-- and replace with a composite (userId, linkKind) so the same user can hold a user
-- link AND a tenant_operations link concurrently. Operations links carry a NULL
-- userId; the tenant-level uniqueness is enforced by a separate partial unique.
ALTER TABLE "GoogleCalendarLink"
  ADD COLUMN "linkKind" "GoogleCalendarLinkKind" NOT NULL DEFAULT 'user';

-- userId becomes nullable to allow ops links to attach to the tenant only
ALTER TABLE "GoogleCalendarLink" ALTER COLUMN "userId" DROP NOT NULL;

DROP INDEX IF EXISTS "GoogleCalendarLink_userId_key";

CREATE UNIQUE INDEX "GoogleCalendarLink_userId_linkKind_key"
  ON "GoogleCalendarLink"("userId", "linkKind");

CREATE INDEX "GoogleCalendarLink_tenantId_linkKind_idx"
  ON "GoogleCalendarLink"("tenantId", "linkKind");

-- Partial unique: at most one tenant_operations link per tenant. Implemented
-- as a partial unique index rather than a check constraint because Postgres
-- allows partial UNIQUE.
CREATE UNIQUE INDEX "GoogleCalendarLink_tenantId_tenant_operations_key"
  ON "GoogleCalendarLink"("tenantId")
  WHERE "linkKind" = 'tenant_operations';
