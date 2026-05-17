-- AlterTable: Tenant — per-tenant fallback buffer used when drive-time cannot be computed.
ALTER TABLE "Tenant" ADD COLUMN "defaultBufferMinutes" INTEGER NOT NULL DEFAULT 15;
