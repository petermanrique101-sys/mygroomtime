-- Migration: connect_and_booking_requests
-- Adds Stripe Connect status fields to Tenant and fills out BookingPageRequest with
-- the customer/pet/payment fields the public booking submit flow needs.
--
-- BookingRequestStatus enum is replaced (old values 'pending','paid','canceled' are
-- gone; new shape: pending_payment | succeeded | failed | expired | promoted).
-- No existing rows in any environment use this table yet — chunk 12 is the first
-- write site — so a destructive enum swap is safe.

ALTER TYPE "BookingRequestStatus" RENAME TO "BookingRequestStatus_old";
CREATE TYPE "BookingRequestStatus" AS ENUM ('pending_payment', 'succeeded', 'failed', 'expired', 'promoted');

ALTER TABLE "BookingPageRequest" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "BookingPageRequest"
  ALTER COLUMN "status" TYPE "BookingRequestStatus"
  USING (
    CASE "status"::text
      WHEN 'pending' THEN 'pending_payment'::"BookingRequestStatus"
      WHEN 'paid' THEN 'succeeded'::"BookingRequestStatus"
      WHEN 'canceled' THEN 'expired'::"BookingRequestStatus"
      ELSE "status"::text::"BookingRequestStatus"
    END
  );
ALTER TABLE "BookingPageRequest" ALTER COLUMN "status" SET DEFAULT 'pending_payment';
DROP TYPE "BookingRequestStatus_old";

ALTER TABLE "Tenant" ADD COLUMN "stripeConnectChargesEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Tenant" ADD COLUMN "stripeConnectPayoutsEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Tenant" ADD COLUMN "stripeConnectStatusUpdatedAt" TIMESTAMP(3);

ALTER TABLE "BookingPageRequest" ADD COLUMN "petTemperamentNotes" TEXT NOT NULL DEFAULT '';
ALTER TABLE "BookingPageRequest" ADD COLUMN "petVaccinationExpiry" TIMESTAMP(3);
ALTER TABLE "BookingPageRequest" ADD COLUMN "addressState" TEXT NOT NULL DEFAULT 'TX';
ALTER TABLE "BookingPageRequest" ADD COLUMN "addressLat" DOUBLE PRECISION;
ALTER TABLE "BookingPageRequest" ADD COLUMN "addressLng" DOUBLE PRECISION;
ALTER TABLE "BookingPageRequest" ADD COLUMN "durationMin" INTEGER NOT NULL DEFAULT 60;
ALTER TABLE "BookingPageRequest" ADD COLUMN "depositCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BookingPageRequest" ADD COLUMN "expiresAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '30 minutes');

-- Backfill defaults aren't needed beyond what's above — no rows exist.
ALTER TABLE "BookingPageRequest" ALTER COLUMN "durationMin" DROP DEFAULT;
ALTER TABLE "BookingPageRequest" ALTER COLUMN "depositCents" DROP DEFAULT;
ALTER TABLE "BookingPageRequest" ALTER COLUMN "expiresAt" DROP DEFAULT;

CREATE INDEX "BookingPageRequest_tenantId_status_expiresAt_idx" ON "BookingPageRequest"("tenantId", "status", "expiresAt");
