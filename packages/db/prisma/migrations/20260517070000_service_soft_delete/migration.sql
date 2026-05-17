-- AlterTable: Service
ALTER TABLE "Service" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Index for soft-delete-aware list queries
CREATE INDEX "Service_tenantId_deletedAt_idx" ON "Service"("tenantId", "deletedAt");
