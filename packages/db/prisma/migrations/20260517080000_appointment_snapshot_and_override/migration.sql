-- AlterTable: Appointment — service snapshot columns (NOT NULL — chunks 1-7 created zero rows).
ALTER TABLE "Appointment" ADD COLUMN "serviceNameSnapshot" TEXT NOT NULL;
ALTER TABLE "Appointment" ADD COLUMN "servicePriceCentsSnapshot" INTEGER NOT NULL;
ALTER TABLE "Appointment" ADD COLUMN "serviceDepositCentsSnapshot" INTEGER NOT NULL;
ALTER TABLE "Appointment" ADD COLUMN "serviceColorSnapshot" TEXT NOT NULL;
ALTER TABLE "Appointment" ADD COLUMN "serviceDurationMinSnapshot" INTEGER NOT NULL;

-- AlterTable: Appointment — address override (null = use client address).
ALTER TABLE "Appointment" ADD COLUMN "addressOverrideStreet" TEXT;
ALTER TABLE "Appointment" ADD COLUMN "addressOverrideCity" TEXT;
ALTER TABLE "Appointment" ADD COLUMN "addressOverrideState" TEXT;
ALTER TABLE "Appointment" ADD COLUMN "addressOverrideZip" TEXT;
ALTER TABLE "Appointment" ADD COLUMN "addressOverrideLat" DOUBLE PRECISION;
ALTER TABLE "Appointment" ADD COLUMN "addressOverrideLng" DOUBLE PRECISION;
ALTER TABLE "Appointment" ADD COLUMN "addressOverrideVerified" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: Appointment — soft-cancel timestamp.
ALTER TABLE "Appointment" ADD COLUMN "canceledAt" TIMESTAMP(3);
