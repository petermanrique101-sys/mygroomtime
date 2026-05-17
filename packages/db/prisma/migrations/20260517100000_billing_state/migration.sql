-- Migration: billing_state
-- Extend PlanTier to include unpaid/past_due/canceled, change default to unpaid,
-- and add Stripe subscription tracking columns to Tenant.
--
-- why recreate the enum vs ALTER TYPE ADD VALUE: Postgres won't let us use a new
-- enum value (in the SET DEFAULT below) inside the same transaction that added it.
-- Recreating the type sidesteps that and keeps the migration atomic.

ALTER TYPE "PlanTier" RENAME TO "PlanTier_old";
CREATE TYPE "PlanTier" AS ENUM ('unpaid', 'starter', 'pro', 'business', 'past_due', 'canceled');
ALTER TABLE "Tenant" ALTER COLUMN "plan" DROP DEFAULT;
ALTER TABLE "Tenant" ALTER COLUMN "plan" TYPE "PlanTier" USING ("plan"::text::"PlanTier");
ALTER TABLE "Tenant" ALTER COLUMN "plan" SET DEFAULT 'unpaid';
DROP TYPE "PlanTier_old";

-- Existing rows keep plan='starter' (grandfathered for dev). No backfill UPDATE needed.

ALTER TABLE "Tenant" ADD COLUMN "stripeSubscriptionId" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "stripeSubscriptionStatus" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "currentPeriodEnd" TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN "pastDueAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Tenant_stripeSubscriptionId_key" ON "Tenant"("stripeSubscriptionId");
