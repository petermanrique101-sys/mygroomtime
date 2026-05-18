-- Migration: tenant_subscription_item_and_plan_history
-- Records the Stripe subscription item id (needed for proration-aware tier swaps)
-- and a per-tenant audit log of plan transitions (chunk 22 will surface the table
-- in the operator log; storing the rows now keeps history complete from chunk 13 on).
--
-- Backfill of stripeSubscriptionItemId is intentionally NOT done in SQL — no prod
-- tenants exist yet, and dev/test tenants pick it up automatically on the next
-- customer.subscription.created / customer.subscription.updated webhook. The
-- subscription-updated handler also self-heals if the column is null when a
-- tier change arrives.

ALTER TABLE "Tenant" ADD COLUMN "stripeSubscriptionItemId" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "lastPlanChangeAt" TIMESTAMP(3);

CREATE TABLE "TenantPlanChange" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fromPlan" "PlanTier" NOT NULL,
    "toPlan" "PlanTier" NOT NULL,
    "prorationAmountCents" INTEGER NOT NULL DEFAULT 0,
    "stripeEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantPlanChange_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "TenantPlanChange"
  ADD CONSTRAINT "TenantPlanChange_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "TenantPlanChange_tenantId_idx" ON "TenantPlanChange"("tenantId");
CREATE INDEX "TenantPlanChange_tenantId_createdAt_idx" ON "TenantPlanChange"("tenantId", "createdAt");
CREATE UNIQUE INDEX "TenantPlanChange_stripeEventId_key" ON "TenantPlanChange"("stripeEventId");
