-- AlterTable: Client
ALTER TABLE "Client" ADD COLUMN "addressVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Client" ADD COLUMN "addressState" TEXT NOT NULL DEFAULT 'TX';
ALTER TABLE "Client" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- AlterTable: Pet
ALTER TABLE "Pet" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Backfill: existing seeded rows reference real Plano addresses, mark them verified.
UPDATE "Client" SET "addressVerified" = true WHERE "addressLat" IS NOT NULL AND "addressLng" IS NOT NULL;

-- Indexes for soft-delete-aware list queries
CREATE INDEX "Client_tenantId_deletedAt_idx" ON "Client"("tenantId", "deletedAt");
CREATE INDEX "Pet_tenantId_deletedAt_idx" ON "Pet"("tenantId", "deletedAt");
